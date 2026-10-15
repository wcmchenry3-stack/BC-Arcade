"""The replay dial (#3279, epic #3273): per-game kill switch and sample rate.

``game_types.replay_enabled`` / ``replay_sample_rate`` (migration 0036) are served
on ``GET /games/catalog``; ``append_events`` drops a game's replay rows while its
``replay_enabled`` (or ``REPLAY_RECORDING_ENABLED``) is off; the storage-budget
job lowers every rate at 90 % (owner decision D1-A, #3353). The sample itself is
the app's (D3-A): the server never checks it.
"""

from __future__ import annotations

import re
import sqlite3
import uuid
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from db.base import get_session_factory
from db.models import EventType, GameEntitlement, GameEvent, GameType
from games import catalog_cache, replay_storage, sessions
from games.filters import REPLAY_CUTOFF_KEY, REPLAY_PAUSED_KEY
from games.replay_caps import RETENTION_KEEP_NAMES
from games.replay_storage import StorageSize, check_storage_budget
from observability import report
from settings import Settings
from tests._helpers import session_headers as _headers
from tests._migration_helpers import Alembic
from vocab import GameType as VocabGameType

MB = 1024 * 1024


@pytest.fixture(autouse=True)
async def _restore_the_dial():
    """Put every game's dial back as it was, so this file runs on a shared Postgres too."""
    async with get_session_factory()() as db:
        saved = (
            await db.execute(
                select(GameType.id, GameType.replay_enabled, GameType.replay_sample_rate)
            )
        ).all()
    yield
    async with get_session_factory()() as db:
        for type_id, enabled, rate in saved:
            await db.execute(
                update(GameType)
                .where(GameType.id == type_id)
                .values(replay_enabled=enabled, replay_sample_rate=rate)
            )
        await db.commit()
    catalog_cache.invalidate()


async def _set_dial(name: str, *, enabled: bool | None = None, rate: float | None = None) -> None:
    values: dict[str, Any] = {}
    if enabled is not None:
        values["replay_enabled"] = enabled
    if rate is not None:
        values["replay_sample_rate"] = rate
    async with get_session_factory()() as db:
        await db.execute(update(GameType).where(GameType.name == name).values(**values))
        await db.commit()
    catalog_cache.invalidate()


async def _rates() -> dict[str, float]:
    async with get_session_factory()() as db:
        rows = await db.execute(select(GameType.name, GameType.replay_sample_rate))
        return {name: round(float(rate), 4) for name, rate in rows}


def _catalog(client: TestClient) -> dict[str, dict[str, Any]]:
    r = client.get("/games/catalog")
    assert r.status_code == 200
    return {item["name"]: item for item in r.json()["items"]}


# ---------------------------------------------------------------------------
# GET /games/catalog
# ---------------------------------------------------------------------------


def test_the_catalog_serves_every_games_dial_at_the_default(client: TestClient) -> None:
    items = _catalog(client)
    assert items
    for item in items.values():
        # 0.1 exactly, not REAL's 0.10000000149.
        assert item["replay"] == {"enabled": True, "sample_rate": 0.1}
    assert client.get("/games/catalog").headers["Cache-Control"] == "public, max-age=300"


async def test_the_catalog_serves_each_games_own_dial(client: TestClient) -> None:
    await _set_dial("yacht", enabled=False)
    await _set_dial("hearts", rate=0.25)
    items = _catalog(client)
    assert items["yacht"]["replay"] == {"enabled": False, "sample_rate": 0.1}
    assert items["hearts"]["replay"] == {"enabled": True, "sample_rate": 0.25}


def test_the_env_kill_switch_turns_every_game_off_in_the_catalog(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sessions, "_settings", Settings.isolated(REPLAY_RECORDING_ENABLED=False))
    assert {item["replay"]["enabled"] for item in _catalog(client).values()} == {False}


def test_catalog_names_are_the_apps_game_type_keys(client: TestClient) -> None:
    """The app keys the dial by its GameType (frontend/src/api/vocab.ts, generated from vocab)."""
    assert {g.value for g in VocabGameType} <= set(_catalog(client))


# ---------------------------------------------------------------------------
# append_events: game_types.replay_enabled is the second kill switch
# ---------------------------------------------------------------------------


@pytest.fixture
async def yacht_entitled(session_id: str) -> str:
    async with get_session_factory()() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug="yacht"))
        await db.commit()
    return session_id


def _new_game(client: TestClient, sid: str) -> str:
    r = client.post("/games", headers=_headers(sid), json={"game_type": "yacht"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _post(client: TestClient, sid: str, gid: str, events: list[dict]) -> dict:
    r = client.post(f"/games/{gid}/events", headers=_headers(sid), json={"events": events})
    assert r.status_code == 200, r.text
    return r.json()


def _roll(i: int) -> dict[str, Any]:
    return {"event_index": i, "event_type": "roll", "data": {"dice": [1, 2, 3, 4, 5]}}


async def _stored(gid: str) -> list[tuple[int, str]]:
    async with get_session_factory()() as db:
        rows = await db.execute(
            select(GameEvent.event_index, EventType.name)
            .join(EventType, EventType.id == GameEvent.event_type_id)
            .where(GameEvent.game_id == uuid.UUID(gid))
            .order_by(GameEvent.event_index)
        )
        return [tuple(r) for r in rows]


async def _metadata(gid: str) -> dict:
    from db.models import Game

    async with get_session_factory()() as db:
        game = await db.get(Game, uuid.UUID(gid))
        assert game is not None
        return game.game_metadata


async def test_a_game_switched_off_drops_replay_rows_with_a_paused_cut_and_keeps_lifecycle(
    client: TestClient, yacht_entitled: str
) -> None:
    sid = yacht_entitled
    gid = _new_game(client, sid)
    start = {"event_index": 0, "event_type": "game_started", "data": {}}
    assert _post(client, sid, gid, [start, _roll(1)])["accepted"] == 2
    await _set_dial("yacht", enabled=False)
    end = {"event_index": 4, "event_type": "game_ended", "data": {}}
    body = _post(client, sid, gid, [_roll(2), _roll(3), end])
    assert body["accepted"] == 1 and body["dropped"] == 2
    assert await _stored(gid) == [(0, "game_started"), (1, "roll"), (4, "game_ended")]
    metadata = await _metadata(gid)
    assert metadata[REPLAY_CUTOFF_KEY] == 2 and metadata[REPLAY_PAUSED_KEY] is True


async def test_another_games_switch_does_not_touch_this_game(
    client: TestClient, yacht_entitled: str
) -> None:
    sid = yacht_entitled
    gid = _new_game(client, sid)
    await _set_dial("hearts", enabled=False)
    await _set_dial("yacht", rate=0.0)  # the rate is never enforced here (D3-A)
    assert _post(client, sid, gid, [_roll(1), _roll(2)])["accepted"] == 2


def test_replay_recording_on_needs_both_switches(monkeypatch: pytest.MonkeyPatch) -> None:
    row = catalog_cache.GameTypeRow(1, "yacht", "Yacht", None, 1, True, False, "dice", True, 0.1)
    off = catalog_cache.GameTypeRow(1, "yacht", "Yacht", None, 1, True, False, "dice", False, 0.1)
    assert sessions.replay_recording_on(row) is True
    assert sessions.replay_recording_on(off) is False
    assert sessions.replay_recording_on(None) is True  # an unknown type: the env alone
    monkeypatch.setattr(sessions, "_settings", Settings.isolated(REPLAY_RECORDING_ENABLED=False))
    assert sessions.replay_recording_on(row) is False


# ---------------------------------------------------------------------------
# The 90 % budget trigger turns sampling down (D1-A)
# ---------------------------------------------------------------------------


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    calls: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda m, **kw: calls.append((m, kw)))
    return calls


async def _check(events_mb: int) -> None:
    async def measure(_session) -> StorageSize:
        return StorageSize(events_bytes=events_mb * MB, database_bytes=20 * MB)

    async with get_session_factory()() as db:
        await check_storage_budget(db, budget=100 * MB, plan=500 * MB, measure=measure)


async def test_at_90_percent_every_rate_goes_to_zero_and_the_one_report_says_so(sent) -> None:
    await _set_dial("hearts", rate=0.5)
    before = await _rates()
    assert len(before) > 1
    await _check(90)
    assert set((await _rates()).values()) == {replay_storage.BUDGET_TURN_DOWN_RATE}
    assert len(sent) == 1  # no event of its own: it rides on the 90 % report
    context = sent[0][1]["contexts"]["replay_storage"]
    assert context["sample_rates_lowered"] == len(before)
    # Run again: nothing left to lower, still one report per run.
    await _check(95)
    assert sent[1][1]["contexts"]["replay_storage"]["sample_rates_lowered"] == 0


async def test_below_90_percent_the_rates_are_left_alone(sent) -> None:
    before = await _rates()
    await _check(89)
    assert await _rates() == before
    assert "sample_rates_lowered" not in sent[0][1]["contexts"]["replay_storage"]


async def test_the_turn_down_only_lowers(monkeypatch: pytest.MonkeyPatch, sent) -> None:
    """With a non-zero turn-down rate, a game already below it is not raised."""
    monkeypatch.setattr(replay_storage, "BUDGET_TURN_DOWN_RATE", 0.05)
    await _set_dial("hearts", rate=0.01)
    await _check(90)
    rates = await _rates()
    assert rates["hearts"] == 0.01
    assert rates["yacht"] == 0.05


async def test_the_turn_down_invalidates_the_catalog_cache(sent) -> None:
    async with get_session_factory()() as db:
        cached = await catalog_cache.get_game_type(db, "yacht")
    assert cached is not None and round(cached.replay_sample_rate, 4) == 0.1
    await _check(90)
    async with get_session_factory()() as db:
        fresh = await catalog_cache.get_game_type(db, "yacht")
    assert fresh is not None and fresh.replay_sample_rate == 0.0


async def test_a_failed_turn_down_still_reports(monkeypatch: pytest.MonkeyPatch, sent) -> None:
    async def boom(_session):
        raise RuntimeError("db down")

    real = replay_storage.turn_down_sampling

    async def failing(session):
        monkeypatch.setattr(session, "execute", boom)
        return await real(session)

    monkeypatch.setattr(replay_storage, "turn_down_sampling", failing)
    await _check(90)
    assert len(sent) == 1
    assert sent[0][1]["contexts"]["replay_storage"]["sample_rates_lowered"] is None


# ---------------------------------------------------------------------------
# D5 (#3353): the app's sample-exempt types are the retention keep-list
# ---------------------------------------------------------------------------

_EVENT_QUEUE_CONFIG = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "game"
    / "_shared"
    / "eventQueueConfig.ts"
)


def app_retention_keep_types(text: str) -> set[str]:
    """``RETENTION_KEEP_TYPES`` from eventQueueConfig.ts, read as text."""
    m = re.search(r"export const RETENTION_KEEP_TYPES\b[^=]*=\s*\[([^\]]*)\]", text)
    assert m, "RETENTION_KEEP_TYPES not found: has eventQueueConfig.ts changed shape?"
    return set(re.findall(r'"([^"]+)"', m.group(1)))


def test_the_apps_sample_exempt_types_are_the_retention_keep_list() -> None:
    """A sampled-out session uploads exactly what retention keeps (D5)."""
    app = app_retention_keep_types(_EVENT_QUEUE_CONFIG.read_text())
    assert app == set(RETENTION_KEEP_NAMES)


def test_the_keep_list_parser_reads_the_literal() -> None:
    text = 'export const RETENTION_KEEP_TYPES: readonly string[] = ["a", "b"];'
    assert app_retention_keep_types(text) == {"a", "b"}


# ---------------------------------------------------------------------------
# scripts/replay_game.py names a sampled-out session
# ---------------------------------------------------------------------------


def _replay_game_module():
    import importlib.util
    import sys

    path = Path(__file__).parent.parent / "scripts" / "replay_game.py"
    spec = importlib.util.spec_from_file_location("replay_game_dial", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["replay_game_dial"] = module
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    ("block", "line"),
    [
        (
            {"m": "s", "u": 13, "n": 26, "b": 15872},
            (
                "  replay     summary only (not sampled: gameplay events were not uploaded)"
                " (u=13, n=26, b=15872)"
            ),
        ),
        ({"m": "f", "up": "bug"}, "  replay     full, upgraded on bug"),
        ({"m": "?"}, "  replay     unknown mode '?'"),
        (None, None),
    ],
)
def test_replay_game_prints_the_sampling_mode(block: dict | None, line: str | None) -> None:
    rg = _replay_game_module()
    game = rg.GameRow(uuid.uuid4(), "yacht", None, None, "completed", 10, None, {})
    ended = {"final_score": 10} if block is None else {"final_score": 10, "replay": block}
    events = [
        rg.EventRow(0, "game_started", None, {}),
        rg.EventRow(7, "game_ended", None, ended),
    ]
    text = rg.render(game, events)
    replay_lines = [ln for ln in text.splitlines() if ln.startswith("  replay ")]
    assert replay_lines == ([] if line is None else [line])


# ---------------------------------------------------------------------------
# Migration 0036
# ---------------------------------------------------------------------------

_BEFORE = "0035_games_event_counters"
_REVISION = "0036_game_types_replay_dial"


def _columns(db_path: Path) -> dict[str, tuple[str, int, str | None]]:
    with sqlite3.connect(db_path) as conn:
        return {
            row[1]: (row[2], row[3], row[4])
            for row in conn.execute("PRAGMA table_info(game_types)")
        }


def test_migration_0036_upgrades_with_the_defaults_and_downgrades_cleanly(
    migration_db_path: Path, alembic: Alembic
) -> None:
    alembic("upgrade", _BEFORE)
    assert "replay_enabled" not in _columns(migration_db_path)
    with sqlite3.connect(migration_db_path) as conn:
        types_before = conn.execute("SELECT COUNT(*) FROM game_types").fetchone()[0]
        events_before = conn.execute("SELECT COUNT(*) FROM event_types").fetchone()[0]

    alembic("upgrade", _REVISION)
    cols = _columns(migration_db_path)
    assert cols["replay_enabled"][1] == 1 and cols["replay_sample_rate"][1] == 1  # NOT NULL
    with sqlite3.connect(migration_db_path) as conn:
        rows = conn.execute("SELECT replay_enabled, replay_sample_rate FROM game_types").fetchall()
        assert len(rows) == types_before
        assert {(int(e), round(r, 4)) for e, r in rows} == {(1, 0.1)}
        # The CHECK is the rate's cap.
        for bad in (1.5, -0.1):
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute("UPDATE game_types SET replay_sample_rate = ?", (bad,))
        conn.execute("UPDATE game_types SET replay_sample_rate = 1")
        conn.execute("UPDATE game_types SET replay_sample_rate = 0")
        conn.rollback()

    alembic("downgrade", "-1")
    cols = _columns(migration_db_path)
    assert "replay_enabled" not in cols and "replay_sample_rate" not in cols
    with sqlite3.connect(migration_db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM game_types").fetchone()[0] == types_before
        assert conn.execute("SELECT COUNT(*) FROM event_types").fetchone()[0] == events_before
    # And up again: the downgrade left nothing behind that blocks a re-run.
    alembic("upgrade", _REVISION)
    assert "replay_sample_rate" in _columns(migration_db_path)

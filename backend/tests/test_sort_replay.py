"""Bottle Sort ``moves`` event: schema, validation hook, storage, caps (#3387).

The app records a level as ``moves`` events (chunks of up to 25 actions, with
the GameRecorder's envelope) after a ``game_started`` that carries the level and
catalog version (``sort/replay.py``). A bad event is dropped, never the batch.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import logging
import re
import sqlite3
import uuid
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from db.base import get_session_factory
from db.models import GameEntitlement, GameEvent
from games.registry import get_module
from games.replay_caps import (
    DEFAULT_CAP,
    ROW_OVERHEAD_BYTES,
    SORT_CAP,
    SORT_MAX_UNITS,
    ReplayCap,
    cap_for,
)
from main import app
from observability import report
from payload_size import jsonb_bytes
from sort import replay as replay_module
from sort.catalog import CATALOG_VERSION, LEVEL_COUNT
from sort.models import SortResult
from sort.module import module as sort_module
from sort.replay import (
    MAX_ACTIONS_PER_EVENT,
    MAX_BOTTLES,
    MAX_MOVES_BYTES,
    MAX_REWIND,
    validate_moves,
)
from tests._helpers import session_headers as _headers
from tests._migration_helpers import Alembic

client = TestClient(app)

_ROOT = Path(__file__).resolve().parents[2]
_SID = str(uuid.uuid4())


@pytest.fixture(autouse=True)
def _fresh_drop_throttles(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each test starts with no report throttled by an earlier one."""
    monkeypatch.setattr(replay_module, "_drop_throttles", {})


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    """Sentry messages, captured: a dropped event reports once, by reason only."""
    calls: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda m, **kw: calls.append((m, kw)))
    return calls


# A chunk as the app builds it, by hand: a pour, an undo, a hint, a rewind, a pour.
_REAL = {
    "v": 1,
    "unit": 3,
    "t_ms": 91_234,
    "m": [[0, 2, 5], [1], [2, 0, 15], [3, 4], [0, 15, 0]],
}


def _with(**changes: Any) -> dict[str, Any]:
    data = copy.deepcopy(_REAL)
    data.update(changes)
    return data


# ---------------------------------------------------------------------------
# valid payloads
# ---------------------------------------------------------------------------


def test_accepts_every_kind_of_action_and_stores_the_event_as_sent(sent: list) -> None:
    assert validate_moves(copy.deepcopy(_REAL)) == _REAL
    assert sent == []


@pytest.mark.parametrize(
    "action",
    [
        [0, 0, 1],
        [0, 15, 14],
        [1],
        [2, 3, 4],
        [2, 15, 0],
        [3, 1],
        [3, MAX_REWIND],
    ],
)
def test_accepts_each_action_at_its_bounds(action: list[int]) -> None:
    assert validate_moves(_with(m=[action])) is not None


def test_accepts_a_partial_chunk_and_the_part_fields() -> None:
    assert validate_moves(_with(m=[[1]], unit=1)) is not None
    assert validate_moves(_with(part=0, parts=2)) is not None
    assert validate_moves(_with(part=1, parts=2)) is not None


def test_accepts_the_largest_chunk_the_app_can_send() -> None:
    worst = {"v": 1, "unit": 9_999, "t_ms": 7_200_000, "m": [[0, 15, 14]] * 25}
    assert len(json.dumps(worst, separators=(",", ":"))) <= MAX_MOVES_BYTES
    assert validate_moves(worst) == worst


def test_the_module_checks_moves_and_passes_everything_else_through() -> None:
    assert get_module("sort") is sort_module
    assert sort_module.validate_event("moves", copy.deepcopy(_REAL)) == _REAL
    assert sort_module.validate_event("moves", {}) is None
    assert sort_module.validate_event("game_ended", {"a": 1}) == {"a": 1}


# ---------------------------------------------------------------------------
# lifecycle and result payloads stay compatible
# ---------------------------------------------------------------------------


def test_game_started_with_the_replay_keys_and_without_them_passes_through() -> None:
    started = {"level": 7, "catalog": CATALOG_VERSION, "engine_version": 1}
    assert sort_module.validate_event("game_started", dict(started)) == started
    old = {"level": 7}  # builds from before the replay
    assert sort_module.validate_event("game_started", dict(old)) == old


def test_an_existing_shape_result_still_validates() -> None:
    result = SortResult.model_validate(
        {
            "level": 12,
            "moves": 20,
            "undos": 1,
            "level_reached": 12,
            "total_moves": 250,
            "catalog_version": CATALOG_VERSION,
            "stars": 3,
            "won": True,
        }
    )
    assert result.level_reached == 12
    assert SortResult.model_validate({"level": 3, "moves": 5, "won": False}).won is False
    assert SortResult.model_validate({}).level is None


# ---------------------------------------------------------------------------
# malformed payloads
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    [
        pytest.param(_with(v=2), id="unknown-version"),
        pytest.param(_with(v=True), id="version-true"),
        pytest.param(_with(v=1.0), id="version-float"),
        pytest.param({k: v for k, v in _REAL.items() if k != "v"}, id="no-version"),
        pytest.param({k: v for k, v in _REAL.items() if k != "m"}, id="no-actions"),
        pytest.param(_with(m=[]), id="empty-chunk"),
        pytest.param(_with(m="pour"), id="actions-not-a-list"),
        pytest.param(_with(m=[[]]), id="empty-action"),
        pytest.param(_with(m=[[4]]), id="unknown-kind"),
        pytest.param(_with(m=[[-1, 1, 2]]), id="negative-kind"),
        pytest.param(_with(m=[[0, 1]]), id="pour-too-short"),
        pytest.param(_with(m=[[0, 1, 2, 3]]), id="pour-too-long"),
        pytest.param(_with(m=[[0]]), id="pour-without-bottles"),
        pytest.param(_with(m=[[2, 1]]), id="hint-too-short"),
        pytest.param(_with(m=[[2, 1, 2, 3]]), id="hint-too-long"),
        pytest.param(_with(m=[[1, 0]]), id="undo-with-operand"),
        pytest.param(_with(m=[[3]]), id="rewind-without-n"),
        pytest.param(_with(m=[[3, 1, 2]]), id="rewind-too-long"),
        pytest.param(_with(m=[[0, MAX_BOTTLES, 1]]), id="pour-from-off-the-board"),
        pytest.param(_with(m=[[0, 1, MAX_BOTTLES]]), id="pour-to-off-the-board"),
        pytest.param(_with(m=[[0, -1, 1]]), id="negative-from"),
        pytest.param(_with(m=[[0, 1, -1]]), id="negative-to"),
        pytest.param(_with(m=[[0, 4, 4]]), id="pour-onto-itself"),
        pytest.param(_with(m=[[2, MAX_BOTTLES, 1]]), id="hint-from-off-the-board"),
        pytest.param(_with(m=[[2, 1, MAX_BOTTLES]]), id="hint-to-off-the-board"),
        pytest.param(_with(m=[[2, 6, 6]]), id="hint-onto-itself"),
        pytest.param(_with(m=[[3, 0]]), id="rewind-zero"),
        pytest.param(_with(m=[[3, -1]]), id="rewind-negative"),
        pytest.param(_with(m=[[3, MAX_REWIND + 1]]), id="rewind-too-far"),
        pytest.param(_with(m=[[0, 1.5, 2]]), id="fractional-bottle"),
        pytest.param(_with(m=[[0.0, 1, 2]]), id="float-kind"),
        pytest.param(_with(m=[[True, 1, 2]]), id="bool-kind"),
        pytest.param(_with(m=[[0, True, 2]]), id="bool-bottle"),
        pytest.param(_with(m=[[3, True]]), id="bool-rewind"),
        pytest.param(_with(m=[["0", 1, 2]]), id="string-kind"),
        pytest.param(_with(m=[[0, "1", 2]]), id="string-bottle"),
        pytest.param(_with(m=[None]), id="null-action"),
        pytest.param(_with(m=[7]), id="bare-number"),
        pytest.param(_with(m=["u"]), id="a-mahjong-action"),
        pytest.param(_with(m=[{"s": [1, 0]}]), id="object-action"),
        pytest.param(_with(unit=0), id="unit-zero"),
        pytest.param(_with(unit=-1), id="negative-unit"),
        pytest.param(_with(t_ms=-5), id="negative-time"),
        pytest.param(_with(t_ms="soon"), id="time-not-a-number"),
        pytest.param(_with(extra=1), id="unknown-key"),
        pytest.param(_with(actor={"seat": 0}), id="actor-key"),
        pytest.param(_with(part=-1, parts=2), id="negative-part"),
        pytest.param(_with(part=0, parts=1), id="a-split-of-one-part"),
        pytest.param(_with(part=2, parts=2), id="part-not-below-parts"),
        pytest.param(_with(part=0), id="part-without-parts"),
        pytest.param(_with(parts=2), id="parts-without-part"),
    ],
)
def test_rejects_a_malformed_payload(bad: dict[str, Any], sent: list) -> None:
    assert validate_moves(bad) is None
    # one report, by reason: neither the bottles nor the unit reach Sentry
    assert len(sent) == 1
    assert "invalid" in sent[0][0]


def test_rejects_more_actions_than_a_chunk_can_hold() -> None:
    assert validate_moves(_with(m=[[0, 0, 1]] * (MAX_ACTIONS_PER_EVENT + 1))) is None
    assert validate_moves(_with(m=[[0, 0, 1]] * MAX_ACTIONS_PER_EVENT)) is not None


def test_rejects_an_oversized_payload_by_bytes(sent: list) -> None:
    # Within the action-count bound but over the byte cap: a padded, hostile payload.
    huge = {"v": 1, "unit": 1, "t_ms": 1, "m": [[1]], "pad": "x" * MAX_MOVES_BYTES}
    assert validate_moves(huge) is None
    assert len(sent) == 1
    assert "oversize" in sent[0][0]


def test_drop_reports_are_throttled_per_reason_not_sent_per_event(
    sent: list, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING, logger="sort.replay"):
        for _ in range(50):
            assert validate_moves(_with(m=[[0, 5, 5]])) is None
        for _ in range(50):
            assert (
                validate_moves({"v": 1, "unit": 1, "t_ms": 1, "m": [[1]], "pad": "x" * 3000})
                is None
            )
    # one report for "invalid", one for "oversize"; every drop is still logged
    assert [m for m, _ in sent] == ["sort event: moves invalid", "sort event: moves oversize"]
    assert caplog.text.count("dropped an") == 100


def test_an_unserialisable_payload_is_dropped_not_raised() -> None:
    assert validate_moves({"v": 1, "m": [object()]}) is None


def test_drop_reports_carry_no_player_data(sent: list) -> None:
    bad = _with(m=[[0, 13, 13]], unit=777)
    assert validate_moves(bad) is None
    text = json.dumps(sent, default=str)
    assert "13" not in text
    assert "777" not in text


# ---------------------------------------------------------------------------
# agreement with the app
# ---------------------------------------------------------------------------


def test_the_byte_cap_matches_the_apps_registry() -> None:
    ts = (_ROOT / "frontend" / "src" / "game" / "_shared" / "eventQueueConfig.ts").read_text(
        encoding="utf-8"
    )
    m = re.search(r"export const SORT_MOVES_MAX_BYTES\s*=\s*(\d+)\s*;", ts)
    assert m is not None, "SORT_MOVES_MAX_BYTES is missing from eventQueueConfig.ts"
    assert int(m.group(1)) == MAX_MOVES_BYTES


def test_no_catalog_level_has_more_bottles_than_the_replay_allows() -> None:
    catalog = json.loads(
        (_ROOT / "frontend" / "src" / "game" / "sort" / "levels.catalog.json").read_text(
            encoding="utf-8"
        )
    )
    sizes = [len(level[0].split(",")) for level in catalog["levels"]]
    assert len(sizes) == LEVEL_COUNT
    assert max(sizes) == MAX_BOTTLES  # the figure is the catalog's largest level, not slack


# ---------------------------------------------------------------------------
# storage and the caps
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
async def _entitlements():
    async with get_session_factory()() as db:
        db.add(GameEntitlement(session_id=_SID, game_slug="sort"))
        await db.commit()


def _new_game(game_type: str = "sort") -> str:
    r = client.post("/games", headers=_headers(_SID), json={"game_type": game_type})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _post(gid: str, events: list[dict]):
    return client.post(f"/games/{gid}/events", headers=_headers(_SID), json={"events": events})


async def _stored(gid: str) -> list[GameEvent]:
    async with get_session_factory()() as db:
        rows = await db.execute(
            select(GameEvent)
            .where(GameEvent.game_id == uuid.UUID(gid))
            .order_by(GameEvent.event_index)
        )
        return list(rows.scalars())


async def test_a_level_is_stored_whole_with_its_started_and_ended_rows() -> None:
    started = {"level": 4, "catalog": CATALOG_VERSION, "engine_version": 1}
    gid = _new_game()
    r = _post(
        gid,
        [
            {"event_index": 0, "event_type": "game_started", "data": started},
            {"event_index": 1, "event_type": "moves", "data": _REAL},
            {"event_index": 2, "event_type": "game_ended", "data": {"moves": 20}},
        ],
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 3, "duplicates": 0, "rejected": [], "dropped": 0}
    rows = await _stored(gid)
    assert [e.data for e in rows] == [started, _REAL, {"moves": 20}]


async def test_a_mixed_batch_stores_the_valid_events_and_drops_the_bad_one(
    sent: list, caplog: pytest.LogCaptureFixture
) -> None:
    gid = _new_game()
    with caplog.at_level(logging.WARNING, logger="sort.replay"):
        r = _post(
            gid,
            [
                {"event_index": 0, "event_type": "moves", "data": _REAL},
                {"event_index": 1, "event_type": "moves", "data": _with(m=[[0, 5, 5]])},
                {"event_index": 2, "event_type": "game_ended", "data": {"moves": 10}},
            ],
        )
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 2, "duplicates": 0, "rejected": [], "dropped": 0}
    rows = await _stored(gid)
    assert [e.event_index for e in rows] == [0, 2]
    assert rows[0].data == _REAL
    assert "dropped an invalid moves event" in caplog.text
    assert [m for m, _ in sent] == ["sort event: moves invalid"]


def test_moves_is_not_an_event_type_of_other_games_that_have_not_seeded_it() -> None:
    gid = _new_game("yacht")
    r = _post(gid, [{"event_index": 0, "event_type": "moves", "data": _REAL}])
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# the per-game cap
# ---------------------------------------------------------------------------


def test_the_sort_cap_is_twelve_rows_of_the_byte_cap_plus_overhead() -> None:
    # the arithmetic in games/replay_caps.py
    assert SORT_MAX_UNITS == 12
    assert cap_for("sort") is SORT_CAP
    assert ReplayCap(12, 12 * (MAX_MOVES_BYTES + ROW_OVERHEAD_BYTES)) == SORT_CAP
    assert SORT_CAP.max_bytes == 14_688
    assert SORT_CAP.max_events < DEFAULT_CAP.max_events


def test_a_levels_worst_honest_rows_fit_the_cap_with_room_to_spare() -> None:
    widest = {"v": 1, "unit": SORT_MAX_UNITS, "t_ms": 7_200_000, "m": [[0, 15, 14]] * 25}
    assert len(json.dumps(widest, separators=(",", ":"))) == 288
    assert jsonb_bytes(widest) == 369
    stored = SORT_MAX_UNITS * (jsonb_bytes(widest) + ROW_OVERHEAD_BYTES)
    assert stored == 6_828  # the figure in games/replay_caps.py
    assert stored <= SORT_CAP.max_bytes // 2
    # and a row at the byte cap still fits twelve times over
    assert SORT_CAP.max_bytes >= SORT_MAX_UNITS * (MAX_MOVES_BYTES + ROW_OVERHEAD_BYTES)


# ---------------------------------------------------------------------------
# migration 0047
# ---------------------------------------------------------------------------

_REVISION = "0047_sort_replay_events"
_SORT = 12


def _parent_revision() -> str:
    """The revision 0047 sits on now: it is re-pointed when the chain is merged."""
    path = Path(__file__).parent.parent / "alembic" / "versions" / f"{_REVISION}.py"
    spec = importlib.util.spec_from_file_location("sort_replay_migration", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert isinstance(module.down_revision, str)
    return module.down_revision


def test_the_migration_chain_has_a_single_head() -> None:
    from tests._alembic_heads import multiple_heads_message, script_heads

    heads = script_heads()
    assert len(heads) == 1, multiple_heads_message(heads)


def _event_names(db_path: Path) -> list[str]:
    with sqlite3.connect(db_path) as conn:
        return [
            r[0]
            for r in conn.execute(
                "SELECT name FROM event_types WHERE game_type_id = ? ORDER BY name", (_SORT,)
            )
        ]


def test_the_migration_adds_and_removes_only_the_moves_event(
    migration_db_path: Path, alembic: Alembic
) -> None:
    alembic("upgrade", _parent_revision())
    before = _event_names(migration_db_path)
    assert "moves" not in before

    alembic("upgrade", _REVISION)
    with sqlite3.connect(migration_db_path) as conn:
        row = conn.execute(
            "SELECT display_name FROM event_types WHERE game_type_id = ? AND name = 'moves'",
            (_SORT,),
        ).fetchone()
        # a stored moves event, to prove the downgrade clears its dependants
        et = conn.execute(
            "SELECT id FROM event_types WHERE game_type_id = ? AND name = 'moves'", (_SORT,)
        ).fetchone()[0]
        keep = conn.execute(
            "SELECT id FROM event_types WHERE game_type_id = ? AND name = 'game_ended'",
            (_SORT,),
        ).fetchone()[0]
        gid = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO games (id, session_id, game_type_id, metadata) VALUES (?, 's', ?, '{}')",
            (gid, _SORT),
        )
        for idx, type_id in ((0, et), (1, keep)):
            conn.execute(
                "INSERT INTO game_events (game_id, event_index, event_type_id, data) "
                "VALUES (?, ?, ?, '{}')",
                (gid, idx, type_id),
            )
    assert row == ("Moves",)
    assert _event_names(migration_db_path) == sorted([*before, "moves"])

    alembic("downgrade", "-1")
    assert _event_names(migration_db_path) == before
    with sqlite3.connect(migration_db_path) as conn:
        assert conn.execute("SELECT event_index FROM game_events").fetchall() == [(1,)]


def test_the_migration_leaves_other_games_event_types_alone(
    migration_db_path: Path, alembic: Alembic
) -> None:
    alembic("upgrade", _parent_revision())
    with sqlite3.connect(migration_db_path) as conn:
        before = conn.execute(
            "SELECT game_type_id, name FROM event_types ORDER BY game_type_id, name"
        ).fetchall()
    alembic("upgrade", _REVISION)
    with sqlite3.connect(migration_db_path) as conn:
        after = conn.execute(
            "SELECT game_type_id, name FROM event_types ORDER BY game_type_id, name"
        ).fetchall()
    assert sorted(after) == sorted([*before, (_SORT, "moves")])

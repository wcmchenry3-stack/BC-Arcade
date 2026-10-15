"""Mahjong ``moves`` event: schema, validation hook, storage, caps (#3285).

The app (``frontend/src/game/mahjong/replay.ts``) records a game as ``moves``
events — chunks of up to 25 actions, with the GameRecorder's envelope — after
a ``game_started`` that carries the deal's layout and seed.
``fixtures/mahjong_replay_v1.json`` holds the events the app really builds
(``replay.fixture.test.ts`` holds it equal to what the engine records today),
so a rejection here would drop a real game's replay.
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
from games.replay_caps import DEFAULT_CAP, ROW_OVERHEAD_BYTES
from mahjong import replay as replay_module
from mahjong.module import module as mahjong_module
from mahjong.replay import (
    MAX_ACTIONS_PER_EVENT,
    MAX_MOVES_BYTES,
    MAX_TILES,
    validate_moves,
)
from main import app
from observability import report
from payload_size import jsonb_bytes
from tests._helpers import session_headers as _headers
from tests._migration_helpers import Alembic

client = TestClient(app)

_FIXTURE = Path(__file__).parent / "fixtures" / "mahjong_replay_v1.json"
_SID = str(uuid.uuid4())


def _games() -> dict[str, Any]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _fixture_events() -> list[tuple[str, dict[str, Any]]]:
    return [
        (f"{name}[{i}]", e["data"])
        for name, game in _games().items()
        for i, e in enumerate(game["events"])
    ]


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


# A chunk as the app builds it, by hand: a match, an undo, a hint, a shuffle, a stuck shuffle.
_SHUFFLE = {"s": [1, 0, 3, 2], "f": [5, 5, 9, 9]}
_REAL = {"v": 1, "unit": 3, "t_ms": 91_234, "m": [[3, 90], "u", "h", _SHUFFLE, "s", [143, 0]]}


def _with(**changes: Any) -> dict[str, Any]:
    data = copy.deepcopy(_REAL)
    data.update(changes)
    return data


# ---------------------------------------------------------------------------
# the real payloads
# ---------------------------------------------------------------------------


def test_the_fixture_holds_every_kind_of_entry_and_a_cleared_game() -> None:
    kinds: set[str] = set()
    for _, data in _fixture_events():
        for entry in data["m"]:
            kinds.add(
                "match"
                if isinstance(entry, list)
                else "shuffle" if isinstance(entry, dict) else entry
            )
    assert kinds == {"match", "u", "h", "shuffle"}
    cleared = _games()["turtle_cleared"]
    matches = [e for ev in cleared["events"] for e in ev["data"]["m"] if isinstance(e, list)]
    assert len(matches) >= 72  # a cleared board is 72 pairs (undone ones are matched again)
    assert cleared["game_started"] == {"layout": "turtle", "engine_version": 1, "seed": 42}


@pytest.mark.parametrize(("name", "data"), _fixture_events())
def test_validate_accepts_the_events_the_app_builds_and_stores_them_as_sent(
    name: str, data: dict[str, Any], sent: list
) -> None:
    assert validate_moves(copy.deepcopy(data)) == data, name
    assert sent == []


@pytest.mark.parametrize(("name", "data"), _fixture_events())
def test_every_real_event_is_under_the_byte_cap(name: str, data: dict[str, Any]) -> None:
    assert len(json.dumps(data, separators=(",", ":"))) <= MAX_MOVES_BYTES, name


def test_the_module_checks_moves_and_passes_everything_else_through() -> None:
    assert get_module("mahjong") is mahjong_module
    assert mahjong_module.validate_event("moves", copy.deepcopy(_REAL)) == _REAL
    assert mahjong_module.validate_event("moves", {}) is None
    started = {"layout": "turtle", "engine_version": 1, "seed": 42}
    assert mahjong_module.validate_event("game_started", dict(started)) == started
    assert mahjong_module.validate_event("game_ended", {"a": 1}) == {"a": 1}


def test_accepts_a_partial_chunk_a_single_action_and_the_part_fields() -> None:
    assert validate_moves(_with(m=[[0, 1]])) is not None
    assert validate_moves(_with(m=["h"])) is not None
    assert validate_moves(_with(part=0, parts=2)) is not None


def test_accepts_the_largest_chunk_the_app_can_send() -> None:
    worst = {
        "v": 1,
        "unit": 9_999,
        "t_ms": 7_200_000,
        "m": [[142, 143]] * 24 + [{"s": list(range(MAX_TILES)), "f": [42] * MAX_TILES}],
    }
    assert len(json.dumps(worst, separators=(",", ":"))) <= MAX_MOVES_BYTES
    assert validate_moves(worst) == worst


# ---------------------------------------------------------------------------
# malformed payloads
# ---------------------------------------------------------------------------

_EVEN_PERM = {"s": [1, 0], "f": [3, 3]}


@pytest.mark.parametrize(
    "bad",
    [
        pytest.param(_with(v=2), id="unknown-version"),
        pytest.param(_with(v=True), id="version-true"),
        pytest.param(_with(v=1.0), id="version-float"),
        pytest.param({k: v for k, v in _REAL.items() if k != "v"}, id="no-version"),
        pytest.param({k: v for k, v in _REAL.items() if k != "m"}, id="no-actions"),
        pytest.param(_with(m=[]), id="empty-chunk"),
        pytest.param(_with(m="uuh"), id="actions-not-a-list"),
        pytest.param(_with(m=[[3, 144]]), id="tile-off-the-board"),
        pytest.param(_with(m=[[-1, 4]]), id="negative-tile"),
        pytest.param(_with(m=[[5, 5]]), id="a-tile-matched-with-itself"),
        pytest.param(_with(m=[[1, 2, 3]]), id="long-pair"),
        pytest.param(_with(m=[[1]]), id="short-pair"),
        pytest.param(_with(m=[[1.5, 2]]), id="fractional-tile"),
        pytest.param(_with(m=[[True, 2]]), id="bool-tile"),
        pytest.param(_with(m=[["a", "b"]]), id="tile-names"),
        pytest.param(_with(m=["x"]), id="unknown-action"),
        pytest.param(_with(m=["U"]), id="undo-in-capitals"),
        pytest.param(_with(m=[None]), id="null-action"),
        pytest.param(_with(m=[7]), id="bare-number"),
        pytest.param(_with(m=[{"s": [1, 0]}]), id="shuffle-without-faces"),
        pytest.param(_with(m=[{"f": [3, 3]}]), id="shuffle-without-positions"),
        pytest.param(_with(m=[{"s": [1, 0], "f": [3]}]), id="shuffle-lengths-differ"),
        pytest.param(_with(m=[{"s": [1, 1], "f": [3, 3]}]), id="shuffle-reuses-a-position"),
        pytest.param(_with(m=[{"s": [2, 3], "f": [3, 3]}]), id="shuffle-not-a-local-permutation"),
        pytest.param(_with(m=[{"s": [0, 2], "f": [3, 3]}]), id="shuffle-skips-a-position"),
        pytest.param(_with(m=[{"s": [1, 2, 3, 4], "f": [3, 3, 4, 4]}]), id="shuffle-shifted"),
        pytest.param(_with(m=[{"s": [0], "f": [3]}]), id="shuffle-of-one-tile"),
        pytest.param(_with(m=[{"s": [0, 1, 2], "f": [3, 3, 4]}]), id="shuffle-of-odd-tiles"),
        pytest.param(_with(m=[{"s": [1, 144], "f": [3, 3]}]), id="shuffle-position-off-board"),
        pytest.param(_with(m=[{"s": [1, 0], "f": [0, 3]}]), id="face-zero"),
        pytest.param(_with(m=[{"s": [1, 0], "f": [43, 3]}]), id="face-past-the-set"),
        pytest.param(_with(m=[{**_EVEN_PERM, "x": 1}]), id="shuffle-unknown-key"),
        pytest.param(_with(m=[{"s": [], "f": []}]), id="shuffle-empty"),
        pytest.param(_with(unit=-1), id="negative-unit"),
        pytest.param(_with(t_ms=-5), id="negative-time"),
        pytest.param(_with(t_ms="soon"), id="time-not-a-number"),
        pytest.param(_with(extra=1), id="unknown-key"),
        pytest.param(_with(actor={"seat": 0, "kind": "human"}), id="actor-key"),
        pytest.param(_with(part=-1), id="negative-part"),
        pytest.param(_with(parts=0), id="zero-parts"),
    ],
)
def test_rejects_a_malformed_payload(bad: dict[str, Any], sent: list) -> None:
    assert validate_moves(bad) is None
    # one report, by reason: neither the tiles nor the unit reach Sentry
    assert len(sent) == 1
    assert "invalid" in sent[0][0]


def test_rejects_more_actions_than_a_chunk_can_hold() -> None:
    assert validate_moves(_with(m=[[0, 1]] * (MAX_ACTIONS_PER_EVENT + 1))) is None
    assert validate_moves(_with(m=[[0, 1]] * MAX_ACTIONS_PER_EVENT)) is not None


def test_rejects_an_oversized_payload_by_bytes(sent: list) -> None:
    # Within the action-count bound but over the byte cap: a padded, hostile payload.
    huge = {"v": 1, "unit": 1, "t_ms": 1, "m": ["h"], "pad": "x" * MAX_MOVES_BYTES}
    assert validate_moves(huge) is None
    assert len(sent) == 1
    assert "oversize" in sent[0][0]


def test_a_chunk_of_full_board_shuffles_is_over_the_cap(sent: list) -> None:
    """Why the app splits such a chunk on ``m``: three shuffles of 144 tiles do not fit."""
    shuffle = {"s": list(range(MAX_TILES)), "f": [42] * MAX_TILES}
    assert validate_moves(_with(m=[shuffle] * 3)) is None
    assert "oversize" in sent[0][0]
    assert validate_moves(_with(m=[shuffle])) is not None


def test_drop_reports_are_throttled_per_reason_not_sent_per_event(
    sent: list, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING, logger="mahjong.replay"):
        for _ in range(50):
            assert validate_moves(_with(m=[[5, 5]])) is None
        for _ in range(50):
            assert (
                validate_moves({"v": 1, "unit": 1, "t_ms": 1, "m": ["h"], "pad": "x" * 3000})
                is None
            )
    # one report for "invalid", one for "oversize"; every drop is still logged
    assert [m for m, _ in sent] == ["mahjong event: moves invalid", "mahjong event: moves oversize"]
    assert caplog.text.count("dropped an") == 100


def test_an_unserialisable_payload_is_dropped_not_raised() -> None:
    assert validate_moves({"v": 1, "m": [object()]}) is None


def test_drop_reports_carry_no_player_data(sent: list) -> None:
    bad = _with(m=[[424, 7]], unit=777)
    assert validate_moves(bad) is None
    text = json.dumps(sent, default=str)
    assert "424" not in text
    assert "777" not in text


def test_the_byte_cap_matches_the_apps_registry() -> None:
    ts = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "game"
        / "_shared"
        / "eventQueueConfig.ts"
    ).read_text(encoding="utf-8")
    m = re.search(r"export const MAHJONG_MOVES_MAX_BYTES\s*=\s*(\d+)\s*;", ts)
    assert m, "MAHJONG_MOVES_MAX_BYTES not found in eventQueueConfig.ts"
    assert int(m.group(1)) == MAX_MOVES_BYTES


def test_the_chunk_size_is_inside_the_actions_bound() -> None:
    ts = (
        Path(__file__).resolve().parents[2] / "frontend" / "src" / "game" / "mahjong" / "replay.ts"
    ).read_text(encoding="utf-8")
    m = re.search(r"export const ACTIONS_PER_CHUNK\s*=\s*(\d+)\s*;", ts)
    assert m, "ACTIONS_PER_CHUNK not found in mahjong/replay.ts"
    assert int(m.group(1)) <= MAX_ACTIONS_PER_EVENT


# ---------------------------------------------------------------------------
# storage and the caps
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
async def _entitlements():
    async with get_session_factory()() as db:
        db.add(GameEntitlement(session_id=_SID, game_slug="mahjong"))
        await db.commit()


def _new_game(game_type: str = "mahjong") -> str:
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


def _batch(game: dict[str, Any]) -> list[dict[str, Any]]:
    events = [{"event_index": 0, "event_type": "game_started", "data": game["game_started"]}]
    for i, e in enumerate(game["events"], start=1):
        events.append({"event_index": i, "event_type": e["type"], "data": e["data"]})
    return events


@pytest.mark.parametrize("name", ["turtle_cleared", "pyramid_short"])
async def test_a_real_game_is_stored_whole_with_its_seed(name: str) -> None:
    game = _games()[name]
    gid = _new_game()
    r = _post(gid, _batch(game))
    assert r.status_code == 200, r.text
    assert r.json() == {
        "accepted": len(game["events"]) + 1,
        "duplicates": 0,
        "rejected": [],
        "dropped": 0,
    }
    rows = await _stored(gid)
    assert [e.event_index for e in rows] == list(range(len(game["events"]) + 1))
    assert rows[0].data == game["game_started"]
    assert [e.data for e in rows[1:]] == [e["data"] for e in game["events"]]


async def test_a_mixed_batch_stores_the_valid_events_and_drops_the_bad_one(
    sent: list, caplog: pytest.LogCaptureFixture
) -> None:
    gid = _new_game()
    with caplog.at_level(logging.WARNING, logger="mahjong.replay"):
        r = _post(
            gid,
            [
                {"event_index": 0, "event_type": "moves", "data": _REAL},
                {"event_index": 1, "event_type": "moves", "data": _with(m=[[5, 5]])},
                {"event_index": 2, "event_type": "game_ended", "data": {"score": 10}},
            ],
        )
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 2, "duplicates": 0, "rejected": [], "dropped": 0}
    rows = await _stored(gid)
    assert [e.event_index for e in rows] == [0, 2]
    assert rows[0].data == _REAL
    assert "dropped an invalid moves event" in caplog.text
    assert [m for m, _ in sent] == ["mahjong event: moves invalid"]


def test_moves_is_not_an_event_type_of_other_games_that_have_not_seeded_it() -> None:
    gid = _new_game("yacht")
    r = _post(gid, [{"event_index": 0, "event_type": "moves", "data": _REAL}])
    assert r.status_code == 400


def test_a_cleared_game_costs_about_four_rows_and_four_kilobytes() -> None:
    """The figures in games/replay_caps.py and docs/games/mahjong.md (the fixture's cleared Turtle)."""
    rows = [e["data"] for e in _games()["turtle_cleared"]["events"]]
    assert len(rows) == 4
    assert sum(jsonb_bytes(d) for d in rows) == 3_655
    assert sum(jsonb_bytes(d) + ROW_OVERHEAD_BYTES for d in rows) == 4_455


def test_the_real_games_fit_the_default_cap_with_room_to_spare() -> None:
    """Mahjong has no cap of its own (``DEFAULT_CAP``): what a game stores is a few
    KB against 160 KB and 500 events (arithmetic in docs/games/mahjong.md)."""
    for name, game in _games().items():
        rows = [e["data"] for e in game["events"]]
        stored = sum(jsonb_bytes(d) + ROW_OVERHEAD_BYTES for d in rows)
        assert len(rows) <= DEFAULT_CAP.max_events // 50, name
        assert stored <= DEFAULT_CAP.max_bytes // 20, name


def _session_cap() -> int:
    ts = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "game"
        / "_shared"
        / "eventQueueConfig.ts"
    ).read_text(encoding="utf-8")
    m = re.search(r"export const MAHJONG_SESSION_MAX_BYTES\s*=\s*(\d+)\s*\*\s*(\d+)\s*;", ts)
    assert m, "MAHJONG_SESSION_MAX_BYTES not found in eventQueueConfig.ts"
    return int(m.group(1)) * int(m.group(2))


def _max_units() -> int:
    ts = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "game"
        / "_shared"
        / "eventQueueConfig.ts"
    ).read_text(encoding="utf-8")
    m = re.search(r"export const MAHJONG_MAX_UNITS\s*=\s*(\d+)\s*;", ts)
    assert m, "MAHJONG_MAX_UNITS not found in eventQueueConfig.ts"
    return int(m.group(1))


def test_a_game_of_one_action_chunks_ends_at_the_unit_cap_under_the_epics_40_kb() -> None:
    """Hint spam, or backgrounding the app after every action, makes small chunks:
    cheap in JSON but each row costs 200 B. The unit cap bounds the rows."""
    assert _max_units() == 20
    one_hint = {"v": 1, "unit": 20, "t_ms": 3_600_000, "m": ["h"]}
    full_hints = {"v": 1, "unit": 20, "t_ms": 3_600_000, "m": ["h"] * 25}
    one_shuffle = {
        "v": 1,
        "unit": 20,
        "t_ms": 3_600_000,
        "m": [{"s": list(range(MAX_TILES)), "f": [42] * MAX_TILES}],
    }
    stored = {
        name: _max_units() * (jsonb_bytes(row) + ROW_OVERHEAD_BYTES)
        for name, row in (("one_hint", one_hint), ("hints", full_hints), ("shuffle", one_shuffle))
    }
    # the figures in games/replay_caps.py and docs/games/mahjong.md
    assert stored == {"one_hint": 4_980, "hints": 7_380, "shuffle": 28_920}
    assert max(stored.values()) <= 40 * 1024


def test_a_game_of_shuffles_ends_at_the_device_cap_under_the_epics_40_kb() -> None:
    """A player who shuffles and undoes all game: every action a full-board shuffle.
    The device stops recording at its session cap (20 KB of JSON) or its unit cap,
    and the rows it sent (1 shuffle each, or 2 when the app splits a chunk) are
    under the 40 KB a game the epic plans for, with the 200 B row overhead."""
    assert _session_cap() == 20 * 1024
    shuffle = {"s": list(range(MAX_TILES)), "f": [42] * MAX_TILES}
    worst = 0
    for per_row in (1, 2):
        chunk = {"v": 1, "unit": 99, "t_ms": 3_600_000, "m": [shuffle] * per_row}
        compact = len(json.dumps(chunk, separators=(",", ":")))
        assert compact <= MAX_MOVES_BYTES
        rows = min(_session_cap() // compact, _max_units())
        stored = rows * (jsonb_bytes(chunk) + ROW_OVERHEAD_BYTES)
        worst = max(worst, stored)
        assert rows <= DEFAULT_CAP.max_events
    # the figure in games/replay_caps.py and docs/games/mahjong.md
    assert worst == 28_920
    assert worst <= 40 * 1024
    assert worst <= DEFAULT_CAP.max_bytes


# ---------------------------------------------------------------------------
# migration 0041
# ---------------------------------------------------------------------------

_REVISION = "0041_mahjong_replay_events"
_MAHJONG = 9


def _parent_revision() -> str:
    """The revision 0041 sits on now: it is re-pointed when the chain is merged."""
    path = Path(__file__).parent.parent / "alembic" / "versions" / f"{_REVISION}.py"
    spec = importlib.util.spec_from_file_location("mahjong_replay_migration", path)
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
                "SELECT name FROM event_types WHERE game_type_id = ? ORDER BY name", (_MAHJONG,)
            )
        ]


def test_the_migration_adds_and_removes_only_the_moves_event(
    migration_db_path: Path, alembic: Alembic
) -> None:
    alembic("upgrade", _parent_revision())
    before = _event_names(migration_db_path)
    assert before == ["game_ended", "game_started"]

    alembic("upgrade", _REVISION)
    with sqlite3.connect(migration_db_path) as conn:
        row = conn.execute(
            "SELECT display_name FROM event_types WHERE game_type_id = ? AND name = 'moves'",
            (_MAHJONG,),
        ).fetchone()
        # a stored moves event, to prove the downgrade clears its dependants
        et = conn.execute(
            "SELECT id FROM event_types WHERE game_type_id = ? AND name = 'moves'", (_MAHJONG,)
        ).fetchone()[0]
        keep = conn.execute(
            "SELECT id FROM event_types WHERE game_type_id = ? AND name = 'game_ended'",
            (_MAHJONG,),
        ).fetchone()[0]
        gid = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO games (id, session_id, game_type_id, metadata) VALUES (?, 's', ?, '{}')",
            (gid, _MAHJONG),
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
    assert sorted(after) == sorted([*before, (_MAHJONG, "moves")])

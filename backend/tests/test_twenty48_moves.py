"""2048 ``moves`` event: the game module's ``validate_event`` (#3286, epic #3273).

The app (``frontend/src/game/twenty48/replay.ts``) sends one ``moves`` event per
chunk of up to 25 swipes, each ``[direction, cell, value, gained, total]``, with
the GameRecorder's envelope (``v``, ``unit``, ``t_ms``). The payloads below are
what it builds, so a rejection here would drop a real game's replay.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any

import pytest

from games.registry import get_module
from observability import report
from tests._alembic_heads import BACKEND, script_heads
from tests._migration_helpers import Alembic
from twenty48.models import MAX_MOVES_BYTES, MAX_MOVES_PER_EVENT, validate_moves
from twenty48.module import module as twenty48_module

# A chunk as the app builds it: 25 moves, a unit and the ms since the game started.
_MOVES = [[i % 4, (i * 5) % 16, 2 if i % 9 else 4, (i % 3) * 4, 100 + 4 * i] for i in range(25)]
_REAL = {"v": 1, "unit": 3, "t_ms": 91_234, "m": _MOVES}


@pytest.fixture(autouse=True)
def sent(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    """Sentry messages, captured: a dropped event reports once, by reason only."""
    calls: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda m, **kw: calls.append((m, kw)))
    return calls


def _with(**changes: Any) -> dict[str, Any]:
    data = copy.deepcopy(_REAL)
    data.update(changes)
    return data


def test_the_module_checks_moves_and_passes_everything_else_through() -> None:
    module = get_module("twenty48")
    assert module is twenty48_module
    assert twenty48_module.validate_event("moves", copy.deepcopy(_REAL)) == _REAL
    assert twenty48_module.validate_event("moves", {}) is None
    # lifecycle events and the per-swipe ``move`` older builds send: stored as sent
    old_move = {"direction": "left", "score_delta": 4, "score_after": 12, "is_game_over": False}
    assert twenty48_module.validate_event("move", dict(old_move)) == old_move
    assert twenty48_module.validate_event("game_started", {"initial_board": [0] * 16}) == {
        "initial_board": [0] * 16
    }
    assert twenty48_module.validate_event("game_ended", {"a": 1}) == {"a": 1}


def test_accepts_the_payload_the_app_builds_and_stores_it_as_sent() -> None:
    assert validate_moves(copy.deepcopy(_REAL)) == _REAL


def test_accepts_a_partial_chunk_and_a_single_move() -> None:
    assert validate_moves(_with(m=_MOVES[:7])) is not None
    assert validate_moves(_with(m=[[3, 15, 4, 0, 0]])) is not None


def test_accepts_the_part_fields_of_a_split_event() -> None:
    assert validate_moves(_with(part=0, parts=2)) is not None


def test_accepts_the_largest_chunk_the_app_can_send() -> None:
    worst = {"v": 1, "unit": 9_999, "t_ms": 7_200_000, "m": [[3, 15, 4, 131_072, 3_932_156]] * 25}
    assert len(json.dumps(worst, separators=(",", ":"))) <= MAX_MOVES_BYTES
    assert validate_moves(worst) == worst


@pytest.mark.parametrize(
    "bad",
    [
        pytest.param(_with(v=2), id="unknown-version"),
        pytest.param(_with(v=True), id="version-true"),
        pytest.param(_with(v=1.0), id="version-float"),
        pytest.param({k: v for k, v in _REAL.items() if k != "v"}, id="no-version"),
        pytest.param({k: v for k, v in _REAL.items() if k != "m"}, id="no-moves"),
        pytest.param(_with(m=[]), id="empty-chunk"),
        pytest.param(_with(m="LRUD"), id="moves-not-a-list"),
        pytest.param(_with(m=[[4, 0, 2, 0, 0]]), id="direction-out-of-range"),
        pytest.param(_with(m=[[-1, 0, 2, 0, 0]]), id="negative-direction"),
        pytest.param(_with(m=[["left", 0, 2, 0, 0]]), id="direction-name"),
        pytest.param(_with(m=[[0, 16, 2, 0, 0]]), id="cell-off-the-board"),
        pytest.param(_with(m=[[0, -1, 2, 0, 0]]), id="negative-cell"),
        pytest.param(_with(m=[[0, 0, 3, 0, 0]]), id="spawn-not-2-or-4"),
        pytest.param(_with(m=[[0, 0, 8, 0, 0]]), id="spawn-too-big"),
        pytest.param(_with(m=[[0, 0, 2, -4, 0]]), id="negative-gain"),
        pytest.param(_with(m=[[0, 0, 2, 0, -1]]), id="negative-total"),
        pytest.param(_with(m=[[0, 0, 2, 0, 2**31]]), id="total-past-int32"),
        pytest.param(_with(m=[[0, 0, 2, 0.5, 1]]), id="fractional-gain"),
        pytest.param(_with(m=[[0, 0, 2, 0]]), id="short-move"),
        pytest.param(_with(m=[[0, 0, 2, 0, 1, 7]]), id="long-move"),
        pytest.param(_with(m=[None]), id="null-move"),
        pytest.param(_with(m=[True, 0, 2, 0, 1]), id="move-not-a-tuple"),
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
    # one report, by reason: neither the move values nor the unit reach Sentry
    assert len(sent) == 1
    assert "invalid" in sent[0][0]


def test_rejects_more_moves_than_a_chunk_can_hold() -> None:
    assert validate_moves(_with(m=[[0, 0, 2, 0, 0]] * (MAX_MOVES_PER_EVENT + 1))) is None


def test_rejects_an_oversized_payload_by_bytes(sent: list) -> None:
    # Within the move-count bound but over the byte cap: a padded, hostile payload.
    assert MAX_MOVES_PER_EVENT * len("[3,15,4,131072,3932156],") < MAX_MOVES_BYTES * 2
    huge = {"v": 1, "unit": 1, "t_ms": 1, "m": [[0, 0, 2, 0, 0]], "pad": "x" * MAX_MOVES_BYTES}
    assert validate_moves(huge) is None
    assert len(sent) == 1
    assert "oversize" in sent[0][0]


def test_an_unserialisable_payload_is_dropped_not_raised() -> None:
    assert validate_moves({"v": 1, "m": [object()]}) is None


def test_drop_reports_carry_no_player_data(sent: list) -> None:
    bad = _with(m=[[0, 0, 3, 0, 424_242]], unit=777)
    assert validate_moves(bad) is None
    text = json.dumps(sent, default=str)
    assert "424242" not in text
    assert "777" not in text


def test_the_byte_cap_matches_the_apps_registry() -> None:
    import pathlib
    import re

    ts = (
        pathlib.Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "game"
        / "_shared"
        / "eventQueueConfig.ts"
    ).read_text(encoding="utf-8")
    m = re.search(r"export const TWENTY48_MOVES_MAX_BYTES\s*=\s*(\d+)\s*;", ts)
    assert m, "TWENTY48_MOVES_MAX_BYTES not found in eventQueueConfig.ts"
    assert int(m.group(1)) == MAX_MOVES_BYTES


# ---------------------------------------------------------------------------
# migration 0037
# ---------------------------------------------------------------------------

_REVISION = "0037_twenty48_moves_event"
_TWENTY48_ID = 2


def _revises() -> str:
    """0037's parent, read from the migration so the test never pins it."""
    spec = importlib.util.spec_from_file_location(
        "m0037", BACKEND / "alembic" / "versions" / f"{_REVISION}.py"
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.revision == _REVISION
    return mod.down_revision


def _names(db_path: Path, game_type_id: int) -> list[str]:
    with sqlite3.connect(db_path) as conn:
        return [
            r[0]
            for r in conn.execute(
                "SELECT name FROM event_types WHERE game_type_id = ? ORDER BY name",
                (game_type_id,),
            )
        ]


def test_the_alembic_graph_has_a_single_head() -> None:
    assert len(script_heads()) == 1


def test_the_migration_adds_and_removes_only_the_twenty48_moves_type(
    migration_db_path: Path, alembic: Alembic
) -> None:
    alembic("upgrade", _revises())
    before = _names(migration_db_path, _TWENTY48_ID)
    assert "move" in before  # the per-swipe type older builds send (0002)
    assert "moves" not in before
    with sqlite3.connect(migration_db_path) as conn:
        others_before = conn.execute(
            "SELECT game_type_id, name FROM event_types WHERE game_type_id != ? "
            "ORDER BY game_type_id, name",
            (_TWENTY48_ID,),
        ).fetchall()

    alembic("upgrade", _REVISION)
    with sqlite3.connect(migration_db_path) as conn:
        row = conn.execute(
            "SELECT display_name, description FROM event_types "
            "WHERE game_type_id = ? AND name = 'moves'",
            (_TWENTY48_ID,),
        ).fetchall()
        others_after = conn.execute(
            "SELECT game_type_id, name FROM event_types WHERE game_type_id != ? "
            "ORDER BY game_type_id, name",
            (_TWENTY48_ID,),
        ).fetchall()
        # a stored game with a lifecycle row, an old `move` row and a `moves` row, to
        # prove the downgrade clears the `moves` dependants and nothing else
        gid = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO games (id, session_id, game_type_id, metadata) VALUES (?, 's', ?, '{}')",
            (gid, _TWENTY48_ID),
        )
        for idx, name in ((0, "game_started"), (1, "move"), (2, "moves")):
            type_id = conn.execute(
                "SELECT id FROM event_types WHERE game_type_id = ? AND name = ?",
                (_TWENTY48_ID, name),
            ).fetchone()[0]
            conn.execute(
                "INSERT INTO game_events (game_id, event_index, event_type_id, data) "
                "VALUES (?, ?, ?, '{}')",
                (gid, idx, type_id),
            )
    assert row == [("Moves", None)]
    assert others_after == others_before
    assert _names(migration_db_path, _TWENTY48_ID) == sorted([*before, "moves"])

    alembic("downgrade", "-1")
    assert _names(migration_db_path, _TWENTY48_ID) == before
    with sqlite3.connect(migration_db_path) as conn:
        assert conn.execute(
            "SELECT event_index FROM game_events WHERE game_id = ? ORDER BY event_index",
            (gid,),
        ).fetchall() == [(0,), (1,)]
        assert (
            conn.execute(
                "SELECT game_type_id, name FROM event_types WHERE game_type_id != ? "
                "ORDER BY game_type_id, name",
                (_TWENTY48_ID,),
            ).fetchall()
            == others_before
        )

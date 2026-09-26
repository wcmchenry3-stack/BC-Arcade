"""Migration 0028 — backfill ``win`` on older Mahjong, Twenty48, Blackjack rows (#2703).

The migration tests run alembic against their own scratch SQLite file (the
pattern of ``test_players_backfill_migration.py``): upgrade to the prior
revision, seed rows the way older app builds stored them, upgrade through 0028
and check that only the certain wins changed, then that a second run changes
nothing. The rules are ``games.legacy_outcomes``. The last test applies them to
its own rows in the session DB and reads the wins back through ``/stats/me``.
"""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from games.legacy_outcomes import win_update

_BACKEND = Path(__file__).resolve().parent.parent
_BEFORE = "0027_players_display_name"
_REVISION = "0028_backfill_win_outcomes"

# A Twenty48 opening board below 2048, and one already holding it.
_FRESH_BOARD = [2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]
_WON_BOARD = [2048, 512, 64, 8, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]


def _alembic(db_path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{db_path}"
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=_BACKEND,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )


def _insert(
    conn: sqlite3.Connection,
    game_type: str,
    outcome: str | None,
    metadata: dict | None = None,
    *,
    completed: bool = True,
    raw_metadata: str | None = None,
    initial_board: object = None,
    raw_started_data: str | None = None,
) -> str:
    """One game row; with ``initial_board`` (or raw data), its ``game_started`` event."""
    gt_id = conn.execute("SELECT id FROM game_types WHERE name = ?", (game_type,)).fetchone()[0]
    gid = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO games (id, session_id, game_type_id, outcome, completed_at, metadata) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            gid,
            "s-2703",
            gt_id,
            outcome,
            "2026-09-01 12:00:00.000000" if completed else None,
            raw_metadata if raw_metadata is not None else json.dumps(metadata or {}),
        ),
    )
    if initial_board is not None or raw_started_data is not None:
        event_type_id = conn.execute(
            "SELECT id FROM event_types WHERE game_type_id = ? AND name = 'game_started'",
            (gt_id,),
        ).fetchone()[0]
        data = (
            raw_started_data
            if raw_started_data is not None
            else json.dumps({"initial_board": initial_board})
        )
        conn.execute(
            "INSERT INTO game_events (game_id, event_index, event_type_id, data) "
            "VALUES (?, 0, ?, ?)",
            (gid, event_type_id, data),
        )
    return gid


def _rows(conn: sqlite3.Connection) -> dict[str, tuple[str | None, str]]:
    return {
        gid: (outcome, metadata)
        for gid, outcome, metadata in conn.execute("SELECT id, outcome, metadata FROM games")
    }


def _t48(tile: int, outcome: str) -> dict:
    """An older Twenty48 build's result block (it repeats the outcome)."""
    return {"final_score": 20_000, "highest_tile": tile, "move_count": 900, "outcome": outcome}


def _seed_old_rows(conn: sqlite3.Connection) -> tuple[set[str], set[str]]:
    """Rows as older builds stored them: ``(certain wins, everything else)``."""
    wins = {
        # Mahjong: a cleared board sent won: true.
        _insert(conn, "mahjong", "completed", {"won": True, "pairs": 72, "layout": "turtle"}),
        # Twenty48: the session in which 2048 was first reached — it opened
        # below 2048 — whether it closed at Keep Playing or at a game over.
        _insert(
            conn,
            "twenty48",
            "kept_playing",
            _t48(2048, "kept_playing"),
            initial_board=_FRESH_BOARD,
        ),
        _insert(conn, "twenty48", "completed", _t48(4096, "completed"), initial_board=_FRESH_BOARD),
        _insert(conn, "twenty48", "completed", {"highest_tile": 2048.0}, initial_board=[0] * 16),
        # Blackjack: Cash Out, only offered at or above the run's goal.
        _insert(conn, "blackjack", "completed", {"final_chips": 1500, "hands_won": 9}),
    }
    others = {
        # Mahjong: not a cleared board, or not a JSON true.
        _insert(conn, "mahjong", "completed", {"won": False, "pairs": 30}),
        _insert(conn, "mahjong", "completed", {"pairs": 30}),
        _insert(conn, "mahjong", "completed", {"won": "true"}),
        _insert(conn, "mahjong", "completed", {"won": 1}),
        _insert(conn, "mahjong", "abandoned", {"won": True}),
        _insert(conn, "mahjong", "loss", {"won": False}),
        _insert(conn, "mahjong", "completed", {"won": True}, completed=False),
        _insert(conn, "mahjong", None, {"won": True}),
        # Metadata that isn't JSON is skipped, not an error.
        _insert(conn, "mahjong", "completed", raw_metadata='{"won": true'),
        _insert(conn, "blackjack", "completed", raw_metadata="not json"),
        # Twenty48: later sessions of a board that already held 2048 (reopened
        # after Keep Playing, then Keep Playing again or a game over).
        _insert(
            conn, "twenty48", "kept_playing", _t48(2048, "kept_playing"), initial_board=_WON_BOARD
        ),
        _insert(conn, "twenty48", "completed", _t48(4096, "completed"), initial_board=_WON_BOARD),
        # Twenty48: no game_started event, or one that proves nothing.
        _insert(conn, "twenty48", "kept_playing", _t48(2048, "kept_playing")),
        _insert(conn, "twenty48", "completed", _t48(2048, "completed"), initial_board=[0] * 15),
        _insert(conn, "twenty48", "completed", _t48(2048, "completed"), initial_board=[0] * 17),
        _insert(
            conn,
            "twenty48",
            "completed",
            _t48(2048, "completed"),
            initial_board=["2"] + [0] * 15,
        ),
        _insert(conn, "twenty48", "completed", _t48(2048, "completed"), initial_board="2,0,0"),
        _insert(
            conn,
            "twenty48",
            "completed",
            _t48(2048, "completed"),
            raw_started_data='{"_truncated": true}',
        ),
        _insert(
            conn,
            "twenty48",
            "completed",
            _t48(2048, "completed"),
            raw_started_data='{"initial_board": [0,',
        ),
        # Twenty48: below 2048, no tile, or not a JSON number — even from a
        # session that opened below 2048.
        _insert(conn, "twenty48", "completed", {"highest_tile": 1024}, initial_board=_FRESH_BOARD),
        _insert(conn, "twenty48", "completed", {"highest_tile": 2047}, initial_board=_FRESH_BOARD),
        _insert(conn, "twenty48", "completed", {}, initial_board=_FRESH_BOARD),
        _insert(
            conn, "twenty48", "completed", {"highest_tile": "4096"}, initial_board=_FRESH_BOARD
        ),
        _insert(conn, "twenty48", "completed", {"highest_tile": True}, initial_board=_FRESH_BOARD),
        _insert(conn, "twenty48", "abandoned", {"highest_tile": 4096}, initial_board=_FRESH_BOARD),
        # Twenty48: a current build's loss is not rewritten.
        _insert(conn, "twenty48", "loss", _t48(512, "loss"), initial_board=_FRESH_BOARD),
        # Blackjack: a bust sends final_chips 0; builds before the result
        # block sent nothing; malformed values don't count.
        _insert(conn, "blackjack", "completed", {"final_chips": 0, "hands_won": 4}),
        _insert(conn, "blackjack", "completed", {"best_run_chips": 3000, "total_runs": 2}),
        _insert(conn, "blackjack", "completed", {"final_chips": None}),
        _insert(conn, "blackjack", "completed", {"final_chips": "900"}),
        _insert(conn, "blackjack", "completed", {"final_chips": True}),
        _insert(conn, "blackjack", "completed", {"final_chips": -5}),
        _insert(conn, "blackjack", "abandoned", {"final_chips": 800}),
        # Blackjack: a current build's loss is not rewritten.
        _insert(conn, "blackjack", "loss", {"final_chips": 0}),
        # Other games with the same keys are never touched.
        _insert(conn, "solitaire", "completed", {"won": True}),
        _insert(conn, "cascade", "completed", {"highest_tile": 4096}),
        _insert(conn, "yacht", "completed", {"final_chips": 100}),
    }
    return wins, others


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "backfill_win_outcomes.db"


def test_upgrade_rewrites_only_the_certain_wins(db_path: Path) -> None:
    _alembic(db_path, "upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        wins, others = _seed_old_rows(conn)
        conn.commit()
        before = _rows(conn)

    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        after = _rows(conn)

    assert {gid for gid in after if after[gid] != before[gid]} == wins
    for gid in wins:
        assert after[gid][0] == "win"
        # The result block agrees with the row: an ``outcome`` key it has is
        # set to win; nothing else changes and no key is added.
        old, new = json.loads(before[gid][1]), json.loads(after[gid][1])
        expected = {**old, "outcome": "win"} if "outcome" in old else old
        assert new == expected
    for gid in others:
        assert after[gid] == before[gid]


def test_the_twenty48_result_block_outcome_becomes_win(db_path: Path) -> None:
    _alembic(db_path, "upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        kept = _insert(
            conn, "twenty48", "kept_playing", _t48(2048, "kept_playing"), initial_board=_FRESH_BOARD
        )
        mahjong = _insert(conn, "mahjong", "completed", {"won": True, "pairs": 72})
        conn.commit()
        mahjong_text = _rows(conn)[mahjong][1]
    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        rows = _rows(conn)
    assert rows[kept][0] == "win"
    assert json.loads(rows[kept][1]) == _t48(2048, "win")
    # No ``outcome`` key: the metadata is left exactly as stored.
    assert rows[mahjong] == ("win", mahjong_text)


def test_a_second_run_changes_nothing(db_path: Path) -> None:
    _alembic(db_path, "upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        _seed_old_rows(conn)
        conn.commit()
    first = _alembic(db_path, "upgrade", _REVISION)
    assert "{'mahjong': 1, 'twenty48': 3, 'blackjack': 1}" in first.stderr
    with sqlite3.connect(db_path) as conn:
        after_first = _rows(conn)

    # Downgrade is a no-op, so the backfilled wins stay...
    _alembic(db_path, "downgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        assert _rows(conn) == after_first
    # ...and running the upgrade again finds nothing left to rewrite.
    second = _alembic(db_path, "upgrade", _REVISION)
    assert "{'mahjong': 0, 'twenty48': 0, 'blackjack': 0}" in second.stderr
    with sqlite3.connect(db_path) as conn:
        assert _rows(conn) == after_first


def test_upgrade_on_an_empty_games_table(db_path: Path) -> None:
    _alembic(db_path, "upgrade", _BEFORE)
    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        assert _rows(conn) == {}


def test_offline_sql_is_one_update_per_game(db_path: Path) -> None:
    out = _alembic(db_path, "upgrade", f"{_BEFORE}:{_REVISION}", "--sql").stdout
    updates = [s for s in out.split(";") if "UPDATE games SET outcome='win'" in s]
    assert len(updates) == 3
    for game_type, update in zip(("mahjong", "twenty48", "blackjack"), updates, strict=True):
        assert f"game_types.name = '{game_type}'" in update
        assert "games.completed_at IS NOT NULL" in update
        assert "json_valid(games.metadata)" in update


# ---------------------------------------------------------------------------
# /stats/me reads the backfilled wins
# ---------------------------------------------------------------------------

_T0 = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


@pytest.fixture()
def client() -> Iterator[TestClient]:
    from main import app

    with TestClient(app) as c:
        yield c


async def _add(
    sid: str, game_type: str, at: int, outcome: str, metadata: dict, board: list | None = None
) -> tuple[str, uuid.UUID]:
    """One row as an older build stored it; with ``board``, its game_started event."""
    from sqlalchemy import select

    from db.base import get_session_factory
    from db.models import EventType, Game, GameEvent, GameType

    completed_at = _T0 + timedelta(minutes=at)
    async with get_session_factory()() as db:
        gt_id = (
            await db.execute(select(GameType.id).where(GameType.name == game_type))
        ).scalar_one()
        game = Game(
            session_id=sid,
            game_type_id=gt_id,
            started_at=completed_at - timedelta(minutes=5),
            completed_at=completed_at,
            outcome=outcome,
            final_score=100,
            duration_ms=60_000,
            game_metadata=metadata,
        )
        db.add(game)
        await db.flush()
        if board is not None:
            started_id = (
                await db.execute(
                    select(EventType.id).where(
                        EventType.game_type_id == gt_id, EventType.name == "game_started"
                    )
                )
            ).scalar_one()
            db.add(
                GameEvent(
                    game_id=game.id,
                    event_index=0,
                    event_type_id=started_id,
                    data={"initial_board": board},
                )
            )
        await db.commit()
        return game_type, game.id


async def _apply_rules_to(rows: list[tuple[str, uuid.UUID]]) -> None:
    """Migration 0028's statements, each scoped to one of this test's rows, so
    no row another test seeded in the shared session DB is touched."""
    from db.base import get_session_factory

    async with get_session_factory()() as db:
        dialect = db.bind.dialect.name
        for game_type, game_id in rows:
            await db.execute(win_update(game_type, dialect, game_id=game_id))
        await db.commit()


async def test_stats_me_counts_the_backfilled_wins(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    # Older builds' rows, oldest first.
    rows = [
        await _add(sid, "mahjong", 0, "completed", {"won": True, "pairs": 72}),
        await _add(sid, "mahjong", 1, "loss", {"won": False, "pairs": 20}),
        await _add(sid, "mahjong", 2, "completed", {"won": True, "pairs": 72}),
        await _add(sid, "mahjong", 3, "completed", {"won": True, "pairs": 72}),
        await _add(sid, "mahjong", 4, "completed", {"won": False, "pairs": 10}),
        await _add(sid, "twenty48", 0, "kept_playing", {"highest_tile": 2048}, _FRESH_BOARD),
        # The same board reopened after Keep Playing: not a second win.
        await _add(sid, "twenty48", 1, "kept_playing", {"highest_tile": 2048}, _WON_BOARD),
        await _add(sid, "twenty48", 2, "completed", {"highest_tile": 512}, _FRESH_BOARD),
        await _add(sid, "twenty48", 3, "win", {"highest_tile": 2048}, _FRESH_BOARD),
        await _add(sid, "blackjack", 0, "completed", {"final_chips": 1500}),
        await _add(sid, "blackjack", 1, "completed", {"final_chips": 0}),
    ]
    # Another player's row that the scoped statements must leave alone.
    bystander = str(uuid.uuid4())
    await _add(bystander, "mahjong", 0, "completed", {"won": True, "pairs": 72})

    headers = {"X-Session-ID": sid}
    before = client.get("/stats/me", headers=headers).json()["by_game"]
    assert (before["mahjong"]["won"], before["mahjong"]["lost"]) == (0, 1)
    assert before["twenty48"]["won"] == 1
    assert before["blackjack"]["won"] is None  # no win, loss or push yet

    await _apply_rules_to(rows)

    after = client.get("/stats/me", headers=headers).json()["by_game"]
    mahjong = after["mahjong"]
    assert (mahjong["won"], mahjong["lost"], mahjong["tied"]) == (3, 1, 0)
    assert (mahjong["current_win_streak"], mahjong["best_win_streak"]) == (2, 2)
    twenty48 = after["twenty48"]
    assert (twenty48["won"], twenty48["lost"]) == (2, 0)
    assert (twenty48["current_win_streak"], twenty48["best_win_streak"]) == (2, 2)
    blackjack = after["blackjack"]
    assert (blackjack["won"], blackjack["lost"]) == (1, 0)
    # Rows changed outcome only: sessions are unchanged.
    assert [after[g]["sessions"] for g in ("mahjong", "twenty48", "blackjack")] == [5, 4, 2]

    other = client.get("/stats/me", headers={"X-Session-ID": bystander}).json()["by_game"]
    assert other["mahjong"]["won"] is None

"""Migration 0029 — the final ``*-anon`` cleanup, after the legacy routes are gone (#2644).

Mirrors ``test_delete_anon_leaderboard_rows.py`` (0026, #2622). The legacy
``POST /<game>/score`` routes kept writing sentinel rows after 0026 ran, so
these tests seed them *after* 0026 (at 0028, the prior head), as the routes
did, and assert that 0029 removes them and their events, and nothing else.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parent.parent
_BEFORE = "0028_backfill_win_outcomes"
_REVISION = "0029_delete_anon_rows_final"

# The seven sentinels the removed routes wrote (#2622 context).
_LEGACY_GAMES = ("solitaire", "mahjong", "hearts", "freecell", "sort", "starswarm", "yacht")
_SENTINELS = tuple(f"{game}-anon" for game in _LEGACY_GAMES)


def _alembic(db_path: Path, *args: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{db_path}"
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=_BACKEND,
        env=env,
        check=True,
        capture_output=True,
    )


def _insert_game(
    conn: sqlite3.Connection, session_id: str, *, game_type_id: int = 1, name: str | None = None
) -> str:
    gid = uuid.uuid4().hex
    metadata = "{}" if name is None else f'{{"player_name": "{name}"}}'
    conn.execute(
        "INSERT INTO games (id, session_id, game_type_id, final_score, outcome, metadata) "
        "VALUES (?, ?, ?, 100, 'completed', ?)",
        (gid, session_id, game_type_id, metadata),
    )
    conn.commit()
    return gid


def _insert_event(conn: sqlite3.Connection, game_id: str, index: int = 0) -> None:
    conn.execute(
        "INSERT INTO game_events (game_id, event_index, event_type_id, data) VALUES (?, ?, 1, '{}')",
        (game_id, index),
    )
    conn.commit()


def _type_id(conn: sqlite3.Connection, name: str) -> int:
    return conn.execute("SELECT id FROM game_types WHERE name = ?", (name,)).fetchone()[0]


def _game_ids(conn: sqlite3.Connection) -> set[str]:
    return {row[0] for row in conn.execute("SELECT id FROM games").fetchall()}


def _event_game_ids(conn: sqlite3.Connection) -> set[str]:
    return {row[0] for row in conn.execute("SELECT DISTINCT game_id FROM game_events").fetchall()}


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "delete_anon_final_migration.db"


def test_upgrade_deletes_sentinel_rows_written_after_0026(db_path: Path) -> None:
    # 0026 has already run: these rows are the ones the routes wrote since.
    _alembic(db_path, "upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        sentinel_ids = []
        for game, session_id in zip(_LEGACY_GAMES, _SENTINELS, strict=True):
            gid = _insert_game(
                conn, session_id, game_type_id=_type_id(conn, game), name="OldClient"
            )
            _insert_event(conn, gid)
            _insert_event(conn, gid, index=1)
            sentinel_ids.append(gid)

        # Real rows, including named Cascade/Sudoku rows, are untouched.
        cascade_id = _insert_game(
            conn, str(uuid.uuid4()), game_type_id=_type_id(conn, "cascade"), name="Cascade"
        )
        _insert_event(conn, cascade_id)
        sudoku_id = _insert_game(
            conn, str(uuid.uuid4()), game_type_id=_type_id(conn, "sudoku"), name="Sudoku"
        )
        _insert_event(conn, sudoku_id)
        # Only the seven exact ids go, not every id containing "anon".
        lookalike_id = _insert_game(conn, "anonymous-player-42", name="Lookalike")
        real_ids = {cascade_id, sudoku_id, lookalike_id}

    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        remaining = _game_ids(conn)
        assert remaining.isdisjoint(sentinel_ids)
        assert real_ids <= remaining
        remaining_event_games = _event_game_ids(conn)
        assert remaining_event_games.isdisjoint(sentinel_ids)
        assert {cascade_id, sudoku_id} <= remaining_event_games


def test_upgrade_is_a_noop_when_no_sentinel_rows_exist(db_path: Path) -> None:
    _alembic(db_path, "upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        kept = _insert_game(conn, str(uuid.uuid4()), name="Real")
    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        assert kept in _game_ids(conn)


def test_downgrade_is_a_documented_noop(db_path: Path) -> None:
    _alembic(db_path, "upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        sentinel_id = _insert_game(conn, _SENTINELS[0], name="OldClient")
        _insert_event(conn, sentinel_id)
        kept_id = _insert_game(conn, str(uuid.uuid4()), name="Real")

    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        assert sentinel_id not in _game_ids(conn)

    # Downgrading (a no-op) and upgrading again neither restores the row nor
    # fails on an already-clean table.
    _alembic(db_path, "downgrade", _BEFORE)
    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        remaining = _game_ids(conn)
        assert sentinel_id not in remaining
        assert kept_id in remaining

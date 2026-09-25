"""Migration 0026 — delete legacy ``*-anon`` leaderboard rows (#2622).

* The migration test (``_alembic`` against its own scratch SQLite file, the
  pattern ``test_outcome_migration.py`` uses) upgrades from the prior head,
  seeds sentinel rows with events plus real rows including named Cascade and
  Sudoku rows, upgrades through 0026, and asserts only the sentinel games and
  their events are gone. It also covers the documented no-op downgrade.
* That a sentinel row written *after* the migration (old clients keep calling
  ``POST /<game>/score`` until #2644) never ranks is covered on every legacy
  board by ``test_generic_leaderboard.py::test_sentinel_rows_never_rank``.
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
_BEFORE = "0025_merge_0024_heads"
_REVISION = "0026_delete_anon_leaderboard"

# The seven legacy sentinels (#2622 context), each written by its game's
# `POST /<game>/score` route, which predates the generic board (#2618).
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
    return tmp_path / "delete_anon_migration.db"


# ---------------------------------------------------------------------------
# Migration test
# ---------------------------------------------------------------------------


def test_upgrade_deletes_only_sentinel_rows_and_their_events(db_path: Path) -> None:
    _alembic(db_path, "upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        sentinel_ids = []
        for game, session_id in zip(_LEGACY_GAMES, _SENTINELS, strict=True):
            # Each under its own game type, as the legacy route wrote it.
            gid = _insert_game(
                conn, session_id, game_type_id=_type_id(conn, game), name="OldClient"
            )
            _insert_event(conn, gid)
            _insert_event(conn, gid, index=1)
            sentinel_ids.append(gid)

        # Real rows, including named Cascade/Sudoku rows, are untouched (Test
        # coverage > Regression).
        cascade_id = _insert_game(
            conn, str(uuid.uuid4()), game_type_id=_type_id(conn, "cascade"), name="Cascade"
        )
        _insert_event(conn, cascade_id)
        sudoku_id = _insert_game(
            conn, str(uuid.uuid4()), game_type_id=_type_id(conn, "sudoku"), name="Sudoku"
        )
        _insert_event(conn, sudoku_id)
        # A real session whose id happens to *contain* "anon" but doesn't end
        # in "-anon" must survive: this is a sentinel deletion, not a substring ban.
        lookalike_id = _insert_game(conn, "anonymous-player-42", name="Lookalike")
        real_ids = {cascade_id, sudoku_id, lookalike_id}

    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        remaining = _game_ids(conn)
        assert remaining.isdisjoint(sentinel_ids)
        assert real_ids <= remaining
        # Every sentinel's events are gone; the real rows' events survive.
        remaining_event_games = _event_game_ids(conn)
        assert remaining_event_games.isdisjoint(sentinel_ids)
        assert {cascade_id, sudoku_id} <= remaining_event_games


def test_upgrade_is_a_noop_when_no_sentinel_rows_exist(db_path: Path) -> None:
    """A fresh/clean DB (e.g. the one the rest of the suite runs against)
    upgrades cleanly with nothing to delete."""
    _alembic(db_path, "upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        kept = _insert_game(conn, str(uuid.uuid4()), name="Real")
    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        assert kept in _game_ids(conn)


def test_downgrade_is_a_documented_noop(db_path: Path) -> None:
    """Downgrade does not restore the deleted rows — there is nothing to
    revert, only a comment explaining why (Test coverage: downgrade)."""
    _alembic(db_path, "upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        sentinel_id = _insert_game(conn, _SENTINELS[0], name="OldClient")
        _insert_event(conn, sentinel_id)
        kept_id = _insert_game(conn, str(uuid.uuid4()), name="Real")

    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        assert sentinel_id not in _game_ids(conn)

    # Downgrading (schema-wise, a no-op) and re-upgrading must not resurrect
    # the sentinel row or error on an already-clean table.
    _alembic(db_path, "downgrade", _BEFORE)
    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        remaining = _game_ids(conn)
        assert sentinel_id not in remaining
        assert kept_id in remaining

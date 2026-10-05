"""Migrations 0026 and 0029 — delete legacy ``*-anon`` leaderboard rows (#2622, #2644).

Both migrations delete the seven sentinel games (and their events) and nothing
else, so one set of assertions runs against each ``(before, revision)`` pair,
each against its own scratch SQLite file (the ``migration_db`` fixture):

* 0026 (#2622) removes the rows the legacy ``POST /<game>/score`` routes had
  written; the test upgrades from the prior head, seeds them, and upgrades.
* 0029 (#2644) is the final cleanup: the legacy routes kept writing sentinel
  rows after 0026 ran, so the test seeds them *after* 0026 (at 0028, the prior
  head), as the routes did, and asserts 0029 removes them.

Each also covers the documented no-op downgrade.
"""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

import pytest

from tests._migration_helpers import Alembic

# The seven legacy sentinels (#2622 context), each written by its game's
# `POST /<game>/score` route, which predates the generic board (#2618).
_LEGACY_GAMES = ("solitaire", "mahjong", "hearts", "freecell", "sort", "starswarm", "yacht")
_SENTINELS = tuple(f"{game}-anon" for game in _LEGACY_GAMES)

# (revision before, the migration under test); every test runs against both.
pytestmark = pytest.mark.parametrize(
    ("before", "revision"),
    [
        pytest.param("0025_merge_0024_heads", "0026_delete_anon_leaderboard", id="0026"),
        pytest.param("0028_backfill_win_outcomes", "0029_delete_anon_rows_final", id="0029"),
    ],
)


def _seed_game(
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


def _seed_event(conn: sqlite3.Connection, game_id: str, index: int = 0) -> None:
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


def test_upgrade_deletes_only_sentinel_rows_and_their_events(
    migration_db_path: Path, alembic: Alembic, before: str, revision: str
) -> None:
    alembic("upgrade", before)
    with sqlite3.connect(migration_db_path) as conn:
        sentinel_ids = []
        for game, session_id in zip(_LEGACY_GAMES, _SENTINELS, strict=True):
            # Each under its own game type, as the legacy route wrote it.
            gid = _seed_game(conn, session_id, game_type_id=_type_id(conn, game), name="OldClient")
            _seed_event(conn, gid)
            _seed_event(conn, gid, index=1)
            sentinel_ids.append(gid)

        # Real rows, including named Cascade/Sudoku rows, are untouched (Test
        # coverage > Regression).
        cascade_id = _seed_game(
            conn, str(uuid.uuid4()), game_type_id=_type_id(conn, "cascade"), name="Cascade"
        )
        _seed_event(conn, cascade_id)
        sudoku_id = _seed_game(
            conn, str(uuid.uuid4()), game_type_id=_type_id(conn, "sudoku"), name="Sudoku"
        )
        _seed_event(conn, sudoku_id)
        # A real session whose id happens to *contain* "anon" but doesn't end
        # in "-anon" must survive: this is a sentinel deletion, not a substring ban.
        lookalike_id = _seed_game(conn, "anonymous-player-42", name="Lookalike")
        real_ids = {cascade_id, sudoku_id, lookalike_id}

    alembic("upgrade", revision)
    with sqlite3.connect(migration_db_path) as conn:
        remaining = _game_ids(conn)
        assert remaining.isdisjoint(sentinel_ids)
        assert real_ids <= remaining
        # Every sentinel's events are gone; the real rows' events survive.
        remaining_event_games = _event_game_ids(conn)
        assert remaining_event_games.isdisjoint(sentinel_ids)
        assert {cascade_id, sudoku_id} <= remaining_event_games


def test_upgrade_is_a_noop_when_no_sentinel_rows_exist(
    migration_db_path: Path, alembic: Alembic, before: str, revision: str
) -> None:
    """A fresh/clean DB (e.g. the one the rest of the suite runs against)
    upgrades cleanly with nothing to delete."""
    alembic("upgrade", before)
    with sqlite3.connect(migration_db_path) as conn:
        kept = _seed_game(conn, str(uuid.uuid4()), name="Real")
    alembic("upgrade", revision)
    with sqlite3.connect(migration_db_path) as conn:
        assert kept in _game_ids(conn)


def test_downgrade_is_a_documented_noop(
    migration_db_path: Path, alembic: Alembic, before: str, revision: str
) -> None:
    """Downgrade does not restore the deleted rows — there is nothing to
    revert, only a comment explaining why (Test coverage: downgrade)."""
    alembic("upgrade", before)
    with sqlite3.connect(migration_db_path) as conn:
        sentinel_id = _seed_game(conn, _SENTINELS[0], name="OldClient")
        _seed_event(conn, sentinel_id)
        kept_id = _seed_game(conn, str(uuid.uuid4()), name="Real")

    alembic("upgrade", revision)
    with sqlite3.connect(migration_db_path) as conn:
        assert sentinel_id not in _game_ids(conn)

    # Downgrading (schema-wise, a no-op) and re-upgrading must not resurrect
    # the sentinel row or error on an already-clean table.
    alembic("downgrade", before)
    alembic("upgrade", revision)
    with sqlite3.connect(migration_db_path) as conn:
        remaining = _game_ids(conn)
        assert sentinel_id not in remaining
        assert kept_id in remaining

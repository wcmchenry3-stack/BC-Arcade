"""Migration 0033 — ``games.received_at`` and its backfill (#2765).

Runs ``alembic`` against its own scratch SQLite file (the pattern of
``test_players_backfill_migration.py``): upgrade adds a nullable column, rows
that finished get ``received_at = completed_at``, open rows stay NULL, and the
downgrade drops the column.
"""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

from tests._migration_helpers import Alembic

_BEFORE = "0032_leaderboard_indexes"
_REVISION = "0033_games_received_at"


def _columns(db_path: Path) -> list[str]:
    with sqlite3.connect(db_path) as conn:
        return [row[1] for row in conn.execute("PRAGMA table_info(games)")]


def test_upgrade_backfills_finished_rows_and_downgrade_drops_the_column(
    migration_db_path: Path, alembic: Alembic
) -> None:
    alembic("upgrade", _BEFORE)
    assert "received_at" not in _columns(migration_db_path)
    done, open_ = uuid.uuid4().hex, uuid.uuid4().hex
    finished_at = "2026-01-01 00:10:00.000000"
    with sqlite3.connect(migration_db_path) as conn:
        for game_id, completed_at in ((done, finished_at), (open_, None)):
            conn.execute(
                "INSERT INTO games (id, session_id, game_type_id, completed_at, metadata) "
                "VALUES (?, 's', 5, ?, '{}')",
                (game_id, completed_at),
            )

    alembic("upgrade", _REVISION)
    assert "received_at" in _columns(migration_db_path)
    with sqlite3.connect(migration_db_path) as conn:
        rows = dict(conn.execute("SELECT id, received_at FROM games").fetchall())
    assert rows == {done: finished_at, open_: None}

    alembic("downgrade", "-1")
    assert "received_at" not in _columns(migration_db_path)

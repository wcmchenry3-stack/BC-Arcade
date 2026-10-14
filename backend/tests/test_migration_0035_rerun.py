"""Migration 0035 can be re-run after an interrupted index build (#3298).

On Postgres, ``autocommit_block()`` commits the column additions before the
``CONCURRENTLY`` index builds, so a deploy cancelled during a build leaves the columns
in place with the version still at 0034. The re-run must skip them, not fail on a
duplicate column. Simulated here on SQLite by adding the columns by hand at 0034.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from tests._migration_helpers import run_alembic


def _columns(db: Path, table: str) -> set[str]:
    with sqlite3.connect(db) as conn:
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def _indexes(db: Path) -> set[str]:
    with sqlite3.connect(db) as conn:
        return {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}


def test_upgrade_skips_columns_left_by_an_interrupted_run(tmp_path: Path) -> None:
    db = tmp_path / "rerun.db"
    run_alembic(db, "upgrade", "0034_starswarm_wave_event")
    with sqlite3.connect(db) as conn:
        conn.execute("ALTER TABLE games ADD COLUMN event_count INTEGER NOT NULL DEFAULT 0")
        conn.execute("ALTER TABLE games ADD COLUMN event_bytes INTEGER NOT NULL DEFAULT 0")

    run_alembic(db, "upgrade", "head")

    assert {"event_count", "event_bytes", "created_at"} <= _columns(db, "games")
    assert {"games_session_created_idx", "bug_logs_received_at_idx"} <= _indexes(db)

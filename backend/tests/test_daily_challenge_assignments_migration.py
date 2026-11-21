"""Migration 0048: the daily_challenge_assignments table (#3992).

Runs ``alembic`` against its own scratch SQLite file (the pattern of
``test_purchases_migration.py``): upgrade creates the table with its
``(session_id, local_date)`` primary key, downgrade drops it.
"""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

import pytest

from tests._migration_helpers import Alembic

_BEFORE = "0047_sort_replay_events"
_REVISION = "0048_daily_challenge_assignments"


def _tables(conn: sqlite3.Connection) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def test_upgrade_creates_the_table_and_downgrade_drops_it(
    migration_db_path: Path, alembic: Alembic
) -> None:
    alembic("upgrade", _BEFORE)
    with sqlite3.connect(migration_db_path) as conn:
        assert "daily_challenge_assignments" not in _tables(conn)

    alembic("upgrade", _REVISION)
    sid = uuid.uuid4().hex
    with sqlite3.connect(migration_db_path) as conn:
        columns = {
            r[1]: (r[3], r[5])
            for r in conn.execute("PRAGMA table_info(daily_challenge_assignments)")
        }
        # name -> (notnull, primary-key position)
        assert columns == {
            "session_id": (1, 1),
            "local_date": (1, 2),
            "goals": (1, 0),
            "bonus": (0, 0),
            "template_id": (0, 0),
            "slate": (0, 0),
            "created_at": (1, 0),
        }
        conn.execute(
            "INSERT INTO daily_challenge_assignments (session_id, local_date, goals) "
            "VALUES (?, '2026-11-21', '[]')",
            (sid,),
        )
        assert conn.execute("SELECT created_at FROM daily_challenge_assignments").fetchone()[0]
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO daily_challenge_assignments (session_id, local_date, goals) "
                "VALUES (?, '2026-11-21', '[]')",
                (sid,),
            )

    alembic("downgrade", _BEFORE)
    with sqlite3.connect(migration_db_path) as conn:
        assert "daily_challenge_assignments" not in _tables(conn)

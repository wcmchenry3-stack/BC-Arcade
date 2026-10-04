"""Migration 0024 — drop the never-written ``blackjack`` outcome (#2619).

Runs alembic against its own throwaway SQLite file (the session DB from
conftest must stay at head), so it covers the upgrade, the defensive rewrite of
``blackjack`` rows to ``win``, the tightened constraint, and a downgrade /
re-upgrade round trip.
"""

from __future__ import annotations

import sqlite3
import uuid

import pytest

from tests._migration_helpers import MigrationDb

_BEFORE = "0023_sudoku_free"
_REVISION = "0024_drop_blackjack_outcome"


def _insert_game(conn: sqlite3.Connection, outcome: str | None) -> str:
    gid = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO games (id, session_id, game_type_id, outcome) VALUES (?, ?, ?, ?)",
        (gid, "s-2619", 1, outcome),
    )
    conn.commit()
    return gid


def _outcome(conn: sqlite3.Connection, gid: str) -> str | None:
    return conn.execute("SELECT outcome FROM games WHERE id = ?", (gid,)).fetchone()[0]


def test_upgrade_rewrites_blackjack_rows_and_rejects_new_ones(migration_db: MigrationDb) -> None:
    db_path, alembic = migration_db
    alembic("upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        legacy = _insert_game(conn, "blackjack")
        kept = _insert_game(conn, "completed")

    alembic("upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        assert _outcome(conn, legacy) == "win"
        assert _outcome(conn, kept) == "completed"
        with pytest.raises(sqlite3.IntegrityError):
            _insert_game(conn, "blackjack")
        # Every remaining value, and NULL, is still accepted.
        for outcome in ("win", "loss", "push", "completed", "abandoned", "kept_playing", None):
            _insert_game(conn, outcome)


def test_downgrade_round_trip(migration_db: MigrationDb) -> None:
    db_path, alembic = migration_db
    alembic("upgrade", _REVISION)
    alembic("downgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        # The old constraint accepts ``blackjack`` again.
        gid = _insert_game(conn, "blackjack")
    alembic("upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        assert _outcome(conn, gid) == "win"
        with pytest.raises(sqlite3.IntegrityError):
            _insert_game(conn, "blackjack")

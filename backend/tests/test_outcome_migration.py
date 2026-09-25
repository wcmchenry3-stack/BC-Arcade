"""Migration 0024 — drop the never-written ``blackjack`` outcome (#2619).

Runs alembic against its own throwaway SQLite file (the session DB from
conftest must stay at head), so it covers the upgrade, the defensive rewrite of
``blackjack`` rows to ``win``, the tightened constraint, and a downgrade /
re-upgrade round trip.
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
_BEFORE = "0023_sudoku_free"
_REVISION = "0024_drop_blackjack_outcome"


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


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "outcome_migration.db"


def test_upgrade_rewrites_blackjack_rows_and_rejects_new_ones(db_path: Path) -> None:
    _alembic(db_path, "upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        legacy = _insert_game(conn, "blackjack")
        kept = _insert_game(conn, "completed")

    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        assert _outcome(conn, legacy) == "win"
        assert _outcome(conn, kept) == "completed"
        with pytest.raises(sqlite3.IntegrityError):
            _insert_game(conn, "blackjack")
        # Every remaining value, and NULL, is still accepted.
        for outcome in ("win", "loss", "push", "completed", "abandoned", "kept_playing", None):
            _insert_game(conn, outcome)


def test_downgrade_round_trip(db_path: Path) -> None:
    _alembic(db_path, "upgrade", _REVISION)
    _alembic(db_path, "downgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        # The old constraint accepts ``blackjack`` again.
        gid = _insert_game(conn, "blackjack")
    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        assert _outcome(conn, gid) == "win"
        with pytest.raises(sqlite3.IntegrityError):
            _insert_game(conn, "blackjack")

"""Shared helpers for the Alembic migration tests (#2953).

Not a test module: the leading underscore keeps pytest from collecting it.
``run_alembic`` and ``MigrationDb`` back the ``migration_db`` fixture in
``conftest.py``; the ``seed_*`` helpers and the sentinel tuple are shared by
the delete-anon-leaderboard migration tests.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple

from tests._alembic_heads import BACKEND

# The seven legacy sentinels (#2622 context), each written by its game's
# `POST /<game>/score` route, which predates the generic board (#2618).
LEGACY_GAMES = ("solitaire", "mahjong", "hearts", "freecell", "sort", "starswarm", "yacht")
SENTINELS = tuple(f"{game}-anon" for game in LEGACY_GAMES)


def run_alembic(db_path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Run ``alembic <args>`` against the scratch SQLite file at ``db_path``.

    Raises ``CalledProcessError`` on a non-zero exit; stdout/stderr are captured
    as text on the returned process (alembic logs to stderr).
    """
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{db_path}"
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )


class MigrationDb(NamedTuple):
    """What the ``migration_db`` fixture yields: unpack as ``db_path, alembic``."""

    db_path: Path
    alembic: Callable[..., subprocess.CompletedProcess[str]]


def seed_game(
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


def seed_event(conn: sqlite3.Connection, game_id: str, index: int = 0) -> None:
    conn.execute(
        "INSERT INTO game_events (game_id, event_index, event_type_id, data) VALUES (?, ?, 1, '{}')",
        (game_id, index),
    )
    conn.commit()


def type_id(conn: sqlite3.Connection, name: str) -> int:
    return conn.execute("SELECT id FROM game_types WHERE name = ?", (name,)).fetchone()[0]


def game_ids(conn: sqlite3.Connection) -> set[str]:
    return {row[0] for row in conn.execute("SELECT id FROM games").fetchall()}


def event_game_ids(conn: sqlite3.Connection) -> set[str]:
    return {row[0] for row in conn.execute("SELECT DISTINCT game_id FROM game_events").fetchall()}

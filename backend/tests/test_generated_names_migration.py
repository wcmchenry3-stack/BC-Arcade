"""Migration 0030 — typed display names become generated ones (#2778).

Runs ``alembic`` against its own scratch SQLite file (the pattern of
``test_players_backfill_migration.py``): upgrade to the prior revision, seed
``players`` rows holding typed names plus unnamed game rows, upgrade through
0030, and check that every player who had a name is still on the boards under
a generated name, and that nobody unnamed was opted in.
"""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

from players.generated import is_generated_display_name

_BACKEND = Path(__file__).resolve().parent.parent
_BEFORE = "0029_delete_anon_rows_final"
_REVISION = "0030_generated_player_names"


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


def _players(conn: sqlite3.Connection) -> dict[str, str]:
    return dict(conn.execute("SELECT session_id, display_name FROM players").fetchall())


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "generated_names_migration.db"


def test_named_players_stay_on_the_boards_under_generated_names(db_path: Path) -> None:
    _alembic(db_path, "upgrade", _BEFORE)
    named = [str(uuid.uuid4()) for _ in range(3)]
    unnamed = str(uuid.uuid4())
    typed = ["Ada", "x" * 32, "Brave Otter 4821"]
    with sqlite3.connect(db_path) as conn:
        for sid, name in zip(named, typed, strict=True):
            conn.execute(
                "INSERT INTO players (session_id, display_name) VALUES (?, ?)", (sid, name)
            )
        # An unnamed player with a finished game: must not be opted in.
        conn.execute(
            "INSERT INTO games (id, session_id, game_type_id, final_score, outcome, "
            "completed_at, metadata) VALUES (?, ?, 5, 100, 'completed', "
            "'2026-01-01 00:00:00.000000', ?)",
            (uuid.uuid4().hex, unnamed, json.dumps({})),
        )
        conn.commit()

    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        players = _players(conn)
    assert set(players) == set(named)
    for sid, old in zip(named, typed, strict=True):
        assert is_generated_display_name(players[sid]), players[sid]
        if not is_generated_display_name(old):
            assert players[sid] != old
    # A typed name that happened to look generated is regenerated too; the
    # draw could land on the same name, so only its shape is checked above.


def test_players_with_a_default_name_are_taken_off_the_boards(db_path: Path) -> None:
    """A build's default (``You``, ``Player``...) was never a choice to go public."""
    _alembic(db_path, "upgrade", _BEFORE)
    defaults = {str(uuid.uuid4()): name for name in ("You", " player ", "GUEST", "Player 1")}
    chosen = str(uuid.uuid4())
    with sqlite3.connect(db_path) as conn:
        for sid, name in {**defaults, chosen: "Ada"}.items():
            conn.execute(
                "INSERT INTO players (session_id, display_name) VALUES (?, ?)", (sid, name)
            )
        conn.commit()

    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        players = _players(conn)
    assert set(players) == {chosen}
    assert is_generated_display_name(players[chosen])


def test_upgrade_with_no_players_is_a_no_op(db_path: Path) -> None:
    _alembic(db_path, "upgrade", _BEFORE)
    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        assert _players(conn) == {}


def test_downgrade_keeps_the_generated_names(db_path: Path) -> None:
    _alembic(db_path, "upgrade", _BEFORE)
    sid = str(uuid.uuid4())
    with sqlite3.connect(db_path) as conn:
        conn.execute("INSERT INTO players (session_id, display_name) VALUES (?, 'Ada')", (sid,))
        conn.commit()
    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        after_upgrade = _players(conn)
    _alembic(db_path, "downgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        assert _players(conn) == after_upgrade

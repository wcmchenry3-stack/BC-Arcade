"""Migration 0027 — ``players`` table and its backfill (#2624).

Runs ``alembic`` against its own scratch SQLite file (the pattern
``test_delete_anon_leaderboard_rows.py`` uses): upgrade to the prior revision,
seed named game rows across sessions, upgrade through 0027, and check one
``players`` row per real named session holding the name of its most recently
completed named row, with sentinel ``*-anon`` sessions skipped.
"""

from __future__ import annotations

import json
import sqlite3
import uuid

from tests._migration_helpers import MigrationDb

_BEFORE = "0026_delete_anon_leaderboard"
_REVISION = "0027_players_display_name"


def _insert_game(
    conn: sqlite3.Connection,
    session_id: str,
    *,
    completed_minute: int | None,
    name: object = None,
    outcome: str = "completed",
) -> None:
    metadata = {} if name is None else {"player_name": name}
    # The ORM's SQLite datetime format, so the text ordering is the time ordering.
    completed_at = (
        None if completed_minute is None else f"2026-01-01 00:{completed_minute:02d}:00.000000"
    )
    conn.execute(
        "INSERT INTO games (id, session_id, game_type_id, final_score, outcome, "
        "completed_at, metadata) VALUES (?, ?, 5, 100, ?, ?, ?)",
        (uuid.uuid4().hex, session_id, outcome, completed_at, json.dumps(metadata)),
    )


def _players(conn: sqlite3.Connection) -> dict[str, str]:
    return dict(conn.execute("SELECT session_id, display_name FROM players").fetchall())


def test_backfill_keeps_the_latest_named_row_per_real_session(migration_db: MigrationDb) -> None:
    db_path, alembic = migration_db
    alembic("upgrade", _BEFORE)
    renamed, long_named, unnamed, blank_latest = (str(uuid.uuid4()) for _ in range(4))
    with sqlite3.connect(db_path) as conn:
        # William six months ago, Bill today: the latest completion wins,
        # whatever order the rows were inserted in.
        _insert_game(conn, renamed, completed_minute=30, name="  Bill  ")
        _insert_game(conn, renamed, completed_minute=10, name="William")
        _insert_game(conn, renamed, completed_minute=40)  # unnamed rows don't count
        _insert_game(conn, renamed, completed_minute=None, name="Unfinished")
        # Cut to 32 characters, like the validator.
        _insert_game(conn, long_named, completed_minute=5, name="x" * 40)
        _insert_game(conn, unnamed, completed_minute=5)
        # A blank latest name falls back to the previous real one.
        _insert_game(conn, blank_latest, completed_minute=1, name="Real")
        _insert_game(conn, blank_latest, completed_minute=2, name="   ")
        # Sentinel sessions are skipped (#2622 deletes the known ones).
        _insert_game(conn, "solitaire-anon", completed_minute=5, name="OldClient")
        _insert_game(conn, "brandnew-anon", completed_minute=5, name="OldClient")
        conn.commit()

    alembic("upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        assert _players(conn) == {
            renamed: "Bill",
            long_named: "x" * 32,
            blank_latest: "Real",
        }
        created, updated = conn.execute(
            "SELECT created_at, updated_at FROM players WHERE session_id = ?", (renamed,)
        ).fetchone()
        assert created and updated


def test_upgrade_on_an_empty_games_table_creates_an_empty_players_table(
    migration_db: MigrationDb,
) -> None:
    db_path, alembic = migration_db
    alembic("upgrade", _BEFORE)
    alembic("upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        assert _players(conn) == {}


def test_downgrade_drops_the_table_and_re_upgrade_backfills_again(
    migration_db: MigrationDb,
) -> None:
    db_path, alembic = migration_db
    alembic("upgrade", _BEFORE)
    sid = str(uuid.uuid4())
    with sqlite3.connect(db_path) as conn:
        _insert_game(conn, sid, completed_minute=1, name="Ada")
        conn.commit()
    alembic("upgrade", _REVISION)
    alembic("downgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "players" not in tables
    alembic("upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        assert _players(conn) == {sid: "Ada"}

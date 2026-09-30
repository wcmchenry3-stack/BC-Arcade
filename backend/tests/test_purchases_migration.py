"""Migration 0030 — purchase tables and the game_entitlements extension (#840).

Runs ``alembic`` against its own scratch SQLite file (the pattern of
``test_players_backfill_migration.py``): existing entitlement rows become
``legacy`` rows on upgrade, and downgrade removes the purchase schema plus any
access derived from a purchase while keeping legacy rows.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
_BEFORE = "0029_delete_anon_rows_final"
_REVISION = "0030_add_purchases"


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


def _tables(conn: sqlite3.Connection) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def test_upgrade_marks_existing_rows_legacy_and_downgrade_reverts(tmp_path: Path) -> None:
    db_path = tmp_path / "purchases_migration.db"
    _alembic(db_path, "upgrade", _BEFORE)
    legacy_sid = str(uuid.uuid4())
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO game_entitlements (id, session_id, game_slug) VALUES (?, ?, 'hearts')",
            (uuid.uuid4().hex, legacy_sid),
        )

    _alembic(db_path, "upgrade", _REVISION)
    purchase_id = uuid.uuid4().hex
    buyer = str(uuid.uuid4())
    with sqlite3.connect(db_path) as conn:
        assert {"purchases", "purchase_links", "purchase_events"} <= _tables(conn)
        assert {"purchase_id", "last_verified_at", "source"} <= _columns(conn, "game_entitlements")
        assert conn.execute(
            "SELECT source, purchase_id FROM game_entitlements WHERE session_id = ?",
            (legacy_sid,),
        ).fetchone() == ("legacy", None)

        conn.execute(
            "INSERT INTO purchases (id, platform, store_key, product_id, game_slug, state, "
            "environment, verified_at) VALUES (?, 'apple', '1000', "
            "'com.buffingchi.games.premium.hearts', 'hearts', 'owned', 'sandbox', "
            "CURRENT_TIMESTAMP)",
            (purchase_id,),
        )
        conn.execute(
            "INSERT INTO game_entitlements (id, session_id, game_slug, purchase_id, source) "
            "VALUES (?, ?, 'hearts', ?, 'sync')",
            (uuid.uuid4().hex, buyer, purchase_id),
        )
        # (platform, store_key) is unique.
        try:
            conn.execute(
                "INSERT INTO purchases (id, platform, store_key, product_id, game_slug, state, "
                "environment, verified_at) VALUES (?, 'apple', '1000', 'p', 'hearts', 'owned', "
                "'sandbox', CURRENT_TIMESTAMP)",
                (uuid.uuid4().hex,),
            )
        except sqlite3.IntegrityError:
            pass
        else:  # pragma: no cover
            raise AssertionError("duplicate (platform, store_key) accepted")

    _alembic(db_path, "downgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        assert not {"purchases", "purchase_links", "purchase_events"} & _tables(conn)
        assert "purchase_id" not in _columns(conn, "game_entitlements")
        rows = conn.execute("SELECT session_id FROM game_entitlements").fetchall()
        assert rows == [(legacy_sid,)]

    # And back up again cleanly.
    _alembic(db_path, "upgrade", _REVISION)

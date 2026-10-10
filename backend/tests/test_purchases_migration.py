"""Migration 0031 — purchase tables and the game_entitlements extension (#840).

Runs ``alembic`` against its own scratch SQLite file (the pattern of
``test_players_backfill_migration.py``): existing entitlement rows become
``legacy`` rows on upgrade, and downgrade removes the purchase schema plus any
access derived from a purchase while keeping legacy rows.
"""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

from tests._migration_helpers import Alembic

_BEFORE = "0030_generated_player_names"
_REVISION = "0031_add_purchases"


def _tables(conn: sqlite3.Connection) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def test_upgrade_marks_existing_rows_legacy_and_downgrade_reverts(
    migration_db_path: Path,
    alembic: Alembic,
) -> None:
    alembic("upgrade", _BEFORE)
    legacy_sid = str(uuid.uuid4())
    with sqlite3.connect(migration_db_path) as conn:
        conn.execute(
            "INSERT INTO game_entitlements (id, session_id, game_slug) VALUES (?, ?, 'hearts')",
            (uuid.uuid4().hex, legacy_sid),
        )

    alembic("upgrade", _REVISION)
    purchase_id = uuid.uuid4().hex
    buyer = str(uuid.uuid4())
    with sqlite3.connect(migration_db_path) as conn:
        assert {"purchases", "purchase_links", "purchase_events"} <= _tables(conn)
        assert {"purchase_id", "last_verified_at", "source"} <= _columns(conn, "game_entitlements")
        assert "state_changed_at" in _columns(conn, "purchases")
        fk = [r for r in conn.execute("PRAGMA foreign_key_list(game_entitlements)")]
        assert [(r[2], r[6]) for r in fk if r[3] == "purchase_id"] == [("purchases", "SET NULL")]
        assert conn.execute(
            "SELECT source, purchase_id FROM game_entitlements WHERE session_id = ?",
            (legacy_sid,),
        ).fetchone() == ("legacy", None)

        conn.execute(
            "INSERT INTO purchases (id, platform, store_key, product_id, game_slug, state, "
            "environment, verified_at, state_changed_at) VALUES (?, 'apple', '1000', "
            "'com.buffingchi.games.premium.hearts', 'hearts', 'owned', 'sandbox', "
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
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
                "environment, verified_at, state_changed_at) VALUES (?, 'apple', '1000', 'p', "
                "'hearts', 'owned', 'sandbox', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                (uuid.uuid4().hex,),
            )
        except sqlite3.IntegrityError:
            pass
        else:  # pragma: no cover
            raise AssertionError("duplicate (platform, store_key) accepted")

    # Deleting a purchase keeps the derived row (purchase_id → NULL) for the
    # recompute to decide; downgrade still removes it with the other
    # purchase-derived rows.
    with sqlite3.connect(migration_db_path) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("DELETE FROM purchases WHERE id = ?", (purchase_id,))
        assert conn.execute(
            "SELECT source, purchase_id FROM game_entitlements WHERE session_id = ?", (buyer,)
        ).fetchone() == ("sync", None)

    alembic("downgrade", _BEFORE)
    with sqlite3.connect(migration_db_path) as conn:
        assert not {"purchases", "purchase_links", "purchase_events"} & _tables(conn)
        assert "purchase_id" not in _columns(conn, "game_entitlements")
        rows = conn.execute("SELECT session_id FROM game_entitlements").fetchall()
        assert rows == [(legacy_sid,)]

    # And back up again cleanly.
    alembic("upgrade", _REVISION)

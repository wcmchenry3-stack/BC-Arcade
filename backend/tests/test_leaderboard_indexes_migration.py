"""Migration 0032 — partial indexes for the duration and metadata boards (#2965).

Runs ``alembic`` against its own scratch SQLite file (the pattern of
``test_purchases_migration.py``): upgrade adds both partial indexes with their
predicates, matching ``db/models.py``, and downgrading one revision drops them
and leaves the score index alone. The plans that use them are checked by
``test_leaderboard_query_plans.py``.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from sqlalchemy import create_engine, inspect

from db.models import Game
from tests._migration_helpers import Alembic, run_alembic_url

_BEFORE = "0031_add_purchases"
_REVISION = "0032_leaderboard_indexes"

_NEW = {
    "games_game_type_completed_idx": (
        ["game_type_id", "completed_at"],
        "completed_at IS NOT NULL",
    ),
    "games_game_type_duration_idx": (
        ["game_type_id", "duration_ms"],
        "duration_ms IS NOT NULL AND completed_at IS NOT NULL",
    ),
}


def _games_indexes(db_path: Path) -> dict[str, list[str]]:
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        return {ix["name"]: ix["column_names"] for ix in inspect(engine).get_indexes("games")}
    finally:
        engine.dispose()


def _index_sql(db_path: Path, name: str) -> str:
    with sqlite3.connect(db_path) as conn:
        row = conn.execute("SELECT sql FROM sqlite_master WHERE name = ?", (name,)).fetchone()
    return row[0]


def test_upgrade_adds_the_partial_indexes_and_downgrade_drops_them(
    migration_db_path: Path, alembic: Alembic
) -> None:
    alembic("upgrade", _BEFORE)
    before = _games_indexes(migration_db_path)
    assert not set(_NEW) & set(before)

    alembic("upgrade", _REVISION)
    after = _games_indexes(migration_db_path)
    for name, (columns, predicate) in _NEW.items():
        assert after[name] == columns
        assert _index_sql(migration_db_path, name).endswith(f"WHERE {predicate}")

    alembic("downgrade", "-1")
    assert _games_indexes(migration_db_path) == before
    assert "games_game_type_score_idx" in before


def test_postgres_builds_and_drops_them_concurrently() -> None:
    """Offline (``--sql``) rendering for Postgres, so no server is needed: both
    builds and drops are CONCURRENTLY, outside the migration transaction."""
    url = "postgresql+asyncpg://u@localhost/offline"  # as scratch_server_url yields it
    up = run_alembic_url(url, "upgrade", f"{_BEFORE}:{_REVISION}", "--sql").stdout
    down = run_alembic_url(url, "downgrade", f"{_REVISION}:{_BEFORE}", "--sql").stdout
    for name in _NEW:
        assert f"CREATE INDEX CONCURRENTLY {name} ON games" in up
        assert f"DROP INDEX CONCURRENTLY {name};" in down
    # COMMIT before the builds, a new transaction for the version bump.
    assert up.index("COMMIT;") < up.index("CREATE INDEX CONCURRENTLY") < up.rindex("BEGIN;")
    # A bare postgres:// names no SQLAlchemy dialect, hence the normalisation.
    bare = run_alembic_url(
        "postgres://u@localhost/offline", "upgrade", "head", "--sql", check=False
    )
    assert bare.returncode != 0 and "NoSuchModuleError" in bare.stdout + bare.stderr


def test_model_declares_the_same_indexes() -> None:
    """The model declares the same indexes, so a ``create_all`` schema (and
    anything reading ``Game.__table__``) agrees with the migrated one."""
    model = {ix.name: ix for ix in Game.__table__.indexes}
    for name, (columns, predicate) in _NEW.items():
        index = model[name]
        assert [c.name for c in index.columns] == columns
        for dialect in ("postgresql", "sqlite"):
            assert str(index.dialect_options[dialect]["where"]) == predicate

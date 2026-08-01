"""Alembic environment — sync engine, reads DATABASE_URL from env.

Uses a plain sync SQLAlchemy engine so migrations run against any driver
(Postgres in prod, SQLite in CI schema-check). The app's runtime engine in
`db/base.py` is async and separate.

Scope note (issue #122): no app models imported yet. Autogenerate will be
wired up in #363 when `backend/db/models.py` lands. For now `target_metadata`
is an empty MetaData so `alembic check` works cleanly.
"""

from __future__ import annotations

import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

import db.models  # noqa: F401 — ensure models are registered on Base.metadata
from alembic import context
from db.base import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _sync_url(raw: str) -> str:
    """Strip any async driver qualifier — alembic uses sync drivers."""
    if raw.startswith("postgresql+asyncpg://"):
        return "postgresql://" + raw[len("postgresql+asyncpg://") :]
    if raw.startswith("sqlite+aiosqlite://"):
        return "sqlite://" + raw[len("sqlite+aiosqlite://") :]
    return raw


_raw = os.environ.get("DATABASE_URL", "").strip()
if _raw:
    config.set_main_option("sqlalchemy.url", _sync_url(_raw))

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

"""Async SQLAlchemy engine + session factory for Postgres.

DATABASE_URL is read from the environment. Render provides a `postgresql://`
URL; SQLAlchemy 2.x needs the `+asyncpg` driver qualifier to use the async API,
so we rewrite the scheme here.

If DATABASE_URL is unset (local dev without a DB), engine/session remain None
and callers can skip DB work. No module-level crash — the app still boots.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def _normalize_url(raw: str) -> str:
    if raw.startswith("postgresql+asyncpg://"):
        return raw
    if raw.startswith("postgres://"):
        return "postgresql+asyncpg://" + raw[len("postgres://") :]
    if raw.startswith("postgresql://"):
        return "postgresql+asyncpg://" + raw[len("postgresql://") :]
    return raw


_raw_url = os.environ.get("DATABASE_URL", "").strip()
DATABASE_URL: str | None = _normalize_url(_raw_url) if _raw_url else None

# Engine/session are created lazily so importing this module never fails
# against a non-async DATABASE_URL (e.g. the sqlite URL used by CI's
# schema-migration check). Runtime callers go through `get_engine()` /
# `get_session()`, which raise clearly if DATABASE_URL is missing or not
# async-compatible.
_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        if not DATABASE_URL:
            raise RuntimeError("DATABASE_URL is not configured")
        # SQLite uses NullPool under the async driver and rejects pool_size /
        # max_overflow. Only pass connection-pool tuning to Postgres.
        kwargs: dict = {"pool_pre_ping": True}
        if not DATABASE_URL.startswith("sqlite"):
            kwargs.update({"pool_size": 5, "max_overflow": 5})
        _engine = create_async_engine(DATABASE_URL, **kwargs)

        # SQLite doesn't enforce foreign keys unless explicitly enabled per
        # connection. Only affects the test DB; Postgres always enforces.
        if DATABASE_URL.startswith("sqlite"):

            @event.listens_for(_engine.sync_engine, "connect")
            def _enable_sqlite_fk(dbapi_conn, _record):  # type: ignore[no-untyped-def]
                cur = dbapi_conn.cursor()
                cur.execute("PRAGMA foreign_keys = ON")
                cur.close()

    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            get_engine(), expire_on_commit=False, class_=AsyncSession
        )
    return _session_factory


def is_configured() -> bool:
    return DATABASE_URL is not None


async def get_session() -> AsyncIterator[AsyncSession]:
    factory = get_session_factory()
    async with factory() as session:
        yield session

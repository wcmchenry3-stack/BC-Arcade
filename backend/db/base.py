"""Async SQLAlchemy engine + session factory for Postgres.

DATABASE_URL comes from ``settings.Settings`` (#2997), read on first use — the
first ``database_url()``, ``is_configured()`` or ``get_engine()`` call — and kept
for the life of the process, as the engine is. Importing this module reads
nothing. Render provides a `postgresql://` URL; SQLAlchemy 2.x needs the
`+asyncpg` driver qualifier to use the async API, so we rewrite the scheme here.

If DATABASE_URL is unset (local dev without a DB), engine/session remain None
and callers can skip DB work. No module-level crash — the app still boots.

``create_app(settings)`` does not hand its ``Settings`` to this module: the
engine is process-wide, and tests build many apps with ``Settings.isolated()``,
which must not unconfigure the suite's database. A test that needs another URL
sets ``_settings``: ``monkeypatch.setattr(base, "_settings", Settings.isolated(...))``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import event, make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from settings import Settings


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


def _is_sqlite_file_db(url: str) -> bool:
    """Same test SQLAlchemy's SQLite dialects use to pick a pool."""
    parsed = make_url(url)
    return (
        bool(parsed.database)
        and parsed.database != ":memory:"
        and (parsed.query.get("mode") != "memory")
    )


# Built from the environment on first use; see the module docstring.
_settings: Settings | None = None


def database_url() -> str | None:
    """The async DATABASE_URL, or ``None`` when it is unset or blank."""
    global _settings
    if _settings is None:
        _settings = Settings()
    raw = _settings.database_url
    return _normalize_url(raw) if raw else None


# Engine/session are created lazily so importing this module never fails
# against a non-async DATABASE_URL (e.g. the sqlite URL used by CI's
# schema-migration check). Runtime callers go through `get_engine()` /
# `get_db()`, which raise clearly if DATABASE_URL is missing or not
# async-compatible.
_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        url = database_url()
        if not url:
            raise RuntimeError("DATABASE_URL is not configured")
        # A file SQLite DB (tests, local dev) gets NullPool explicitly: since SQLAlchemy
        # 2.0.38 a file DB defaults to AsyncAdaptedQueuePool, which shares
        # aiosqlite connections across event loops — pytest's per-test loops
        # and every TestClient's own. An aiosqlite connection whose loop closes
        # with a call still in flight loses its worker thread, and any later
        # call on it (a pool pre-ping included) waits forever: a CI run hung
        # ~28 min in the retention tests (#2667). NullPool closes each
        # connection on checkin, so none outlives the loop that opened it.
        # An in-memory DB keeps SQLAlchemy's StaticPool: its one connection
        # *is* the database. Only Postgres gets connection-pool tuning.
        kwargs: dict
        if url.startswith("sqlite"):
            kwargs = {"poolclass": NullPool} if _is_sqlite_file_db(url) else {}
        else:
            kwargs = {"pool_pre_ping": True, "pool_size": 5, "max_overflow": 5}
        _engine = create_async_engine(url, **kwargs)

        # SQLite doesn't enforce foreign keys unless explicitly enabled per
        # connection. Only affects the test DB; Postgres always enforces.
        if url.startswith("sqlite"):

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
    return database_url() is not None


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request, closed when the route is done (#2993).

    Routes take it as ``db: DbSession``. FastAPI caches it per request, so a
    route and its ``require_entitlement`` dependency share the one session.
    Opening it costs no I/O: a connection is checked out at the first query,
    so a route that answers 4xx before touching the database never uses one.
    """
    factory = get_session_factory()
    async with factory() as session:
        yield session


# ``scope="function"`` closes the session as soon as the route (and its response
# serialisation) finishes, before the response is sent, as the per-route
# ``async with factory() as db:`` blocks it replaced did. The default
# ``"request"`` scope would hold the connection until the client had the body.
DbSession = Annotated[AsyncSession, Depends(get_db, scope="function")]

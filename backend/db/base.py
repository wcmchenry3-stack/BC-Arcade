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

Query bounds (Postgres only, #3302). Every connection starts with the server-side
``statement_timeout`` (``DB_STATEMENT_TIMEOUT_SECONDS``, 5 s), sent as an asyncpg
startup parameter and set again with ``SET`` by a pool ``connect`` listener (a
pooler may not forward startup parameters), so Postgres cancels a slow query
instead of letting it hold a pooled connection. asyncpg's ``command_timeout``
(``DB_COMMAND_TIMEOUT_SECONDS``, 10 s) gives up on a server or pooler that stops answering, and ``pool_timeout``
(``DB_POOL_TIMEOUT_SECONDS``, 10 s) bounds the wait for a free connection. The first
two surface as ``DatabaseTimeoutError`` (an ``OperationalError``, so a route's own
``except SQLAlchemyError`` still catches it), the third as SQLAlchemy's
``exc.TimeoutError``. ``main`` answers either with ``503 {"detail": "database_timeout"}``.
SQLite gets none of this.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from typing import Annotated, Any

from fastapi import Depends
from sqlalchemy import event, make_url
from sqlalchemy.engine import ExceptionContext
from sqlalchemy.exc import OperationalError
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


# SQLSTATE query_canceled: what Postgres raises when statement_timeout fires.
QUERY_CANCELED_SQLSTATE = "57014"


class DatabaseTimeoutError(OperationalError):
    """A statement ran past ``statement_timeout`` or asyncpg's ``command_timeout``.

    ``orig`` is the driver's error: asyncpg's ``QueryCanceledError`` as SQLAlchemy
    adapts it (``sqlstate`` 57014), or the ``TimeoutError`` asyncpg raised.
    """


def _is_query_timeout(error: BaseException) -> bool:
    # asyncio.TimeoutError is TimeoutError from Python 3.11.
    if isinstance(error, TimeoutError):
        return True
    return getattr(error, "sqlstate", None) == QUERY_CANCELED_SQLSTATE


def _translate_query_timeout(ctx: ExceptionContext) -> DatabaseTimeoutError | None:
    """``handle_error`` hook: re-raise a query timeout as ``DatabaseTimeoutError``.

    asyncpg's ``command_timeout`` raises a bare ``TimeoutError``, which SQLAlchemy
    lets through unwrapped (so it looks like any other timeout), and a cancelled
    statement arrives as a generic ``DBAPIError``. Parameters are hidden because
    they can carry session ids.
    """
    if not _is_query_timeout(ctx.original_exception):
        return None
    return DatabaseTimeoutError(
        ctx.statement,
        ctx.parameters,
        ctx.original_exception,
        hide_parameters=True,
    )


def statement_timeout_ms(settings: Settings) -> int:
    """``DB_STATEMENT_TIMEOUT_SECONDS`` in whole milliseconds, never below 1.

    Postgres reads ``statement_timeout = 0`` as "no limit", so a sub-millisecond
    value must not round down to it.
    """
    return max(1, round(settings.db_statement_timeout_seconds * 1000))


def _statement_timeout_on_connect(timeout_ms: int) -> Callable[[Any, Any], None]:
    """A pool ``connect`` listener that sets ``statement_timeout`` on each new connection.

    The startup parameter alone is not enough: a pooler may drop startup
    parameters it does not forward (Supabase's Supavisor is not documented to pass
    ``statement_timeout`` through), and this SET reaches the server whatever sits in
    between. The asyncpg adapter opens a transaction for it, so it is committed:
    otherwise the first request's rollback would undo the SET.
    """

    def _set(dbapi_conn: Any, _record: Any) -> None:
        cur = dbapi_conn.cursor()
        # An int we computed, never user input.
        cur.execute(f"SET statement_timeout = '{int(timeout_ms)}ms'")
        cur.close()
        dbapi_conn.commit()

    return _set


def postgres_engine_kwargs(settings: Settings) -> dict:
    """Pool tuning and the query bounds for the Postgres engine (module docstring)."""
    timeout_ms = statement_timeout_ms(settings)
    return {
        "pool_pre_ping": True,
        "pool_size": 5,
        "max_overflow": 5,
        "pool_timeout": settings.db_pool_timeout_seconds,
        "connect_args": {
            "command_timeout": settings.db_command_timeout_seconds,
            # A startup parameter, set before the first query; the connect listener in
            # get_engine sets it again, in case a pooler drops startup parameters.
            "server_settings": {"statement_timeout": str(timeout_ms)},
        },
    }


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
    raw = _get_settings().database_url
    return _normalize_url(raw) if raw else None


def _get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


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
        # *is* the database. Only Postgres gets connection-pool tuning and the
        # query bounds.
        kwargs: dict
        if url.startswith("sqlite"):
            kwargs = {"poolclass": NullPool} if _is_sqlite_file_db(url) else {}
        else:
            kwargs = postgres_engine_kwargs(_get_settings())
        _engine = create_async_engine(url, **kwargs)
        if not url.startswith("sqlite"):
            event.listen(_engine.sync_engine, "handle_error", _translate_query_timeout)
            event.listen(
                _engine.sync_engine,
                "connect",
                _statement_timeout_on_connect(statement_timeout_ms(_get_settings())),
            )

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

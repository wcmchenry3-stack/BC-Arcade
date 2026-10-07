"""A throwaway Postgres database for the tests that need a real planner (#2965).

Not a test module: the leading underscore keeps pytest from collecting it.

Only ``LEADERBOARD_EXPLAIN_PG_URL`` names the server. The suite's own
``DATABASE_URL`` is never used: conftest lets it name a real, shared database
(a Render smoke run), which these tests must never seed. The URL's database is
used only as a maintenance connection to ``CREATE DATABASE`` a uniquely named
one (``TEMPLATE template0``) and to drop it afterwards, so nothing is left
behind: not the seeded rows, and not the statistics ``ANALYZE`` writes (its
``pg_class`` update is not transactional, so a rollback would not undo it).
The role needs CREATEDB. Any Postgres version works: ``DROP DATABASE ... WITH
(FORCE)`` is used from 13 on, and older servers get ``pg_terminate_backend``
then a plain drop.
"""

from __future__ import annotations

import logging
import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
import pytest
from sqlalchemy import URL, make_url, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from db.base import _normalize_url

logger = logging.getLogger(__name__)

PG_URL_ENV = "LEADERBOARD_EXPLAIN_PG_URL"
SCRATCH_PREFIX = "explain_gate_"
_FORCE_DROP_VERSION = 130000  # DROP DATABASE ... WITH (FORCE), Postgres 13
_DB_ERRORS = (asyncpg.PostgresError, OSError, SQLAlchemyError)


def explicit_pg_url() -> str | None:
    """``LEADERBOARD_EXPLAIN_PG_URL``, stripped; ``None`` when unset or blank."""
    return os.environ.get(PG_URL_ENV, "").strip() or None


def require_pg_url() -> str:
    """The scratch server URL, or skip the calling test naming the variable."""
    raw = explicit_pg_url()
    if raw is None:
        pytest.skip(
            f"no Postgres: set {PG_URL_ENV}=postgresql://user@host/postgres (a scratch "
            "server; the test creates and drops its own database there). The suite's "
            "DATABASE_URL is never used"
        )
    return raw


def scratch_server_url(raw: str) -> URL:
    """``raw`` as the asyncpg URL the app would use (``db.base._normalize_url``).

    ``postgres://``, ``postgresql://`` and ``postgresql+asyncpg://`` are
    accepted. The result is also what Alembic loads: ``alembic/env.py`` maps
    ``postgresql+asyncpg://`` to the sync ``postgresql://`` driver, whereas a
    bare ``postgres://`` names no SQLAlchemy dialect. Anything else is
    rejected with a message naming the variable.
    """
    url = make_url(_normalize_url(raw))
    if url.drivername != "postgresql+asyncpg":
        raise ValueError(
            f"{PG_URL_ENV} must be a postgres:// or postgresql:// URL, not {url.drivername}://"
        )
    return url


def url_str(url: URL) -> str:
    return url.render_as_string(hide_password=False)


def drop_statements(server_version_num: int, name: str) -> list[str]:
    """SQL that drops the scratch database ``name`` (one this module generated)."""
    if server_version_num >= _FORCE_DROP_VERSION:
        return [f"DROP DATABASE IF EXISTS {name} WITH (FORCE)"]
    terminate = (
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
        f"WHERE datname = '{name}' AND pid <> pg_backend_pid()"
    )
    return [terminate, f"DROP DATABASE IF EXISTS {name}"]


async def _drop(admin: AsyncEngine, name: str) -> str | None:
    """Drop ``name``; on failure return why (naming it), never raise."""
    try:
        async with admin.connect() as conn:
            version = int((await conn.execute(text("SHOW server_version_num"))).scalar_one())
            for statement in drop_statements(version, name):
                await conn.execute(text(statement))
    except _DB_ERRORS as exc:
        return (
            f"could not drop the scratch database {name} ({type(exc).__name__}: {exc}); "
            "drop it by hand"
        )
    return None


@asynccontextmanager
async def scratch_database(raw: str) -> AsyncIterator[URL]:
    """Create a uniquely named database on ``raw``'s server, yield its URL, drop it.

    A server that can't be reached, or a URL naming a database that doesn't
    exist, fails the test with a message naming the variable. A failed drop
    never masks the test's own error: it is logged then, and fails the test
    only when the body succeeded.
    """
    server = scratch_server_url(raw)
    name = f"{SCRATCH_PREFIX}{uuid.uuid4().hex[:12]}"
    admin = create_async_engine(server, isolation_level="AUTOCOMMIT")
    try:
        try:
            async with admin.connect() as conn:
                await conn.execute(
                    text(f"CREATE DATABASE {name} TEMPLATE template0 ENCODING 'UTF8'")
                )
        except _DB_ERRORS as exc:
            pytest.fail(
                f"could not create a scratch database through {PG_URL_ENV} "
                f"({type(exc).__name__}: {exc}). It must name an existing database on a "
                "server where the role has CREATEDB, e.g. the maintenance database: "
                "postgresql://user@host:5432/postgres",
                pytrace=False,
            )
        body_failed = True
        try:
            yield server.set(database=name)
            body_failed = False
        finally:
            problem = await _drop(admin, name)
            if problem and body_failed:
                logger.error(problem)
        if problem:
            pytest.fail(problem, pytrace=False)
    finally:
        await admin.dispose()

"""The query bounds and the DML-only app role on a real Postgres (#3302).

Needs ``LEADERBOARD_EXPLAIN_PG_URL`` (a scratch server, as for the EXPLAIN gate:
``tests/_pg_scratch.py``) and skips without it, so it runs in CI's ``test-postgres``
job only. Each test creates and drops its own database; the role test also
creates a uniquely named role (a cluster-wide object) and drops it afterwards, so
the URL's role needs CREATEROLE as well as CREATEDB.

- ``statement_timeout`` reaches the server, cancels a slow query, and the route
  answers ``503 {"detail": "database_timeout"}``; the connection is reused after.
- asyncpg's ``command_timeout`` is the backstop when the server does not cancel.
- An exhausted pool fails after ``DB_POOL_TIMEOUT_SECONDS`` with the same 503.
- ``backend/scripts/create_app_role.sql`` makes a role that can run DML on every
  table, today's and those a later migration creates, and is refused DDL,
  TRUNCATE and writes to ``alembic_version``.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
import uuid
from collections.abc import AsyncIterator, Iterator

import asyncpg
import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import URL, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError
from sqlalchemy.ext.asyncio import AsyncConnection

import main
from db import base
from db.base import DatabaseTimeoutError, DbSession
from settings import Settings
from tests._alembic_heads import BACKEND
from tests._migration_helpers import run_alembic_url
from tests._pg_scratch import require_pg_url, scratch_database, scratch_server_url, url_str

ROLE_SCRIPT = BACKEND / "scripts" / "create_app_role.sql"


def _asyncpg_dsn(url: URL) -> str:
    """``url`` as a plain ``postgresql://`` DSN for ``asyncpg.connect``."""
    return url_str(url.set(drivername="postgresql"))


@contextlib.contextmanager
def _engine_for(monkeypatch: pytest.MonkeyPatch, url: URL, **values: object) -> Iterator[None]:
    """Point db.base at ``url`` with ``values``; a fresh engine, the suite's restored after."""
    monkeypatch.setattr(base, "_engine", None)
    monkeypatch.setattr(base, "_session_factory", None)
    monkeypatch.setattr(base, "_settings", Settings.isolated(DATABASE_URL=url_str(url), **values))
    yield


@contextlib.asynccontextmanager
async def _client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    # Same event loop as the test (a TestClient runs its own), so the asyncpg pool
    # is used and disposed on one loop.
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


def _app() -> FastAPI:
    app = main.create_app(Settings.isolated(ENVIRONMENT="test"))

    async def slow(db: DbSession) -> dict:
        await db.execute(text("SELECT pg_sleep(3)"))
        return {"slept": True}

    async def slow_past_the_server_bound(db: DbSession) -> dict:
        # Lifts statement_timeout for this transaction only (the session's rollback
        # ends it), so only asyncpg's command_timeout can stop the sleep.
        await db.execute(text("SET LOCAL statement_timeout = 0"))
        await db.execute(text("SELECT pg_sleep(3)"))
        return {"slept": True}

    async def show(db: DbSession) -> dict:
        value = (await db.execute(text("SHOW statement_timeout"))).scalar_one()
        return {"statement_timeout": value}

    app.add_api_route("/t/slow", slow)
    app.add_api_route("/t/slow-command", slow_past_the_server_bound)
    app.add_api_route("/t/show", show)
    return app


# ---------------------------------------------------------------------------
# Query bounds
# ---------------------------------------------------------------------------


async def test_statement_timeout_cancels_a_slow_query_with_a_clean_503(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw = require_pg_url()
    async with scratch_database(raw) as url:
        with _engine_for(
            monkeypatch, url, DB_STATEMENT_TIMEOUT_SECONDS=0.3, DB_COMMAND_TIMEOUT_SECONDS=5
        ):
            try:
                async with _client(_app()) as client:
                    shown = await client.get("/t/show")
                    assert shown.json() == {"statement_timeout": "300ms"}

                    started = time.monotonic()
                    response = await client.get("/t/slow")
                    elapsed = time.monotonic() - started
                    assert response.status_code == 503
                    assert response.json() == {"detail": "database_timeout"}
                    assert response.headers["Retry-After"] == "5"
                    assert elapsed < 2.5, f"the server should cancel at 0.3 s, took {elapsed:.1f} s"

                    # The connection went back to the pool usable, still bounded.
                    again = await client.get("/t/show")
                    assert again.json() == {"statement_timeout": "300ms"}

                async with base.get_engine().connect() as conn:
                    with pytest.raises(DatabaseTimeoutError) as caught:
                        await conn.execute(text("SELECT pg_sleep(3)"))
                assert isinstance(caught.value, SQLAlchemyError)
                assert getattr(caught.value.orig, "sqlstate", None) == "57014"
            finally:
                await base.get_engine().dispose()


async def test_the_connect_listener_sets_the_timeout_without_the_startup_parameter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A pooler that drops startup parameters (as Supavisor may) still leaves every
    new connection bounded: the ``connect`` listener's SET reaches the server, and it
    is committed, so a request's rollback does not undo it."""
    real_kwargs = base.postgres_engine_kwargs

    def without_server_settings(settings: Settings) -> dict:
        kwargs = real_kwargs(settings)
        del kwargs["connect_args"]["server_settings"]
        return kwargs

    monkeypatch.setattr(base, "postgres_engine_kwargs", without_server_settings)
    raw = require_pg_url()
    async with scratch_database(raw) as url:
        with _engine_for(
            monkeypatch, url, DB_STATEMENT_TIMEOUT_SECONDS=0.75, DB_COMMAND_TIMEOUT_SECONDS=5
        ):
            engine = base.get_engine()
            try:
                async with engine.connect() as conn:
                    await conn.execute(text("SELECT 1"))
                    await conn.rollback()
                async with engine.connect() as conn:
                    shown = (await conn.execute(text("SHOW statement_timeout"))).scalar_one()
                    assert shown == "750ms"
                    with pytest.raises(DatabaseTimeoutError):
                        await conn.execute(text("SELECT pg_sleep(3)"))
                assert engine.pool.checkedin() == 1, "one connection, reused"
            finally:
                await engine.dispose()


async def test_command_timeout_is_the_backstop(monkeypatch: pytest.MonkeyPatch) -> None:
    raw = require_pg_url()
    async with scratch_database(raw) as url:
        with _engine_for(
            monkeypatch, url, DB_STATEMENT_TIMEOUT_SECONDS=0.5, DB_COMMAND_TIMEOUT_SECONDS=1
        ):
            try:
                async with _client(_app()) as client:
                    started = time.monotonic()
                    response = await client.get("/t/slow-command")
                    elapsed = time.monotonic() - started
                    assert response.status_code == 503
                    assert response.json() == {"detail": "database_timeout"}
                    assert elapsed < 2.8, f"asyncpg should give up at 1 s, took {elapsed:.1f} s"
                    # The pool still serves a working connection afterwards.
                    shown = await client.get("/t/show")
                    assert shown.status_code == 200
                    assert shown.json() == {"statement_timeout": "500ms"}
            finally:
                await base.get_engine().dispose()


async def test_an_exhausted_pool_fails_fast_with_a_clean_503(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw = require_pg_url()
    async with scratch_database(raw) as url:
        with _engine_for(monkeypatch, url, DB_POOL_TIMEOUT_SECONDS=0.5):
            engine = base.get_engine()
            held: list[AsyncConnection] = []
            try:
                # pool_size 5 + max_overflow 5.
                for _ in range(10):
                    held.append(await engine.connect())
                with pytest.raises(PoolTimeoutError):
                    await asyncio.wait_for(engine.connect(), timeout=5)
                async with _client(_app()) as client:
                    response = await client.get("/t/show")
                assert response.status_code == 503
                assert response.json() == {"detail": "database_timeout"}
            finally:
                for conn in held:
                    await conn.close()
                await engine.dispose()


# ---------------------------------------------------------------------------
# The app role
# ---------------------------------------------------------------------------


async def _run_role_script(admin: asyncpg.Connection, role: str) -> None:
    await admin.execute(f"SET bc_arcade.app_role = '{role}'")
    # One DO block; asyncpg's simple-query path also runs the comments around it.
    await admin.execute(ROLE_SCRIPT.read_text(encoding="utf-8"))


async def _drop_role(server: URL, role: str) -> None:
    conn = await asyncpg.connect(_asyncpg_dsn(server))
    try:
        await conn.execute(f'DROP ROLE IF EXISTS "{role}"')
    finally:
        await conn.close()


REFUSED = [
    "CREATE TABLE public.app_role_ddl (id int)",
    "CREATE TABLE app_role_ddl_unqualified (id int)",
    "ALTER TABLE games ADD COLUMN app_role_ddl int",
    "ALTER TABLE later_table RENAME TO app_role_ddl",
    "DROP TABLE later_table",
    "DROP TABLE games",
    "TRUNCATE games",
    "TRUNCATE later_table",
    "CREATE INDEX app_role_ddl_idx ON games (session_id)",
    "CREATE SCHEMA app_role_ddl",
    "UPDATE alembic_version SET version_num = version_num",
    "DELETE FROM alembic_version",
    "SELECT setval('later_table_id_seq', 100)",
]


async def _make_owner(server: URL, url: URL, owner: str, password: str) -> None:
    """A non-superuser CREATEROLE role that owns the scratch database and its
    ``public`` schema, as the migration role does on a managed Postgres (Supabase's
    ``postgres`` is not a superuser)."""
    conn = await asyncpg.connect(_asyncpg_dsn(server))
    try:
        await conn.execute(f"CREATE ROLE \"{owner}\" LOGIN CREATEROLE PASSWORD '{password}'")
        await conn.execute(f'ALTER DATABASE "{url.database}" OWNER TO "{owner}"')
    finally:
        await conn.close()
    conn = await asyncpg.connect(_asyncpg_dsn(url))
    try:
        await conn.execute(f'ALTER SCHEMA public OWNER TO "{owner}"')
    finally:
        await conn.close()


async def _assert_dml_only(app: asyncpg.Connection, role: str) -> None:
    assert await app.fetchval("SELECT current_user") == role
    assert await app.fetchval("SHOW statement_timeout") == "5s", "role default"

    # DML on the migrated tables, including row locks.
    assert await app.fetchval("SELECT count(*) FROM game_types") > 0
    await app.execute("UPDATE game_types SET sort_order = sort_order")
    async with app.transaction():
        await app.execute("SELECT * FROM games FOR UPDATE")
    await app.execute("INSERT INTO games SELECT * FROM games WHERE false")
    await app.execute("DELETE FROM games WHERE false")
    assert await app.fetchval("SELECT version_num FROM alembic_version")

    # DML on a table created after the script (default privileges), including
    # the serial's sequence.
    new_id = await app.fetchval("INSERT INTO later_table (v) VALUES ('a') RETURNING id")
    await app.execute("UPDATE later_table SET v = 'b' WHERE id = $1", new_id)
    assert await app.fetchval("SELECT v FROM later_table WHERE id = $1", new_id) == "b"
    await app.execute("DELETE FROM later_table WHERE id = $1", new_id)

    allowed = []
    for statement in REFUSED:
        try:
            async with app.transaction():
                await app.execute(statement)
        except asyncpg.InsufficientPrivilegeError:
            continue
        allowed.append(statement)
    assert not allowed, f"the app role was allowed: {allowed}"


@pytest.mark.parametrize("migration_role", ["superuser", "createrole_owner"])
async def test_the_app_role_can_run_dml_and_is_refused_ddl(migration_role: str) -> None:
    """``superuser``: the scratch server's own role (CI's ``postgres``).
    ``createrole_owner``: a non-superuser with CREATEROLE that owns the database and
    schema, migrates and runs the script — the shape of Supabase's ``postgres``."""
    raw = require_pg_url()
    server = scratch_server_url(raw)
    suffix = uuid.uuid4().hex[:10]
    role, owner = f"bc_app_test_{suffix}", f"bc_owner_test_{suffix}"
    password = uuid.uuid4().hex
    try:
        async with scratch_database(raw) as url:
            migrate_url = url
            if migration_role == "createrole_owner":
                await _make_owner(server, url, owner, password)
                migrate_url = url.set(username=owner, password=password)
            run_alembic_url(url_str(migrate_url), "upgrade", "head")
            admin = await asyncpg.connect(_asyncpg_dsn(migrate_url))
            try:
                if migration_role == "createrole_owner":
                    assert (
                        await admin.fetchval(
                            "SELECT rolsuper FROM pg_roles " "WHERE rolname = current_user"
                        )
                        is False
                    )
                await _run_role_script(admin, role)
                await _run_role_script(admin, role)  # idempotent
                # Test-only password; an operator sets theirs outside the script.
                await admin.execute(f"ALTER ROLE \"{role}\" PASSWORD '{password}'")
                # A table a later migration creates (as the migration role).
                await admin.execute("CREATE TABLE later_table (id serial PRIMARY KEY, v text)")
            finally:
                await admin.close()

            app = await asyncpg.connect(_asyncpg_dsn(url.set(username=role, password=password)))
            try:
                await _assert_dml_only(app, role)
            finally:
                await app.close()
    finally:
        await _drop_role(server, role)
        await _drop_role(server, owner)


async def test_the_role_script_refuses_to_run_as_the_app_role() -> None:
    raw = require_pg_url()
    async with scratch_database(raw) as url:
        admin = await asyncpg.connect(_asyncpg_dsn(url))
        try:
            current = await admin.fetchval("SELECT current_user")
            with pytest.raises(asyncpg.RaiseError, match="run this as the migration role"):
                await _run_role_script(admin, current)
        finally:
            await admin.close()


async def test_the_role_script_explains_a_role_it_may_not_alter() -> None:
    """On Postgres 16+ a CREATEROLE owner may alter only roles it has ADMIN on, so
    an app role someone else created stops the script with a clear message."""
    raw = require_pg_url()
    server = scratch_server_url(raw)
    suffix = uuid.uuid4().hex[:10]
    role, owner = f"bc_app_test_{suffix}", f"bc_owner_test_{suffix}"
    password = uuid.uuid4().hex
    try:
        async with scratch_database(raw) as url:
            await _make_owner(server, url, owner, password)
            superuser = await asyncpg.connect(_asyncpg_dsn(server))
            try:
                if int(await superuser.fetchval("SHOW server_version_num")) < 160000:
                    pytest.skip("before Postgres 16, CREATEROLE may alter any non-superuser role")
                await superuser.execute(f'CREATE ROLE "{role}" LOGIN')
            finally:
                await superuser.close()
            owner_url = url.set(username=owner, password=password)
            admin = await asyncpg.connect(_asyncpg_dsn(owner_url))
            try:
                with pytest.raises(asyncpg.RaiseError, match="may not alter it"):
                    await _run_role_script(admin, role)
            finally:
                await admin.close()
    finally:
        await _drop_role(server, role)
        await _drop_role(server, owner)

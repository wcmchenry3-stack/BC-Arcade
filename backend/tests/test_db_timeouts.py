"""Query bounds and the migration URL (#3302), without a Postgres server.

The Postgres half — a real ``statement_timeout`` cancel, asyncpg's
``command_timeout``, pool exhaustion and the DML-only app role — is in
``test_db_postgres_role.py``, which runs in CI's ``test-postgres`` job.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import asyncpg
import pytest
import yaml
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import event
from sqlalchemy.exc import DBAPIError, OperationalError, SQLAlchemyError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

import main
from db import base
from db.base import DatabaseTimeoutError
from settings import Settings
from tests._alembic_heads import BACKEND

REPO_ROOT = BACKEND.parent

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

DB_TIMEOUT_ENV = (
    "DB_STATEMENT_TIMEOUT_SECONDS",
    "DB_COMMAND_TIMEOUT_SECONDS",
    "DB_POOL_TIMEOUT_SECONDS",
)


@pytest.fixture()
def clean_db_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    for name in (*DB_TIMEOUT_ENV, "MIGRATION_DATABASE_URL"):
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_timeout_defaults(clean_db_env: pytest.MonkeyPatch) -> None:
    for s in (Settings(), Settings.isolated()):
        assert s.db_statement_timeout_seconds == 5.0
        assert s.db_command_timeout_seconds == 10.0
        assert s.db_pool_timeout_seconds == 10.0


def test_timeouts_are_read_from_the_environment(clean_db_env: pytest.MonkeyPatch) -> None:
    clean_db_env.setenv("DB_STATEMENT_TIMEOUT_SECONDS", "2.5")
    clean_db_env.setenv("DB_COMMAND_TIMEOUT_SECONDS", "4")
    clean_db_env.setenv("DB_POOL_TIMEOUT_SECONDS", "3")
    s = Settings()
    assert (s.db_statement_timeout_seconds, s.db_command_timeout_seconds) == (2.5, 4.0)
    assert s.db_pool_timeout_seconds == 3.0


@pytest.mark.parametrize(
    ("env", "bad"),
    [
        ("DB_STATEMENT_TIMEOUT_SECONDS", "0"),
        # Below 1 ms would round to statement_timeout = 0: no limit at all.
        ("DB_STATEMENT_TIMEOUT_SECONDS", "0.0009"),
        ("DB_STATEMENT_TIMEOUT_SECONDS", "300.5"),
        ("DB_COMMAND_TIMEOUT_SECONDS", "0"),
        ("DB_COMMAND_TIMEOUT_SECONDS", "600.5"),
        ("DB_POOL_TIMEOUT_SECONDS", "0"),
        ("DB_POOL_TIMEOUT_SECONDS", "120.5"),
        ("DB_POOL_TIMEOUT_SECONDS", "abc"),
    ],
)
def test_timeout_bounds(clean_db_env: pytest.MonkeyPatch, env: str, bad: str) -> None:
    clean_db_env.setenv(env, bad)
    with pytest.raises(ValidationError):
        Settings()


@pytest.mark.parametrize(("statement", "command"), [(10, 10), (10, 9.5), (30, 10)])
def test_command_timeout_must_outlast_statement_timeout(statement: float, command: float) -> None:
    with pytest.raises(ValidationError, match="DB_COMMAND_TIMEOUT_SECONDS must be greater"):
        Settings.isolated(
            DB_STATEMENT_TIMEOUT_SECONDS=statement, DB_COMMAND_TIMEOUT_SECONDS=command
        )


def test_migration_url_falls_back_to_database_url() -> None:
    app = "postgresql://bc_app.ref:pw@pooler/postgres"
    owner = "postgresql://postgres.ref:pw@pooler/postgres"
    assert Settings.isolated(DATABASE_URL=app).migration_database_url == app
    for blank in ("", "   "):
        s = Settings.isolated(DATABASE_URL=app, MIGRATION_DATABASE_URL=blank)
        assert s.migration_database_url == app
    s = Settings.isolated(DATABASE_URL=app, MIGRATION_DATABASE_URL=f" {owner} ")
    assert s.migration_database_url == owner
    assert s.database_url == app, "the app keeps DATABASE_URL"
    assert Settings.isolated().migration_database_url is None


# ---------------------------------------------------------------------------
# Engine wiring
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("seconds", "ms"), [(0.001, 1), (0.0015, 2), (0.25, 250), (5, 5000)])
def test_statement_timeout_is_whole_milliseconds(seconds: float, ms: int) -> None:
    assert base.statement_timeout_ms(Settings.isolated(DB_STATEMENT_TIMEOUT_SECONDS=seconds)) == ms


def test_statement_timeout_never_rounds_down_to_no_limit() -> None:
    """Settings refuses less than 1 ms; the conversion clamps anyway."""
    tiny: Any = SimpleNamespace(db_statement_timeout_seconds=0.0001)
    assert base.statement_timeout_ms(tiny) == 1


class _FakeCursor:
    def __init__(self, log: list[str]) -> None:
        self.log = log

    def execute(self, sql: str) -> None:
        self.log.append(sql)

    def close(self) -> None:
        self.log.append("close")


class _FakeDbapiConnection:
    def __init__(self) -> None:
        self.log: list[str] = []

    def cursor(self) -> _FakeCursor:
        return _FakeCursor(self.log)

    def commit(self) -> None:
        self.log.append("commit")


def test_the_connect_listener_sets_and_commits_the_timeout() -> None:
    """Set on every new connection (a pooler may drop the startup parameter), and
    committed: the adapter opens a transaction for it, which a rollback would undo."""
    conn = _FakeDbapiConnection()
    base._statement_timeout_on_connect(250)(conn, None)
    assert conn.log == ["SET statement_timeout = '250ms'", "close", "commit"]


def _connect_listeners(engine: Any) -> list[str]:
    return [getattr(fn, "__qualname__", "") for fn in engine.sync_engine.pool.dispatch.connect]


def test_postgres_engine_kwargs_carry_the_bounds() -> None:
    s = Settings.isolated(
        DB_STATEMENT_TIMEOUT_SECONDS=0.25,
        DB_COMMAND_TIMEOUT_SECONDS=1.5,
        DB_POOL_TIMEOUT_SECONDS=2,
    )
    assert base.postgres_engine_kwargs(s) == {
        "pool_pre_ping": True,
        "pool_size": 5,
        "max_overflow": 5,
        "pool_timeout": 2.0,
        "connect_args": {
            "command_timeout": 1.5,
            "server_settings": {"statement_timeout": "250"},
        },
    }


@pytest.fixture()
def fresh_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    """Let a test build its own engine; the suite's engine is restored afterwards."""
    monkeypatch.setattr(base, "_engine", None)
    monkeypatch.setattr(base, "_session_factory", None)


async def test_the_postgres_engine_connects_with_the_bounds(
    monkeypatch: pytest.MonkeyPatch, fresh_engine: None
) -> None:
    """The bounds reach ``asyncpg.connect`` (captured; no server is contacted)."""
    monkeypatch.setattr(
        base,
        "_settings",
        Settings.isolated(
            DATABASE_URL="postgresql://u:p@localhost:1/db", DB_POOL_TIMEOUT_SECONDS=3
        ),
    )
    seen: dict[str, Any] = {}

    async def fake_connect(*_args: Any, **kwargs: Any) -> None:
        seen.update(kwargs)
        raise OSError("no server in this test")

    monkeypatch.setattr(asyncpg, "connect", fake_connect)
    engine = base.get_engine()
    try:
        assert engine.pool.timeout() == 3.0
        assert event.contains(engine.sync_engine, "handle_error", base._translate_query_timeout)
        assert any(
            name.startswith("_statement_timeout_on_connect") for name in _connect_listeners(engine)
        )
        with pytest.raises(OSError, match="no server"):
            async with engine.connect():
                pass
        assert seen["command_timeout"] == 10.0
        assert seen["server_settings"] == {"statement_timeout": "5000"}
    finally:
        await engine.dispose()


async def test_sqlite_gets_no_bounds(
    monkeypatch: pytest.MonkeyPatch, fresh_engine: None, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        base,
        "_settings",
        Settings.isolated(DATABASE_URL=f"sqlite+aiosqlite:///{tmp_path / 'x.db'}"),
    )
    engine = base.get_engine()
    try:
        assert not event.contains(engine.sync_engine, "handle_error", base._translate_query_timeout)
        assert not any(
            name.startswith("_statement_timeout_on_connect") for name in _connect_listeners(engine)
        )
    finally:
        await engine.dispose()


# ---------------------------------------------------------------------------
# Timeout translation
# ---------------------------------------------------------------------------


class _AdaptedError(Exception):
    """Stands in for SQLAlchemy's adapted asyncpg error, which carries ``sqlstate``."""

    def __init__(self, sqlstate: str) -> None:
        super().__init__(f"sqlstate {sqlstate}")
        self.sqlstate = sqlstate


def _ctx(error: BaseException) -> Any:
    return SimpleNamespace(
        original_exception=error,
        statement="SELECT pg_sleep(%s)",
        parameters=("session-id-secret",),
    )


@pytest.mark.parametrize(
    "error",
    [
        TimeoutError(),  # asyncpg's command_timeout
        _AdaptedError("57014"),  # statement_timeout: query_canceled
    ],
)
def test_a_query_timeout_becomes_database_timeout_error(error: BaseException) -> None:
    translated = base._translate_query_timeout(_ctx(error))
    assert isinstance(translated, DatabaseTimeoutError)
    assert isinstance(translated, OperationalError)
    assert isinstance(translated, SQLAlchemyError), "routes' own except blocks still see it"
    assert translated.orig is error
    assert "session-id-secret" not in str(translated)


@pytest.mark.parametrize(
    "error",
    [_AdaptedError("42501"), _AdaptedError("23505"), ValueError("boom"), OSError("reset")],
)
def test_other_errors_are_left_alone(error: BaseException) -> None:
    assert base._translate_query_timeout(_ctx(error)) is None


# ---------------------------------------------------------------------------
# The app's answer
# ---------------------------------------------------------------------------


@pytest.fixture()
def timeout_app() -> TestClient:
    app = main.create_app(Settings.isolated(ENVIRONMENT="test"))

    async def statement_timeout() -> None:
        raise DatabaseTimeoutError("SELECT 1", None, TimeoutError(), hide_parameters=True)

    async def pool_timeout() -> None:
        raise PoolTimeoutError("QueuePool limit of size 5 overflow 5 reached")

    async def connect_timeout() -> None:
        # What asyncpg raises when opening a connection (or a pre-ping) stalls.
        raise TimeoutError()

    async def other_db_error() -> None:
        raise DBAPIError("SELECT 1", None, Exception("other"))

    app.add_api_route("/t/statement", statement_timeout)
    app.add_api_route("/t/pool", pool_timeout)
    app.add_api_route("/t/connect", connect_timeout)
    app.add_api_route("/t/other", other_db_error)
    return TestClient(app, raise_server_exceptions=False)


def test_app_registers_the_timeout_handlers() -> None:
    app = main.create_app(Settings.isolated(ENVIRONMENT="test"))
    assert app.exception_handlers[DatabaseTimeoutError] is main._db_timeout_handler
    assert app.exception_handlers[PoolTimeoutError] is main._db_timeout_handler
    assert app.exception_handlers[TimeoutError] is main._db_timeout_handler


@pytest.mark.parametrize("path", ["/t/statement", "/t/pool", "/t/connect"])
def test_a_database_timeout_is_a_clean_503(
    timeout_app: TestClient, path: str, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level("WARNING", logger="audit"):
        response = timeout_app.get(path)
    assert response.status_code == 503
    assert response.json() == {"detail": "database_timeout"}
    assert response.headers["Retry-After"] == "5"
    assert any('"event": "db_timeout"' in r.getMessage() for r in caplog.records)
    assert not any("SELECT" in r.getMessage() for r in caplog.records if r.name == "audit")


def test_other_database_errors_are_not_reported_as_timeouts(timeout_app: TestClient) -> None:
    response = timeout_app.get("/t/other")
    assert response.status_code == 500
    assert "database_timeout" not in response.text


# ---------------------------------------------------------------------------
# Alembic uses MIGRATION_DATABASE_URL; render.yaml declares it
# ---------------------------------------------------------------------------


def _tables(path: Path) -> set[str]:
    with sqlite3.connect(path) as conn:
        return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def test_alembic_migrates_migration_database_url_not_database_url(tmp_path: Path) -> None:
    app_db, owner_db = tmp_path / "app.db", tmp_path / "owner.db"
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{app_db}"
    env["MIGRATION_DATABASE_URL"] = f"sqlite:///{owner_db}"
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert {"alembic_version", "games"} <= _tables(owner_db)
    assert not app_db.exists(), "DATABASE_URL was not touched"


def test_render_yaml_declares_migration_database_url_as_a_secret() -> None:
    config = yaml.safe_load((REPO_ROOT / "render.yaml").read_text(encoding="utf-8"))
    apis = [s for s in config["services"] if s.get("runtime") == "python"]
    assert {s["name"] for s in apis} == {"bc-arcade-api", "bc-arcade-api-dev"}
    for service in apis:
        env = {v["key"]: v for v in service["envVars"]}
        assert env["MIGRATION_DATABASE_URL"] == {"key": "MIGRATION_DATABASE_URL", "sync": False}

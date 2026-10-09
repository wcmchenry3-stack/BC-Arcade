"""Engine and session wiring in db.base (#2958).

``test_db_connection.py`` proves the configured test engine can talk to the
database; these cover how the engine is chosen from ``DATABASE_URL``.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.pool import NullPool, StaticPool

from db import base
from settings import Settings


def _use_database_url(monkeypatch: pytest.MonkeyPatch, url: str | None) -> None:
    """Point db.base at ``url`` (``None``: unset) through a settings override."""
    values = {} if url is None else {"DATABASE_URL": url}
    monkeypatch.setattr(base, "_settings", Settings.isolated(**values))


@pytest.fixture()
def fresh_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    """Let a test build its own engine; the suite's engine is restored afterwards."""
    monkeypatch.setattr(base, "_engine", None)
    monkeypatch.setattr(base, "_session_factory", None)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # Render hands out the bare scheme; the async driver must be named.
        ("postgres://u:p@host/db", "postgresql+asyncpg://u:p@host/db"),
        ("postgresql://u:p@host/db", "postgresql+asyncpg://u:p@host/db"),
        ("postgresql+asyncpg://u:p@host/db", "postgresql+asyncpg://u:p@host/db"),
        ("sqlite+aiosqlite:///x.db", "sqlite+aiosqlite:///x.db"),
    ],
)
def test_database_url_gets_the_async_driver(raw: str, expected: str) -> None:
    assert base._normalize_url(raw) == expected


@pytest.mark.parametrize(
    ("url", "is_file"),
    [
        ("sqlite+aiosqlite:///x.db", True),
        ("sqlite+aiosqlite:///:memory:", False),
        ("sqlite+aiosqlite://", False),
        ("sqlite+aiosqlite:///file:x?mode=memory&uri=true", False),
    ],
)
def test_only_a_real_sqlite_file_counts_as_a_file_db(url: str, is_file: bool) -> None:
    assert base._is_sqlite_file_db(url) is is_file


def test_database_url_is_read_from_settings_on_first_use_and_kept(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Importing db.base reads nothing; the first call builds Settings() and keeps it."""
    monkeypatch.setattr(base, "_settings", None)
    monkeypatch.setenv("DATABASE_URL", " postgres://u:p@host/db ")
    assert base.database_url() == "postgresql+asyncpg://u:p@host/db"
    assert base.is_configured() is True
    monkeypatch.setenv("DATABASE_URL", "postgres://other/db")
    assert base.database_url() == "postgresql+asyncpg://u:p@host/db", "read once"


@pytest.mark.parametrize("raw", ["", "   "])
def test_a_blank_database_url_means_unconfigured(
    monkeypatch: pytest.MonkeyPatch, fresh_engine: None, raw: str
) -> None:
    monkeypatch.setattr(base, "_settings", None)
    monkeypatch.setenv("DATABASE_URL", raw)
    assert base.database_url() is None
    assert base.is_configured() is False


def test_engine_requires_a_database_url(
    monkeypatch: pytest.MonkeyPatch, fresh_engine: None
) -> None:
    _use_database_url(monkeypatch, None)
    assert base.is_configured() is False
    with pytest.raises(RuntimeError, match="DATABASE_URL is not configured"):
        base.get_engine()


async def test_a_sqlite_file_db_uses_no_pool(
    monkeypatch: pytest.MonkeyPatch, fresh_engine: None, tmp_path: Path
) -> None:
    _use_database_url(monkeypatch, f"sqlite+aiosqlite:///{tmp_path / 'x.db'}")
    engine = base.get_engine()
    try:
        assert isinstance(engine.pool, NullPool)
        assert base.get_engine() is engine, "the engine is built once"
    finally:
        await engine.dispose()


async def test_an_in_memory_sqlite_db_keeps_its_single_connection(
    monkeypatch: pytest.MonkeyPatch, fresh_engine: None
) -> None:
    _use_database_url(monkeypatch, "sqlite+aiosqlite:///:memory:")
    engine = base.get_engine()
    try:
        assert isinstance(engine.pool, StaticPool)
    finally:
        await engine.dispose()


async def test_postgres_gets_a_tuned_pool(
    monkeypatch: pytest.MonkeyPatch, fresh_engine: None
) -> None:
    """Building the engine does not connect, so no server is needed."""
    _use_database_url(monkeypatch, "postgresql+asyncpg://u:p@localhost/db")
    engine = base.get_engine()
    try:
        assert engine.dialect.name == "postgresql"
        assert engine.pool.size() == 5
    finally:
        await engine.dispose()


async def test_session_factory_is_built_once_and_does_not_expire_on_commit(
    monkeypatch: pytest.MonkeyPatch, fresh_engine: None, tmp_path: Path
) -> None:
    _use_database_url(monkeypatch, f"sqlite+aiosqlite:///{tmp_path / 'x.db'}")
    factory = base.get_session_factory()
    try:
        assert base.get_session_factory() is factory
        async with factory() as session:
            assert session.sync_session.expire_on_commit is False
    finally:
        await base.get_engine().dispose()


async def test_get_db_yields_a_session_and_closes_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The FastAPI dependency: a usable session with no transaction open, closed once the
    request ends."""
    dependency = base.get_db()
    session = await anext(dependency)
    assert isinstance(session, AsyncSession)
    assert session.in_transaction() is False

    close_calls = 0
    real_close = session.close

    async def tracking_close() -> None:
        nonlocal close_calls
        close_calls += 1
        await real_close()

    monkeypatch.setattr(session, "close", tracking_close)
    assert close_calls == 0, "the session stays open while the request runs"
    with pytest.raises(StopAsyncIteration):
        await anext(dependency)
    assert close_calls == 1

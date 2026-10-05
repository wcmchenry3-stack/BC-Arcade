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


def test_engine_requires_a_database_url(
    monkeypatch: pytest.MonkeyPatch, fresh_engine: None
) -> None:
    monkeypatch.setattr(base, "DATABASE_URL", None)
    assert base.is_configured() is False
    with pytest.raises(RuntimeError, match="DATABASE_URL is not configured"):
        base.get_engine()


async def test_a_sqlite_file_db_uses_no_pool(
    monkeypatch: pytest.MonkeyPatch, fresh_engine: None, tmp_path: Path
) -> None:
    monkeypatch.setattr(base, "DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'x.db'}")
    engine = base.get_engine()
    try:
        assert isinstance(engine.pool, NullPool)
        assert base.get_engine() is engine, "the engine is built once"
    finally:
        await engine.dispose()


async def test_an_in_memory_sqlite_db_keeps_its_single_connection(
    monkeypatch: pytest.MonkeyPatch, fresh_engine: None
) -> None:
    monkeypatch.setattr(base, "DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    engine = base.get_engine()
    try:
        assert isinstance(engine.pool, StaticPool)
    finally:
        await engine.dispose()


async def test_postgres_gets_a_tuned_pool(
    monkeypatch: pytest.MonkeyPatch, fresh_engine: None
) -> None:
    """Building the engine does not connect, so no server is needed."""
    monkeypatch.setattr(base, "DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")
    engine = base.get_engine()
    try:
        assert engine.dialect.name == "postgresql"
        assert engine.pool.size() == 5
    finally:
        await engine.dispose()


async def test_session_factory_is_built_once_and_does_not_expire_on_commit(
    monkeypatch: pytest.MonkeyPatch, fresh_engine: None, tmp_path: Path
) -> None:
    monkeypatch.setattr(base, "DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'x.db'}")
    factory = base.get_session_factory()
    try:
        assert base.get_session_factory() is factory
        async with factory() as session:
            assert session.sync_session.expire_on_commit is False
    finally:
        await base.get_engine().dispose()


async def test_get_session_yields_a_session_and_closes_it() -> None:
    """The FastAPI dependency: a usable session, closed when the request ends."""
    dependency = base.get_session()
    session = await anext(dependency)
    assert isinstance(session, AsyncSession)
    assert session.in_transaction() is False
    with pytest.raises(StopAsyncIteration):
        await anext(dependency)

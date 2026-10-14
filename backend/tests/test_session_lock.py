"""``db.locks.lock_session``: serialises one session's ceiling-checked appends (#3298)."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from db import locks
from tests._pg_scratch import require_pg_url, scratch_database


class _FakeSession:
    def __init__(self, dialect: str) -> None:
        self.bind = SimpleNamespace(dialect=SimpleNamespace(name=dialect))
        self.executed: list[tuple[str, dict]] = []

    async def execute(self, stmt, params=None):
        self.executed.append((str(stmt), params))


async def test_lock_is_a_no_op_on_sqlite() -> None:
    db = _FakeSession("sqlite")
    await locks.lock_session(db, "sid", locks.EVENTS_NAMESPACE)  # type: ignore[arg-type]
    assert db.executed == []


async def test_lock_issues_a_transaction_scoped_advisory_lock_on_postgres() -> None:
    db = _FakeSession("postgresql")
    await locks.lock_session(db, "sid", locks.BUG_LOGS_NAMESPACE)  # type: ignore[arg-type]
    timeout, lock, reset = db.executed
    assert timeout[0] == locks.LOCK_TIMEOUT_SQL
    sql, params = lock
    assert "pg_advisory_xact_lock" in sql and "hashtextextended" in sql
    assert params == {"sid": "sid", "ns": locks.BUG_LOGS_NAMESPACE}
    # the 2 s bound covers the advisory lock only, not later row locks
    assert reset[0] == locks.LOCK_TIMEOUT_RESET_SQL


def test_event_and_bug_log_paths_use_different_namespaces() -> None:
    assert locks.EVENTS_NAMESPACE != locks.BUG_LOGS_NAMESPACE


async def test_postgres_lock_blocks_a_second_transaction_until_commit() -> None:
    """Needs ``LEADERBOARD_EXPLAIN_PG_URL`` (skipped otherwise; run by the Postgres CI job)."""
    raw = require_pg_url()
    sid = str(uuid.uuid4())
    async with scratch_database(raw) as url:
        engine = create_async_engine(url)
        try:
            from sqlalchemy.ext.asyncio import AsyncSession

            try_lock = text("SELECT pg_try_advisory_xact_lock(hashtextextended(:sid, :ns))")
            args = {"sid": sid, "ns": locks.EVENTS_NAMESPACE}
            async with AsyncSession(engine) as a, AsyncSession(engine) as b:
                await locks.lock_session(a, sid, locks.EVENTS_NAMESPACE)
                assert (await b.execute(try_lock, args)).scalar_one() is False
                await b.rollback()
                # a different session id, and the other namespace, are not blocked
                other = {"sid": str(uuid.uuid4()), "ns": locks.EVENTS_NAMESPACE}
                assert (await b.execute(try_lock, other)).scalar_one() is True
                await b.rollback()
                other_ns = {"sid": sid, "ns": locks.BUG_LOGS_NAMESPACE}
                assert (await b.execute(try_lock, other_ns)).scalar_one() is True
                await b.rollback()
                await a.commit()  # releases the lock
                assert (await b.execute(try_lock, args)).scalar_one() is True
        finally:
            await engine.dispose()

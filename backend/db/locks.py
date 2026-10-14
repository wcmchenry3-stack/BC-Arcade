"""Per-session write serialisation for the storage ceilings (#3298).

``append_events`` and ``append_bug_logs`` read a running total, decide how much
room is left, then insert. Two concurrent requests for one session would each read
the same total and together overshoot. ``lock_session`` serialises them: it takes
a Postgres transaction-scoped advisory lock keyed on the session id, held until
the caller's commit or rollback, so the second request reads the first's result.

Transaction-scoped (``pg_advisory_xact_lock``), never session-scoped: it is
released by the transaction ending, so a pooled connection cannot leak it. That
also works behind Supabase's session-mode pooler, and would behind a
transaction-mode one, because the lock lives and dies inside one transaction.

A wait longer than 2 s raises ``SessionBusy`` (SQLSTATE 55P03; ``main`` answers 503).

SQLite (the test database) serialises writers itself, so there it does nothing.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from db.dialect import dialect_name

# Distinct namespaces (the hash seed), so the event and bug-log paths of one session
# do not block each other.
EVENTS_NAMESPACE = 3298_01
BUG_LOGS_NAMESPACE = 3298_02

LOCK_TIMEOUT_SQL = "SET LOCAL lock_timeout = '2s'"
_LOCK_NOT_AVAILABLE = "55P03"


class SessionBusy(Exception):
    """Another request holds this session's lock past the timeout: answer 503, retry."""


LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended(:sid, :ns))"


async def lock_session(db: AsyncSession, session_id: str, namespace: int) -> None:
    """Block until no other open transaction holds ``(session_id, namespace)``.

    Call it before reading the counters the decision depends on, and commit only
    after the insert, so check and insert share one transaction.
    """
    if dialect_name(db) == "sqlite":
        return
    # A bounded wait: a waiter must not sit on a pool connection behind a stuck holder.
    await db.execute(text(LOCK_TIMEOUT_SQL))
    try:
        await db.execute(text(LOCK_SQL), {"sid": session_id, "ns": namespace})
    except DBAPIError as exc:
        if _sqlstate(exc) == _LOCK_NOT_AVAILABLE:
            raise SessionBusy(session_id) from exc
        raise


def _sqlstate(exc: DBAPIError) -> str | None:
    """The SQLSTATE of a driver error (asyncpg ``sqlstate``, psycopg ``pgcode``)."""
    orig = exc.orig
    for candidate in (orig, getattr(orig, "__cause__", None)):
        code = getattr(candidate, "sqlstate", None) or getattr(candidate, "pgcode", None)
        if code:
            return str(code)
    return None

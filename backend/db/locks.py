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

SQLite (the test database) serialises writers itself, so there it does nothing.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from db.dialect import dialect_name

# Distinct namespaces (the hash seed), so the event and bug-log paths of one session
# do not block each other.
EVENTS_NAMESPACE = 3298_01
BUG_LOGS_NAMESPACE = 3298_02

LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended(:sid, :ns))"


async def lock_session(db: AsyncSession, session_id: str, namespace: int) -> None:
    """Block until no other open transaction holds ``(session_id, namespace)``.

    Call it before reading the counters the decision depends on, and commit only
    after the insert, so check and insert share one transaction.
    """
    if dialect_name(db) == "sqlite":
        return
    await db.execute(text(LOCK_SQL), {"sid": session_id, "ns": namespace})

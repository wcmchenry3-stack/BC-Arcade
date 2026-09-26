"""Dialect-aware upsert helper shared by service modules (#2675).

Postgres runs in production; SQLite runs the test suite. ``players.service``,
``games.service`` and ``logs.service`` each need the dialect's own
``insert()`` construct to build an ``ON CONFLICT`` upsert — the generic
``sqlalchemy.insert`` has no ``on_conflict_do_nothing``/``on_conflict_do_update``.
Centralised here so a future change, such as the ``db.bind is None`` fallback,
lands once.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.dml import Insert


def dialect_name(session: AsyncSession) -> str:
    """The session's dialect, defaulting to Postgres when it has no bind."""
    return session.bind.dialect.name if session.bind else "postgresql"


def dialect_insert(session: AsyncSession, table: Any) -> Insert:
    """The dialect-specific ``insert()`` construct for *table*, unexecuted.

    Callers chain ``.values()`` and ``on_conflict_do_nothing``/
    ``on_conflict_do_update`` onto the result.
    """
    if dialect_name(session) == "sqlite":
        return sqlite.insert(table)
    return postgresql.insert(table)

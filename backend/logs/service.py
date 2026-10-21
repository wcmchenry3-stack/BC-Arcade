"""DB service for the bug log write API (#364)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.dialect import dialect_insert
from db.locks import BUG_LOGS_NAMESPACE, lock_session
from db.models import BugLog
from payload_size import json_bytes
from settings import Settings

_settings: Settings | None = None


def _get_settings() -> Settings:
    """``MAX_BUG_LOG_CONTEXT_BYTES`` / ``MAX_BUG_LOGS_PER_SESSION``, read lazily."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


@dataclass
class BugLogResult:
    accepted: int
    duplicates: int
    dropped: int = 0


def _upsert_ignore(session: AsyncSession, table, rows: list[dict]):
    return dialect_insert(session, table).values(rows).on_conflict_do_nothing()


def _context_fits(log: dict[str, Any], limit: int) -> bool:
    """False for an over-size context, or one with a lone surrogate (no UTF-8 form, so
    unstorable: dropped with a 2xx like an oversized one, never a 500; #3352)."""
    try:
        return json_bytes(log.get("context") or {}) <= limit
    except UnicodeEncodeError:
        return False


async def append_bug_logs(
    session: AsyncSession,
    *,
    session_id: str,
    logs: list[dict[str, Any]],
) -> BugLogResult:
    """Store the logs; drop (not refuse) over-size or over-ceiling ones (#3298).

    The client dead-letters a whole 50-log chunk on any 4xx, so one bad log
    would cost its neighbours. Dropped logs return a 2xx and count in ``dropped``.
    """
    cfg = _get_settings()
    # Serialise this session's appends (Postgres) so the count below is current and the
    # insert commits in the same transaction: a session ends at most one log over its ceiling.
    await lock_session(session, session_id, BUG_LOGS_NAMESPACE)
    kept = [log for log in logs if _context_fits(log, cfg.max_bug_log_context_bytes)]
    ids: list[uuid.UUID] = [log["id"] for log in kept]

    existing_set: set[uuid.UUID] = set()
    if ids:
        existing = (
            (await session.execute(select(BugLog.id).where(BugLog.id.in_(ids)))).scalars().all()
        )
        existing_set = set(existing)

    # Per-session ceiling: only new rows count against the room left.
    stored = (
        await session.execute(
            select(func.count()).select_from(BugLog).where(BugLog.session_id == session_id)
        )
    ).scalar_one()
    room = max(cfg.max_bug_logs_per_session - stored, 0)
    fresh: list[dict[str, Any]] = []
    seen: set[uuid.UUID] = set()
    over_ceiling = 0
    for log in kept:
        if log["id"] in existing_set or log["id"] in seen:
            continue
        seen.add(log["id"])
        if len(fresh) < room:
            fresh.append(log)
        else:
            over_ceiling += 1

    rows = [
        {
            "id": log["id"],
            "session_id": session_id,
            "logged_at": log["logged_at"],
            "level": log["level"],
            "source": log["source"],
            "message": log["message"],
            "context": log.get("context") or {},
        }
        for log in fresh
    ]
    if rows:
        await session.execute(_upsert_ignore(session, BugLog.__table__, rows))
        await session.commit()
    else:
        # Nothing to write: end the transaction now, releasing the session lock early.
        await session.rollback()

    duplicates = sum(1 for i in ids if i in existing_set)
    return BugLogResult(
        accepted=len(rows),
        duplicates=duplicates,
        dropped=(len(logs) - len(kept)) + over_ceiling,
    )

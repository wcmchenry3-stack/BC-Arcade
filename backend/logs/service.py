"""DB service for the bug log write API (#364)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.dialect import dialect_insert
from db.models import BugLog


@dataclass
class BugLogResult:
    accepted: int
    duplicates: int


def _upsert_ignore(session: AsyncSession, table, rows: list[dict]):
    return dialect_insert(session, table).values(rows).on_conflict_do_nothing()


async def append_bug_logs(
    session: AsyncSession,
    *,
    session_id: str,
    logs: list[dict[str, Any]],
) -> BugLogResult:
    ids: list[uuid.UUID] = [log["id"] for log in logs]

    existing = (await session.execute(select(BugLog.id).where(BugLog.id.in_(ids)))).scalars().all()
    existing_set = set(existing)

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
        for log in logs
    ]

    stmt = _upsert_ignore(session, BugLog.__table__, rows)
    await session.execute(stmt)
    await session.commit()

    duplicates = sum(1 for i in ids if i in existing_set)
    return BugLogResult(accepted=len(ids) - duplicates, duplicates=duplicates)

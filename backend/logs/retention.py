"""Retention for ``bug_logs`` (#3298).

Rows were only ever removed by ``DELETE /me``. They are now deleted once
``received_at`` is older than ``BUG_LOG_RETENTION_DAYS`` (default 90), in
batches so one run never holds a long lock. Only ``bug_logs`` is touched; game
events have their own retention decision (#3306).

Runs in-process at startup and then every 24 h (``jobs.lifespan``), like
``daily_word.retention``; idempotent if several instances run it at once.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.models import BugLog
from jobs.periodic import PeriodicJob
from settings import Settings

PRUNE_INTERVAL_S = 24 * 60 * 60
PRUNE_TIMEOUT_S = 300.0
BATCH_SIZE = 1000

logger = logging.getLogger(__name__)

_settings: Settings | None = None


def _retention() -> timedelta:
    global _settings
    if _settings is None:
        _settings = Settings()
    return timedelta(days=_settings.bug_log_retention_days)


async def prune_expired_bug_logs(
    session: AsyncSession,
    *,
    now: datetime | None = None,
    retention: timedelta | None = None,
    batch_size: int = BATCH_SIZE,
) -> int:
    """Delete bug logs received before ``now - retention``, ``batch_size`` at a time."""
    cutoff = (now or datetime.now(UTC)) - (retention or _retention())
    total = 0
    while True:
        ids = (
            (
                await session.execute(
                    select(BugLog.id).where(BugLog.received_at < cutoff).limit(batch_size)
                )
            )
            .scalars()
            .all()
        )
        if not ids:
            return total
        await session.execute(delete(BugLog).where(BugLog.id.in_(ids)))
        await session.commit()
        total += len(ids)


async def _prune_once(get_session_factory: Callable[[], async_sessionmaker[AsyncSession]]) -> None:
    async with get_session_factory()() as db:
        pruned = await prune_expired_bug_logs(db)
    logger.info("bug_logs retention: pruned %d rows", pruned)


def retention_job(
    get_session_factory: Callable[[], async_sessionmaker[AsyncSession]],
    *,
    interval_s: float = PRUNE_INTERVAL_S,
    timeout_s: float = PRUNE_TIMEOUT_S,
) -> PeriodicJob:
    """Prune now, then every ``interval_s``; failures are reported and retried next cycle."""
    return PeriodicJob(
        name="bug_logs_retention",
        run=lambda: _prune_once(get_session_factory),
        interval_s=interval_s,
        timeout_s=timeout_s,
        subsystem_tag="logs.retention",
        fingerprint="bug-logs-retention-prune-failed",
        on_failure=lambda exc: logger.warning("bug_logs retention: prune failed", exc_info=exc),
        on_stop_timeout=lambda waited: logger.warning(
            "bug_logs retention: task still running %.0fs after cancel; not waiting", waited
        ),
        reraise_on_crash=True,
    )

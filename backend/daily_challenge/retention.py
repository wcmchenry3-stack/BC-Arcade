"""Retention for ``daily_challenge_assignments`` (#3992).

One row per install per local day served (``assignments.get_or_pin``). A row's
only readers are the day's own ``/status`` / ``/upcoming`` and the streak, which
looks back ``STREAK_LOOKBACK_DAYS``; an older row is never read, so it is deleted
once its ``local_date`` is more than ``DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS``
(default and minimum ``STREAK_LOOKBACK_DAYS`` + 1, so 61) before today in UTC. A
day pruned by mistake is harmless: the streak replays it from the shared frozen
template.

The cutoff is UTC's date, and a client west of UTC is up to a local day behind it.
The one extra day of retention covers that, so the oldest day of any client's
streak window is never pruned early.

Deleted in batches of ``PRUNE_BATCH_SIZE``, each its own statement and commit,
like ``daily_word.retention`` (#3302), so no single DELETE comes near the 5 s
``statement_timeout``. There is no index on ``local_date``: the table is bounded
by this prune, and one scan a day is cheaper than an index on every row.

Runs in-process at startup and then every 24 h (``jobs.lifespan``); idempotent if
several instances run it at once.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import delete, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from daily_challenge.assignments import retention_days
from db.models import DailyChallengeAssignment
from jobs.periodic import PeriodicJob

PRUNE_INTERVAL_S = 24 * 60 * 60
PRUNE_TIMEOUT_S = 60.0
PRUNE_BATCH_SIZE = 5000

logger = logging.getLogger(__name__)


def cutoff_date(now: datetime | None = None, retention: int | None = None) -> date:
    """Rows with ``local_date`` before this are deleted."""
    days = retention_days() if retention is None else retention
    return (now or datetime.now(UTC)).date() - timedelta(days=days)


async def prune_expired_assignments(
    session: AsyncSession,
    *,
    now: datetime | None = None,
    retention: int | None = None,
    batch_size: int = PRUNE_BATCH_SIZE,
) -> int:
    """Delete assignments whose ``local_date`` is before ``cutoff_date``. Returns how many went."""
    cutoff = cutoff_date(now, retention)
    key = tuple_(DailyChallengeAssignment.session_id, DailyChallengeAssignment.local_date)
    expired = (
        select(DailyChallengeAssignment.session_id, DailyChallengeAssignment.local_date)
        .where(DailyChallengeAssignment.local_date < cutoff)
        .limit(batch_size)
    )
    total = 0
    while True:
        result = await session.execute(
            delete(DailyChallengeAssignment)
            .where(key.in_(expired), DailyChallengeAssignment.local_date < cutoff)
            .execution_options(synchronize_session=False)
        )
        await session.commit()
        deleted = result.rowcount or 0
        total += deleted
        if deleted < batch_size:
            return total


async def _prune_once(get_session_factory: Callable[[], async_sessionmaker[AsyncSession]]) -> None:
    async with get_session_factory()() as db:
        pruned = await prune_expired_assignments(db)
    logger.info("daily_challenge retention: pruned %d assignment rows", pruned)


def retention_job(
    get_session_factory: Callable[[], async_sessionmaker[AsyncSession]],
    *,
    interval_s: float = PRUNE_INTERVAL_S,
    timeout_s: float = PRUNE_TIMEOUT_S,
) -> PeriodicJob:
    """Prune now, then every ``interval_s`` (started by ``jobs.lifespan``).

    A failed or stalled prune is logged at WARNING and retried next cycle; it never
    takes the app down (see ``daily_word.retention.retention_job``).
    """
    return PeriodicJob(
        name="daily_challenge_retention",
        run=lambda: _prune_once(get_session_factory),
        interval_s=interval_s,
        timeout_s=timeout_s,
        subsystem_tag="daily_challenge.retention",
        fingerprint="daily-challenge-retention-prune-failed",
        on_failure=lambda exc: logger.warning(
            "daily_challenge retention: prune failed", exc_info=exc
        ),
        on_stop_timeout=lambda waited: logger.warning(
            "daily_challenge retention: task still running %.0fs after cancel; not waiting",
            waited,
        ),
        reraise_on_crash=True,
    )

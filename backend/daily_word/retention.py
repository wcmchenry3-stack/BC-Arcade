"""Retention for ``daily_word_progress`` (#2544).

The table gets one row per (session, puzzle) that lands a scored guess, and
nothing else ever deleted them: legitimate play adds a row per device per day,
and because sessions are self-asserted (#1047) one IP can mint sessions and
add up to ~28.8k rows/day under the 1200/hour guess backstop.

A row's only readers are:

* ``/guess`` and ``/answer`` — for today's puzzle only;
* ``DailyWordModule.reconcile_result`` (#2541) — when a game *completes*, which
  can be up to 7 days late: the app's offline event queue keeps a finished game
  for ``TTL_MS`` = 7 d (``frontend/src/game/_shared/eventQueueConfig.ts``).

So rows are kept for 14 days — the offline window plus margin — and pruned by
``updated_at`` (indexed, migration 0024). Deleting is safe: a pruned puzzle's ``/answer`` returns the same
403 as one the session never played, and a completion with no row keeps the
client's count, as it already does when the record was unreachable (#2542).

The prune runs in-process at startup and then every 24 h (``jobs.lifespan``): no new
infrastructure, the same on dev and prod, and idempotent if several instances
run it at once. Owner decision recorded on #2544.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.models import DailyWordProgress
from jobs.periodic import PeriodicJob

RETENTION = timedelta(days=14)
PRUNE_INTERVAL_S = 24 * 60 * 60
# Bounds one prune the way main._ping_db bounds its query: a pooler that
# accepts the connection and then stalls must not hang the loop forever,
# silently ending all future prunes (#2661 review).
PRUNE_TIMEOUT_S = 60.0

logger = logging.getLogger(__name__)


async def prune_expired_progress(session: AsyncSession, *, now: datetime | None = None) -> int:
    """Delete rows not updated within ``RETENTION``. Returns how many went."""
    cutoff = (now or datetime.now(UTC)) - RETENTION
    result = await session.execute(
        delete(DailyWordProgress).where(DailyWordProgress.updated_at < cutoff)
    )
    await session.commit()
    return result.rowcount or 0


async def _prune_once(get_session_factory: Callable[[], async_sessionmaker[AsyncSession]]) -> None:
    # The factory getter is called here, inside the job's error handling: building
    # the engine from a malformed DATABASE_URL raises, and at startup that would
    # have aborted the whole app (#2661 review).
    async with get_session_factory()() as db:
        pruned = await prune_expired_progress(db)
    logger.info("daily_word retention: pruned %d progress rows", pruned)


def retention_job(
    get_session_factory: Callable[[], async_sessionmaker[AsyncSession]],
    *,
    interval_s: float = PRUNE_INTERVAL_S,
    timeout_s: float = PRUNE_TIMEOUT_S,
) -> PeriodicJob:
    """Prune now, then every ``interval_s`` (started by ``jobs.lifespan``).

    A failed or stalled prune is reported and retried next cycle; it must never
    take the app down. Logged at WARNING, not ERROR/exception: sentry-sdk's
    default logging integration turns ERROR records into events, so logging at
    ERROR plus capture_exception reported every failure twice, once without the
    tag or fingerprint (#2661 review). ``reraise_on_crash``: shutdown surfaces a
    crashed retention task (#2994 owner decision).
    """
    return PeriodicJob(
        name="daily_word_retention",
        run=lambda: _prune_once(get_session_factory),
        interval_s=interval_s,
        timeout_s=timeout_s,
        subsystem_tag="daily_word.retention",
        fingerprint="daily-word-retention-prune-failed",
        on_failure=lambda exc: logger.warning("daily_word retention: prune failed", exc_info=exc),
        on_stop_timeout=lambda waited: logger.warning(
            "daily_word retention: task still running %.0fs after cancel; not waiting", waited
        ),
        reraise_on_crash=True,
    )

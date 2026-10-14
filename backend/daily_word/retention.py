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
``updated_at`` (indexed, migration 0024), in batches of ``PRUNE_BATCH_SIZE``
(#3302). Deleting is safe: a pruned puzzle's ``/answer`` returns the same
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

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.models import DailyWordProgress
from jobs.periodic import PeriodicJob

RETENTION = timedelta(days=14)
PRUNE_INTERVAL_S = 24 * 60 * 60
# Bounds one prune the way main._ping_db bounds its query: a pooler that
# accepts the connection and then stalls must not hang the loop forever,
# silently ending all future prunes (#2661 review).
PRUNE_TIMEOUT_S = 60.0
# Rows per DELETE: the indexed updated_at lookup plus 5000 row deletes stays well
# under a second, far inside the 5 s statement_timeout (#3302).
PRUNE_BATCH_SIZE = 5000

logger = logging.getLogger(__name__)


async def prune_expired_progress(
    session: AsyncSession,
    *,
    now: datetime | None = None,
    batch_size: int = PRUNE_BATCH_SIZE,
) -> int:
    """Delete rows not updated within ``RETENTION``. Returns how many went.

    In batches of ``batch_size`` rows, each its own statement and commit, so no
    single DELETE comes near the API's 5 s ``statement_timeout`` (#3302) however
    large the backlog is. ``timeout_s`` on the job bounds the whole run; batches
    already committed when it fires stay deleted and the next run carries on.
    The batch is chosen by primary key, which works on SQLite as well as Postgres.
    """
    cutoff = (now or datetime.now(UTC)) - RETENTION
    expired = (
        select(DailyWordProgress.id).where(DailyWordProgress.updated_at < cutoff).limit(batch_size)
    )
    total = 0
    while True:
        result = await session.execute(
            delete(DailyWordProgress)
            .where(DailyWordProgress.id.in_(expired))
            .execution_options(synchronize_session=False)
        )
        await session.commit()
        deleted = result.rowcount or 0
        total += deleted
        if deleted < batch_size:
            return total


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

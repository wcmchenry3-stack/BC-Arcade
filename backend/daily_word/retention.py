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

The prune runs in-process at startup and then every 24 h (``main.py``): no new
infrastructure, the same on dev and prod, and idempotent if several instances
run it at once. Owner decision recorded on #2544.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

import sentry_sdk
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.models import DailyWordProgress

RETENTION = timedelta(days=14)
PRUNE_INTERVAL_S = 24 * 60 * 60
# Bounds one prune the way main._ping_db bounds its query: a pooler that
# accepts the connection and then stalls must not hang the loop forever,
# silently ending all future prunes (#2661 review).
PRUNE_TIMEOUT_S = 60.0

logger = logging.getLogger(__name__)


async def prune_expired_progress(session: AsyncSession, *, now: datetime | None = None) -> int:
    """Delete rows not updated within ``RETENTION``. Returns how many went."""
    cutoff = (now or datetime.now(timezone.utc)) - RETENTION
    result = await session.execute(
        delete(DailyWordProgress).where(DailyWordProgress.updated_at < cutoff)
    )
    await session.commit()
    return result.rowcount or 0


async def run_retention_loop(
    get_session_factory: Callable[[], async_sessionmaker[AsyncSession]],
    *,
    interval_s: float = PRUNE_INTERVAL_S,
    timeout_s: float = PRUNE_TIMEOUT_S,
) -> None:
    """Prune now, then every ``interval_s``, until cancelled.

    Takes the factory *getter*, not a factory, and calls it inside the error
    handling each cycle: building the engine from a malformed DATABASE_URL
    raises, and at startup that would have aborted the whole app (#2661
    review). A failed or stalled prune is reported and retried next cycle — it
    must never take the app down, and at one attempt a day it cannot flood.
    """
    while True:
        try:
            async with get_session_factory()() as db:
                pruned = await asyncio.wait_for(prune_expired_progress(db), timeout=timeout_s)
            logger.info("daily_word retention: pruned %d progress rows", pruned)
        except Exception as exc:  # any failure waits for the next cycle
            # WARNING, not ERROR/exception: sentry-sdk's default logging
            # integration turns ERROR records into events, so logger.exception
            # plus capture_exception reported every failure twice — once
            # without this tag or fingerprint (#2661 review).
            logger.warning("daily_word retention: prune failed", exc_info=True)
            with sentry_sdk.new_scope() as scope:
                scope.set_tag("subsystem", "daily_word.retention")
                scope.fingerprint = ["daily-word-retention-prune-failed"]
                sentry_sdk.capture_exception(exc)
        await asyncio.sleep(interval_s)

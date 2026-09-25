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
``updated_at``. Deleting is safe: a pruned puzzle's ``/answer`` returns the same
403 as one the session never played, and a completion with no row keeps the
client's count, as it already does when the record was unreachable (#2542).

The prune runs in-process at startup and then every 24 h (``main.py``): no new
infrastructure, the same on dev and prod, and idempotent if several instances
run it at once. Owner decision recorded on #2544.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import sentry_sdk
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import DailyWordProgress

RETENTION = timedelta(days=14)
PRUNE_INTERVAL_S = 24 * 60 * 60

logger = logging.getLogger(__name__)


async def prune_expired_progress(session: AsyncSession, *, now: datetime | None = None) -> int:
    """Delete rows not updated within ``RETENTION``. Returns how many went."""
    cutoff = (now or datetime.now(timezone.utc)) - RETENTION
    result = await session.execute(
        delete(DailyWordProgress).where(DailyWordProgress.updated_at < cutoff)
    )
    await session.commit()
    return result.rowcount or 0


async def run_retention_loop(session_factory, *, interval_s: float = PRUNE_INTERVAL_S) -> None:
    """Prune now, then every ``interval_s``, until cancelled.

    A failed prune is reported and retried next cycle — it must never take the
    app down, and at one attempt a day it cannot flood Sentry.
    """
    while True:
        try:
            async with session_factory() as db:
                pruned = await prune_expired_progress(db)
            logger.info("daily_word retention: pruned %d progress rows", pruned)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # any failure waits for the next cycle
            logger.exception("daily_word retention: prune failed")
            with sentry_sdk.new_scope() as scope:
                scope.set_tag("subsystem", "daily_word.retention")
                scope.fingerprint = ["daily-word-retention-prune-failed"]
                sentry_sdk.capture_exception(exc)
        await asyncio.sleep(interval_s)

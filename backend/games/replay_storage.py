"""Replay-event retention and the storage-budget check (#3292, epic #3273).

Prod Supabase is on the Free plan (500 MB for the whole database), and hitting
that limit stops the service, so recorded replays must never fill it. Three
bounds, cheapest first:

* the per-game caps in ``games.replay_caps`` (applied on write);
* retention: replay rows older than ``REPLAY_RETENTION_DAYS`` (default 30) are
  deleted, in bounded batches. Lifecycle rows (``LIFECYCLE_EVENT_NAMES``) and
  ``games`` rows are never touched, so history, stats and the boards are
  unaffected;
* the budget: ``pg_total_relation_size('game_events')`` against
  ``REPLAY_STORAGE_BUDGET_MB``, reported to Sentry at 50 / 75 / 90 %.

Both run once a day, off peak (from ``REPLAY_JOB_HOUR_UTC``), in-process on the
``PeriodicJob`` framework (``jobs.lifespan``), like Daily Word retention: the
job wakes hourly and does its work the first time it wakes in or after that
hour each UTC day. Several instances running it at once is harmless.

Bytes per game, the days of headroom and the knobs are in
docs/DATA-INVENTORY.md §2a.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import delete, select, text, tuple_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.dialect import dialect_name
from db.models import EventType, GameEvent
from games.replay_caps import LIFECYCLE_EVENT_NAMES
from jobs.periodic import PeriodicJob
from observability.report import report_event
from settings import Settings

logger = logging.getLogger(__name__)

# Rows deleted per statement, and statements per run: one run removes at most
# 1M rows, in short transactions that never hold a long lock.
PRUNE_BATCH_SIZE = 5_000
PRUNE_MAX_BATCHES = 200

# The job wakes hourly; each run does real work at most once a UTC day.
TICK_INTERVAL_S = 60 * 60
RUN_TIMEOUT_S = 15 * 60

# Fractions of the budget that report, lowest first.
BUDGET_THRESHOLDS: tuple[float, ...] = (0.5, 0.75, 0.9)
EXCEEDED_THRESHOLD = 0.9
BUDGET_FINGERPRINT = "games-replay-storage-budget"
_LEVELS = {0.5: "info", 0.75: "warning", 0.9: "error"}

_settings: Settings | None = None


def _get_settings() -> Settings:
    """``REPLAY_*`` (settings.py), read lazily."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def retention() -> timedelta:
    return timedelta(days=_get_settings().replay_retention_days)


def budget_bytes() -> int:
    return _get_settings().replay_storage_budget_mb * 1024 * 1024


def job_hour_utc() -> int:
    return _get_settings().replay_job_hour_utc


# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------


def retention_cutoff(now: datetime, keep: timedelta) -> datetime:
    """Replay rows received before this are pruned (``occurred_at`` is server time)."""
    return now - keep


async def prune_replay_events(
    session: AsyncSession,
    *,
    now: datetime | None = None,
    keep: timedelta | None = None,
    batch_size: int = PRUNE_BATCH_SIZE,
    max_batches: int = PRUNE_MAX_BATCHES,
) -> int:
    """Delete replay rows older than ``keep`` (default ``retention()``), in batches.

    Each batch is its own ``DELETE`` of at most ``batch_size`` rows, committed
    before the next; the loop stops when a batch comes back short or after
    ``max_batches``, and the next run carries on. Returns the rows deleted.
    """
    cutoff = retention_cutoff(now or datetime.now(UTC), keep or retention())
    replay_type_ids = select(EventType.id).where(EventType.name.notin_(LIFECYCLE_EVENT_NAMES))
    total = 0
    for _ in range(max_batches):
        victims = (
            select(GameEvent.game_id, GameEvent.event_index)
            .where(GameEvent.occurred_at < cutoff, GameEvent.event_type_id.in_(replay_type_ids))
            .limit(batch_size)
        )
        result = await session.execute(
            delete(GameEvent)
            .where(tuple_(GameEvent.game_id, GameEvent.event_index).in_(victims))
            .execution_options(synchronize_session=False)
        )
        await session.commit()
        deleted = result.rowcount or 0
        total += deleted
        if deleted < batch_size:
            break
    return total


# ---------------------------------------------------------------------------
# Budget
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class StorageSize:
    events_bytes: int  # pg_total_relation_size('game_events'): table, indexes, TOAST
    database_bytes: int  # pg_database_size(current_database())


async def measure_storage(session: AsyncSession) -> StorageSize | None:
    """The sizes on Postgres; ``None`` on SQLite (tests), which has no such functions."""
    if dialect_name(session) == "sqlite":
        return None
    row = (
        await session.execute(
            text(
                "SELECT pg_total_relation_size('game_events'), "
                "pg_database_size(current_database())"
            )
        )
    ).one()
    return StorageSize(events_bytes=int(row[0]), database_bytes=int(row[1]))


def crossed_threshold(used: int, budget: int) -> float | None:
    """The highest of ``BUDGET_THRESHOLDS`` that ``used / budget`` has reached."""
    ratio = used / budget
    reached = [t for t in BUDGET_THRESHOLDS if ratio >= t]
    return reached[-1] if reached else None


def on_budget_exceeded(size: StorageSize, budget: int) -> None:
    """Called when replay storage reaches 90 % of its budget.

    It only reports for now (the 90 % event ``check_storage_budget`` sends).
    TODO(#3279): turn recording down server-side here — lower
    ``game_types.replay_sample_rate`` / clear ``replay_enabled`` (owner
    decision #3307) — once #3279 adds those columns.
    """
    logger.warning(
        "replay storage at or over %d%% of budget (%d of %d bytes); "
        "automatic turn-down pending #3279",
        int(EXCEEDED_THRESHOLD * 100),
        size.events_bytes,
        budget,
    )


async def check_storage_budget(
    session: AsyncSession,
    *,
    budget: int | None = None,
    measure: Callable[[AsyncSession], Awaitable[StorageSize | None]] | None = None,
) -> float | None:
    """Measure, report the highest threshold crossed, and call the 90 % hook.

    One Sentry event per run (so per day), grouped per threshold. Returns the
    threshold crossed, or ``None`` when under 50 % or not measurable.
    """
    budget = budget if budget is not None else budget_bytes()
    size = await (measure or measure_storage)(session)
    if size is None:
        return None
    threshold = crossed_threshold(size.events_bytes, budget)
    logger.info(
        "replay storage: game_events %d bytes, database %d bytes, budget %d bytes",
        size.events_bytes,
        size.database_bytes,
        budget,
    )
    if threshold is None:
        return None
    pct = int(threshold * 100)
    report_event(
        f"Replay storage at {pct}% of budget",
        level=_LEVELS[threshold],
        fingerprint=[BUDGET_FINGERPRINT, str(pct)],
        tags={"subsystem": "games.replay_storage", "threshold": str(pct)},
        context={
            "replay_storage": {
                "game_events_bytes": size.events_bytes,
                "database_bytes": size.database_bytes,
                "budget_bytes": budget,
                "used_ratio": round(size.events_bytes / budget, 4),
            }
        },
    )
    if threshold >= EXCEEDED_THRESHOLD:
        on_budget_exceeded(size, budget)
    return threshold


# ---------------------------------------------------------------------------
# The daily job
# ---------------------------------------------------------------------------


@dataclass
class DailyGate:
    """Due once per UTC day, from ``hour`` on, until a run succeeds (in-process)."""

    hour: Callable[[], int] = job_hour_utc
    last_run: date | None = field(default=None)

    def due(self, now: datetime) -> bool:
        return now.hour >= self.hour() and self.last_run != now.date()

    def done(self, now: datetime) -> None:
        self.last_run = now.date()


# The process's gate: a job rebuilt by a new app lifespan keeps today's run.
_process_gate = DailyGate()


async def run_daily(
    get_session_factory: Callable[[], async_sessionmaker[AsyncSession]],
    gate: DailyGate,
    *,
    now: datetime | None = None,
) -> bool:
    """Prune, then check the budget — if the gate says today's run is due."""
    now = now or datetime.now(UTC)
    if not gate.due(now):
        return False
    # The factory getter is called here, inside the job's error handling, as in
    # daily_word.retention: a malformed DATABASE_URL must not abort startup.
    async with get_session_factory()() as db:
        pruned = await prune_replay_events(db, now=now)
        logger.info("replay retention: pruned %d replay event rows", pruned)
        await check_storage_budget(db)
    gate.done(now)
    return True


def replay_storage_job(
    get_session_factory: Callable[[], async_sessionmaker[AsyncSession]],
    *,
    interval_s: float = TICK_INTERVAL_S,
    timeout_s: float = RUN_TIMEOUT_S,
    gate: DailyGate | None = None,
) -> PeriodicJob:
    """The hourly tick that runs ``run_daily`` (started by ``jobs.lifespan``).

    A failed run is reported and retried next tick (at most hourly); only a
    successful run closes the day's gate. Logged at WARNING (an ERROR record
    would be a second Sentry event).
    """
    gate = gate or _process_gate
    return PeriodicJob(
        name="replay_storage",
        run=lambda: run_daily(get_session_factory, gate),
        interval_s=interval_s,
        timeout_s=timeout_s,
        subsystem_tag="games.replay_storage",
        fingerprint="games-replay-storage-run-failed",
        on_failure=lambda exc: logger.warning("replay storage: run failed", exc_info=exc),
        on_stop_timeout=lambda waited: logger.warning(
            "replay storage: task still running %.0fs after cancel; not waiting", waited
        ),
    )

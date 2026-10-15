"""Replay-event retention and the storage-budget check (#3292, epic #3273).

Prod Supabase is on the Free plan (500 MB for the whole database), and hitting
that limit stops the service, so recorded replays must never fill it. Three
bounds, cheapest first:

* the per-game caps in ``games.replay_caps`` (applied on write);
* retention: replay rows older than ``REPLAY_RETENTION_DAYS`` (default 30) are
  deleted, in bounded batches. Lifecycle rows (``LIFECYCLE_EVENT_NAMES``), the
  keep-list (``RETENTION_KEEP_NAMES``: per-game summaries, owner decision
  #3317) and ``games`` rows are never touched, so history, stats and the
  boards are unaffected;
* the budget: ``pg_total_relation_size('game_events')`` against
  ``REPLAY_STORAGE_BUDGET_MB`` and ``pg_database_size`` against
  ``DATABASE_PLAN_MB``, whichever is fuller, reported to Sentry at 50 / 75 / 90 %.

Both run once a day, off peak, in-process on the ``PeriodicJob`` framework
(``jobs.lifespan``), like Daily Word retention: the job wakes hourly and does
its work the first time it wakes inside the window ``REPLAY_JOB_HOUR_UTC`` to
``+ RUN_WINDOW_HOURS`` each UTC day (the window does not wrap past midnight).
On Postgres the run takes a transaction-level advisory lock on a session of
its own (``pg_try_advisory_xact_lock``), so a second instance skips the run
instead of contending; the lock goes when that session closes, however the
run ends.

Bytes per game, the days of headroom and the knobs are in
docs/DATA-INVENTORY.md §2a.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import bindparam, delete, select, text, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.dialect import dialect_name
from db.models import EventType, Game, GameEvent
from games.replay_caps import LIFECYCLE_EVENT_NAMES, RETENTION_KEEP_NAMES
from games.sessions import deleted_sizes, minus_clamped
from jobs.periodic import PeriodicJob
from observability.report import report_event
from settings import Settings

logger = logging.getLogger(__name__)

# Event types retention never deletes.
KEPT_EVENT_NAMES: frozenset[str] = LIFECYCLE_EVENT_NAMES | RETENTION_KEEP_NAMES

# Rows deleted per statement, and statements per run: one run removes at most
# 1M rows, in short transactions that never hold a long lock.
PRUNE_BATCH_SIZE = 5_000
PRUNE_MAX_BATCHES = 200

# The job wakes hourly; each run does real work at most once a UTC day, and
# only inside the off-peak window.
TICK_INTERVAL_S = 60 * 60
RUN_TIMEOUT_S = 15 * 60
RUN_WINDOW_HOURS = 3
# pg_try_advisory_xact_lock key: "3292" + "01".
ADVISORY_LOCK_KEY = 329_201

# Fractions of the budget that report, lowest first.
BUDGET_THRESHOLDS: tuple[float, ...] = (0.5, 0.75, 0.9)
EXCEEDED_THRESHOLD = 0.9
BUDGET_FINGERPRINT = "games-replay-storage-budget"
_LEVELS = {0.5: "info", 0.75: "warning", 0.9: "error"}

_settings: Settings | None = None


def _get_settings() -> Settings:
    """``REPLAY_*`` and ``DATABASE_PLAN_MB`` (settings.py), read lazily."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def retention() -> timedelta:
    return timedelta(days=_get_settings().replay_retention_days)


def budget_bytes() -> int:
    return _get_settings().replay_storage_budget_mb * 1024 * 1024


def plan_bytes() -> int:
    return _get_settings().database_plan_mb * 1024 * 1024


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

    Rows of ``KEPT_EVENT_NAMES`` types are never deleted. Each batch picks at
    most ``batch_size`` rows, locks their games (``FOR UPDATE``, in id order:
    the append path's order, game row then its events, so the two never
    deadlock), deletes the rows and lowers each game's #3298 counters
    (``event_count`` / ``event_bytes``) by what it removed, measured as they were
    charged and clamped at 0, then commits. Without that, a swept or still-open
    game would keep counting pruned rows and drop later events early. The loop
    stops when a batch comes back short or after ``max_batches``, and the next
    run carries on. Returns the rows deleted.
    """
    cutoff = retention_cutoff(now or datetime.now(UTC), keep or retention())
    prunable_type_ids = select(EventType.id).where(EventType.name.notin_(KEPT_EVENT_NAMES))
    total = 0
    for _ in range(max_batches):
        victims = [
            tuple(row)
            for row in await session.execute(
                select(GameEvent.game_id, GameEvent.event_index)
                .where(
                    GameEvent.occurred_at < cutoff, GameEvent.event_type_id.in_(prunable_type_ids)
                )
                .limit(batch_size)
            )
        ]
        if not victims:
            await session.commit()
            break
        game_ids = sorted({gid for gid, _ in victims})
        await session.execute(
            select(Game.id).where(Game.id.in_(game_ids)).order_by(Game.id).with_for_update()
        )
        # Only the rows still there come back: a cut in the meantime is not counted twice.
        removed = await deleted_sizes(
            session,
            delete(GameEvent).where(tuple_(GameEvent.game_id, GameEvent.event_index).in_(victims)),
        )
        await _lower_counters(session, removed)
        await session.commit()
        total += len(removed)
        if len(victims) < batch_size:
            break
    return total


async def _lower_counters(session: AsyncSession, removed: list[tuple[uuid.UUID, int]]) -> None:
    """Lower each game's counters by its rows in ``removed``, clamped at 0 (one executemany)."""
    per_game: dict[uuid.UUID, list[int]] = {}
    for gid, size in removed:
        n_bytes = per_game.setdefault(gid, [0, 0])
        n_bytes[0] += 1
        n_bytes[1] += size
    if not per_game:
        return
    games = Game.__table__
    await session.execute(
        update(games)
        .where(games.c.id == bindparam("gid", type_=games.c.id.type))
        .values(
            event_count=minus_clamped(games.c.event_count, bindparam("n")),
            event_bytes=minus_clamped(games.c.event_bytes, bindparam("b")),
        ),
        [{"gid": gid, "n": n, "b": b} for gid, (n, b) in sorted(per_game.items())],
    )


# ---------------------------------------------------------------------------
# Budget
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class StorageSize:
    # pg_total_relation_size('game_events'): table, indexes and TOAST. A
    # high-water mark: deleted rows leave reusable free space, which plain
    # (auto)VACUUM does not hand back, so this drops only after VACUUM FULL.
    events_bytes: int
    database_bytes: int  # pg_database_size(current_database()), the same caveat


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


@dataclass(frozen=True)
class BudgetReading:
    """The fuller of the two ratios: ``basis`` is ``"game_events"`` or ``"database"``."""

    basis: str
    ratio: float
    threshold: float | None


def read_budget(size: StorageSize, budget: int, plan: int) -> BudgetReading:
    """``game_events`` against the replay budget and the database against the plan."""
    events_ratio = size.events_bytes / budget
    database_ratio = size.database_bytes / plan
    if database_ratio > events_ratio:
        basis, ratio = "database", database_ratio
        threshold = crossed_threshold(size.database_bytes, plan)
    else:
        basis, ratio = "game_events", events_ratio
        threshold = crossed_threshold(size.events_bytes, budget)
    return BudgetReading(basis=basis, ratio=ratio, threshold=threshold)


def on_budget_exceeded(size: StorageSize, reading: BudgetReading) -> None:
    """Called when replay storage or the database reaches 90 % of its limit.

    It only reports for now (the 90 % event ``check_storage_budget`` sends).
    TODO(#3279): turn recording down server-side here — lower
    ``game_types.replay_sample_rate`` / clear ``replay_enabled`` (owner
    decision #3307) — once #3279 adds those columns.
    """
    logger.warning(
        "storage at or over %d%% (%s at %.1f%%; game_events %d bytes, database %d bytes); "
        "automatic turn-down pending #3279",
        int(EXCEEDED_THRESHOLD * 100),
        reading.basis,
        reading.ratio * 100,
        size.events_bytes,
        size.database_bytes,
    )


async def check_storage_budget(
    session: AsyncSession,
    *,
    budget: int | None = None,
    plan: int | None = None,
    measure: Callable[[AsyncSession], Awaitable[StorageSize | None]] | None = None,
) -> BudgetReading | None:
    """Measure, report the highest threshold crossed by the fuller ratio, call the 90 % hook.

    One Sentry event per run (so per day), grouped per threshold. Returns the
    reading, or ``None`` when not measurable.
    """
    budget = budget if budget is not None else budget_bytes()
    plan = plan if plan is not None else plan_bytes()
    size = await (measure or measure_storage)(session)
    if size is None:
        return None
    reading = read_budget(size, budget, plan)
    logger.info(
        "replay storage: game_events %d of %d bytes, database %d of %d bytes",
        size.events_bytes,
        budget,
        size.database_bytes,
        plan,
    )
    if reading.threshold is None:
        return reading
    pct = int(reading.threshold * 100)
    report_event(
        f"Replay storage at {pct}% of budget",
        level=_LEVELS[reading.threshold],
        fingerprint=[BUDGET_FINGERPRINT, str(pct)],
        tags={"subsystem": "games.replay_storage", "threshold": str(pct), "basis": reading.basis},
        context={
            "replay_storage": {
                "basis": reading.basis,
                "game_events_bytes": size.events_bytes,
                "budget_bytes": budget,
                "game_events_ratio": round(size.events_bytes / budget, 4),
                "database_bytes": size.database_bytes,
                "plan_bytes": plan,
                "database_ratio": round(size.database_bytes / plan, 4),
            }
        },
    )
    if reading.threshold >= EXCEEDED_THRESHOLD:
        on_budget_exceeded(size, reading)
    return reading


# ---------------------------------------------------------------------------
# The daily job
# ---------------------------------------------------------------------------


@dataclass
class DailyGate:
    """Due once per UTC day inside ``hour <= now.hour < hour + RUN_WINDOW_HOURS``,
    until a run succeeds (an in-process memory)."""

    hour: Callable[[], int] = job_hour_utc
    last_run: date | None = field(default=None)

    def due(self, now: datetime) -> bool:
        start = self.hour()
        in_window = start <= now.hour < start + RUN_WINDOW_HOURS
        return in_window and self.last_run != now.date()

    def done(self, now: datetime) -> None:
        self.last_run = now.date()


async def try_run_lock(session: AsyncSession) -> bool:
    """Take the run's advisory lock for ``session``'s transaction; True on SQLite."""
    if dialect_name(session) == "sqlite":
        return True
    got = await session.execute(
        text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": ADVISORY_LOCK_KEY}
    )
    return bool(got.scalar())


# The process's gate: a job rebuilt by a new app lifespan keeps today's run.
_process_gate = DailyGate()


async def run_daily(
    get_session_factory: Callable[[], async_sessionmaker[AsyncSession]],
    gate: DailyGate,
    *,
    now: datetime | None = None,
) -> bool:
    """Prune, then check the budget — if the gate says today's run is due and
    no other instance holds the lock. Returns whether this call did the run."""
    now = now or datetime.now(UTC)
    if not gate.due(now):
        return False
    # The factory getter is called here, inside the job's error handling, as in
    # daily_word.retention: a malformed DATABASE_URL must not abort startup.
    factory = get_session_factory()
    # ``lock_db`` holds the advisory lock in its open transaction; closing it
    # (any exit, a timeout's cancel included) rolls back and releases the lock.
    async with factory() as lock_db:
        if not await try_run_lock(lock_db):
            logger.info("replay storage: another instance is running today's run; skipped")
            gate.done(now)
            return False
        async with factory() as db:
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

    A failed run is reported and retried next tick (at most hourly, inside the
    window); only a successful or skipped run closes the day's gate. Logged at
    WARNING (an ERROR record would be a second Sentry event).
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

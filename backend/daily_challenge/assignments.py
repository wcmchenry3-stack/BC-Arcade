"""Per-install pinned daily-challenge assignments (#3992).

``schedule.py`` freezes one shared template per (date, slate). This module applies
the same idea per install: the first ``/status`` or ``/upcoming`` that needs a
(session, local date) asks a *pick* function for that install's goals
(``service.pick_for_install``), stores the result in
``daily_challenge_assignments``, and every later read returns that row unchanged.
The streak replays a past day from the install's row when one exists
(``read_assignments``, one windowed query), else from the shared frozen template.

Until #3993/#3994 replace the pick, it returns the shared frozen template and the
slate ``resolve_slate`` chooses, so what a player sees does not change.

Bounds (CLAUDE.md priority 1, docs/DATA-INVENTORY.md):

* **Write ceiling** (``may_pin``). A day is pinned only for an install with a
  ``games`` row created in the last ``DAILY_CHALLENGE_PIN_RECENT_PLAY_HOURS``
  (default 48), and never while storage is over budget: the fuller of replay
  events vs ``REPLAY_STORAGE_BUDGET_MB`` and the whole database vs
  ``DATABASE_PLAN_MB``, at the replay recorder's 90 % turn-down point
  (``replay_storage.read_budget``). An unreadable size counts as over budget for
  ``SIZE_FAILURE_TTL``. So rows are written at most 3 per install per day of recent play: a
  made-up session must keep creating game rows to keep pinning, and assignment rows
  stay a small multiple of fresh ``games`` rows. Those game rows (rate-limited, but
  kept until Delete My Data) remain the larger existing exposure; this table adds
  ~250 B per pinned day on top, pruned after retention.
* **Days ahead.** Only today..today+``MAX_DAYS_AHEAD`` (the requesting client's
  local calendar) are ever pinned; ``get_or_pin`` refuses any other day.
* **Retention.** ``daily_challenge.retention`` deletes rows older than
  ``DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS`` (default and minimum
  ``STREAK_LOOKBACK_DAYS`` + 1: one day of margin, because the prune uses the UTC
  date and a client west of UTC is a day behind).
* **Kill switch.** ``DAILY_CHALLENGE_PERSONALIZED=false``: ``get_or_pin`` returns
  ``shared(days)`` (the shared templates) and ``read_assignments`` reads nothing, so every install gets
  the shared frozen template exactly as before this table existed, and no row is
  written. Rows already stored are left for retention (or ``DELETE /me``).

The three env vars (``DAILY_CHALLENGE_PERSONALIZED``,
``DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS``, ``DAILY_CHALLENGE_PIN_RECENT_PLAY_HOURS``)
are read lazily through this module's ``_settings`` (like
``streak.lookback_days``), so a change needs a restart, not an app release.
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from daily_challenge.definitions import Goal, Slate, Template, goal_from_spec
from db.dialect import dialect_insert
from db.models import DailyChallengeAssignment, Game
from games import replay_storage
from settings import Settings

logger = logging.getLogger(__name__)

# Today plus this many days ahead may be pinned: /upcoming's offline window.
MAX_DAYS_AHEAD = 2

_settings: Settings | None = None


def _get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def personalized_on() -> bool:
    """``DAILY_CHALLENGE_PERSONALIZED`` (default true): the kill switch."""
    return _get_settings().daily_challenge_personalized


def retention_days() -> int:
    """``DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS``, defaulting to
    ``STREAK_LOOKBACK_DAYS`` + 1 (the settings refuse anything smaller)."""
    s = _get_settings()
    return s.daily_challenge_assignment_retention_days or s.streak_lookback_days + 1


@dataclass(frozen=True)
class Assignment:
    """One install's goals for one day: the core template (the streak's 3 goals),
    the slate it came from, and the optional bonus goal (#3995; ``None`` for now,
    and never counted toward the streak)."""

    template: Template
    slate: Slate = "free"
    bonus: Goal | None = None


# ---------------------------------------------------------------------------
# Compact encoding: each goal is ``[game_type, kind, target, tier]``
# ---------------------------------------------------------------------------


def _goal_to_list(goal: Goal) -> list:
    return [goal.game_type, goal.kind, goal.target, goal.tier]


def _goal_from_list(item: Sequence) -> Goal:
    game_type, kind, target, tier = item
    return goal_from_spec({"game_type": game_type, "kind": kind, "target": target, "tier": tier})


def _dumps(value: object) -> str:
    return json.dumps(value, separators=(",", ":"))


def encode_goals(goals: Iterable[Goal]) -> str:
    """The goals as compact JSON text: the same self-contained spec as
    ``goal_to_spec`` (``daily_challenge_days``), positional instead of keyed, so
    the row stays small. ``decode_goals`` rebuilds them via ``goal_from_spec``."""
    return _dumps([_goal_to_list(g) for g in goals])


def decode_goals(text: str) -> tuple[Goal, ...]:
    return tuple(_goal_from_list(item) for item in json.loads(text))


def derived_template_id(goals: Iterable[Goal]) -> str:
    """The id ``definitions.pick_template`` gives a template of these goals."""
    return "+".join(g.id for g in goals)


def _row_values(session_uuid: uuid.UUID, day: date, assignment: Assignment) -> dict:
    goals = assignment.template.goals
    template_id = assignment.template.id
    return {
        "session_id": session_uuid,
        "local_date": day,
        "goals": encode_goals(goals),
        "bonus": None if assignment.bonus is None else _dumps(_goal_to_list(assignment.bonus)),
        # NULL (no bytes) whenever the id is the one the goals imply, which is
        # every real template; stored only for one that differs.
        "template_id": None if template_id == derived_template_id(goals) else template_id,
        "slate": None if assignment.slate == "free" else assignment.slate,
    }


def _from_row(row: DailyChallengeAssignment) -> Assignment:
    goals = decode_goals(row.goals)
    return Assignment(
        template=Template(id=row.template_id or derived_template_id(goals), goals=goals),
        slate="premium" if row.slate == "premium" else "free",
        bonus=None if row.bonus is None else _goal_from_list(json.loads(row.bonus)),
    )


# ---------------------------------------------------------------------------
# Reads and the pin
# ---------------------------------------------------------------------------


def pinnable(day: date, today: date) -> bool:
    """True for the days that may be pinned: today..today+``MAX_DAYS_AHEAD``."""
    return today <= day <= today + timedelta(days=MAX_DAYS_AHEAD)


async def read_assignments(
    session: AsyncSession, session_id: str, start: date, end: date
) -> dict[date, Assignment]:
    """The install's pinned rows for ``start``..``end`` inclusive, in one query.
    Empty when the kill switch is off. The streak's windowed read."""
    if not personalized_on():
        return {}
    rows = (
        await session.execute(
            select(DailyChallengeAssignment).where(
                DailyChallengeAssignment.session_id == uuid.UUID(session_id),
                DailyChallengeAssignment.local_date >= start,
                DailyChallengeAssignment.local_date <= end,
            )
        )
    ).scalars()
    return {row.local_date: _from_row(row) for row in rows}


Pick = Callable[[date], Awaitable[Assignment]]


Shared = Callable[[list[date]], Awaitable[dict[date, Assignment]]]


def recent_play_window() -> timedelta:
    """``DAILY_CHALLENGE_PIN_RECENT_PLAY_HOURS`` (default 48)."""
    return timedelta(hours=_get_settings().daily_challenge_pin_recent_play_hours)


# A failed size reading is remembered as "over budget" for this long, so a failing or
# timing-out size query is not re-run (and logged) on every unpinned request.
SIZE_FAILURE_TTL = timedelta(minutes=10)
_size_failed_until: datetime | None = None


async def _over_budget_or_unknown(session: AsyncSession, now: datetime | None = None) -> bool:
    """``replay_storage.storage_over_budget``, failing safe.

    If the size reading raises (a DB error, a statement timeout), the answer is "do
    not pin" (over budget) for ``SIZE_FAILURE_TTL``: one WARNING per failure window,
    no size query until it ends, and nothing stored as a size reading. A SAVEPOINT
    keeps a failed size query from aborting the request's transaction, so /status
    still answers."""
    global _size_failed_until
    now = now or datetime.now(UTC)
    if _size_failed_until is not None and now < _size_failed_until:
        return True
    try:
        async with session.begin_nested():
            return await replay_storage.storage_over_budget(session)
    except Exception:
        _size_failed_until = now + SIZE_FAILURE_TTL
        logger.warning(
            "daily_challenge: storage size unreadable; not pinning for %d min",
            SIZE_FAILURE_TTL.total_seconds() // 60,
            exc_info=True,
        )
        return True


async def may_pin(session: AsyncSession, session_id: str, now: datetime | None = None) -> bool:
    """The write ceiling: may this install pin new days right now?

    * **Storage budget.** Not while storage is over budget: the fuller of replay
      events vs ``REPLAY_STORAGE_BUDGET_MB`` and the whole database vs
      ``DATABASE_PLAN_MB``, at the replay recorder's 90 % turn-down point
      (``replay_storage.storage_over_budget``: the cached size reading, at most one
      size query an hour per process; an unreadable size counts as over budget).
    * **Recent play.** Only if the session has a ``games`` row created (server time,
      not client-reported) within ``DAILY_CHALLENGE_PIN_RECENT_PLAY_HOURS``. One
      EXISTS on the ``games_session_created_idx`` (session_id, created_at) index.

    Run only when some requested day is not pinned yet, so a pinned day's read
    stays one SELECT.
    """
    if await _over_budget_or_unknown(session, now):
        return False
    since = (now or datetime.now(UTC)) - recent_play_window()
    return bool(
        (
            await session.execute(
                select(exists().where(Game.session_id == session_id, Game.created_at >= since))
            )
        ).scalar()
    )


async def get_or_pin(
    session: AsyncSession,
    session_id: str,
    days: Iterable[date],
    *,
    today: date,
    pick: Pick,
    shared: Shared | None = None,
) -> dict[date, Assignment]:
    """The install's assignment for each of ``days``, pinning the missing ones.

    One SELECT for the stored rows; ``pick`` runs only for days with no row, and
    one INSERT ... ON CONFLICT DO NOTHING stores them. A day a concurrent request
    pinned first is skipped by the insert and read back (one more SELECT), so two
    first requests can never leave two different assignments: the stored row wins.

    Before picking, ``may_pin`` (skipped when every day is already pinned): an
    install that may not pin (no recent game, or the database over budget) gets
    ``shared`` for the missing days, the shared templates with as few queries as
    the caller can manage, and nothing is written. ``pick`` never runs for it.

    Every day must be pinnable relative to ``today`` (the caller's local date);
    anything else raises ``ValueError``, so no route can pin past today+2.
    With the kill switch off, returns ``shared`` for every day and writes nothing.
    ``shared`` defaults to ``pick`` day by day (correct while the pick is the
    shared template, as in #3992).
    """
    days = list(dict.fromkeys(days))
    if shared is None:

        async def shared(ds: list[date]) -> dict[date, Assignment]:
            return {d: await pick(d) for d in ds}

    if not personalized_on():
        return await shared(days)
    outside = [d for d in days if not pinnable(d, today)]
    if outside:
        raise ValueError(f"cannot pin daily challenge days {outside}: outside today..today+2")

    sid = uuid.UUID(session_id)
    rows = (
        await session.execute(
            select(DailyChallengeAssignment).where(
                DailyChallengeAssignment.session_id == sid,
                DailyChallengeAssignment.local_date.in_(days),
            )
        )
    ).scalars()
    result = {row.local_date: _from_row(row) for row in rows}
    missing = [d for d in days if d not in result]
    if not missing:
        return result

    if not await may_pin(session, session_id):
        # The write ceiling (see may_pin): an install with no game in the last
        # DAILY_CHALLENGE_PIN_RECENT_PLAY_HOURS (a new install, a lapsed one, or an id
        # made up to fill the table), or any install while storage is over budget,
        # is served the shared templates and nothing is stored.
        result.update(await shared(missing))
        return result
    fresh = {d: await pick(d) for d in missing}
    # Same pattern as schedule.get_or_create_templates (#3013): no IntegrityError,
    # no rollback, no retry. Rows go in date order so two overlapping batches take
    # their row locks in the same order on Postgres.
    stmt = (
        dialect_insert(session, DailyChallengeAssignment)
        .values([_row_values(sid, d, fresh[d]) for d in sorted(fresh)])
        .on_conflict_do_nothing(
            index_elements=[
                DailyChallengeAssignment.session_id,
                DailyChallengeAssignment.local_date,
            ]
        )
        .returning(DailyChallengeAssignment.local_date)
    )
    inserted = set((await session.execute(stmt)).scalars())
    lost = [d for d in missing if d not in inserted]
    if lost:
        rows = (
            await session.execute(
                select(DailyChallengeAssignment).where(
                    DailyChallengeAssignment.session_id == sid,
                    DailyChallengeAssignment.local_date.in_(lost),
                )
            )
        ).scalars()
        result.update((row.local_date, _from_row(row)) for row in rows)
        unpersisted = [d for d in lost if d not in result]
        if unpersisted:
            # Never serve an assignment that is not stored: the next read would pick
            # again and could differ. Unreachable under READ COMMITTED (see
            # schedule.get_or_create_templates); kept as a guard.
            raise RuntimeError(
                f"daily challenge assignments {unpersisted} neither pinned nor found"
            )
    await session.commit()
    result.update((d, fresh[d]) for d in inserted)
    return result

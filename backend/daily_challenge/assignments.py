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

* **Days ahead.** Only today..today+``MAX_DAYS_AHEAD`` (the requesting client's
  local calendar) are ever pinned; ``get_or_pin`` refuses any other day.
* **Retention.** ``daily_challenge.retention`` deletes rows older than
  ``DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS`` (default ``STREAK_LOOKBACK_DAYS``).
* **Kill switch.** ``DAILY_CHALLENGE_PERSONALIZED=false``: ``get_or_pin`` returns
  the pick unstored and ``read_assignments`` reads nothing, so every install gets
  the shared frozen template exactly as before this table existed, and no row is
  written. Rows already stored are left for retention (or ``DELETE /me``).

Both env vars are read lazily through this module's ``_settings`` (like
``streak.lookback_days``), so a change needs a restart, not an app release.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from daily_challenge.definitions import Goal, Slate, Template, goal_from_spec
from db.dialect import dialect_insert
from db.models import DailyChallengeAssignment
from settings import Settings

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
    """``DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS``, defaulting to ``STREAK_LOOKBACK_DAYS``."""
    s = _get_settings()
    return s.daily_challenge_assignment_retention_days or s.streak_lookback_days


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


async def get_or_pin(
    session: AsyncSession,
    session_id: str,
    days: Iterable[date],
    *,
    today: date,
    pick: Pick,
) -> dict[date, Assignment]:
    """The install's assignment for each of ``days``, pinning the missing ones.

    One SELECT for the stored rows; ``pick`` runs only for days with no row, and
    one INSERT ... ON CONFLICT DO NOTHING stores them. A day a concurrent request
    pinned first is skipped by the insert and read back (one more SELECT), so two
    first requests can never leave two different assignments: the stored row wins.

    Every day must be pinnable relative to ``today`` (the caller's local date);
    anything else raises ``ValueError``, so no route can pin past today+2.
    With the kill switch off, returns ``pick``'s result for each day and writes
    nothing.
    """
    days = list(dict.fromkeys(days))
    if not personalized_on():
        return {d: await pick(d) for d in days}
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

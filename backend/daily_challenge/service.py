"""Daily challenge completion — a read-side view over ``games`` (#2392).

A goal is met by a game the session finished inside the player's local day; the
rows are the ones ``PATCH /games/{id}/complete`` already wrote, so offline
plays count as soon as the client's queue uploads them (``completed_at`` is
the client's timestamp, validated on write). Each goal is evaluated against
one row's measures (``game_facts``: the result block in ``games.metadata``
plus the score/duration columns).

Abandoned games never satisfy a goal (#2468 / #2472): the challenge and the
streak it feeds are accomplishments, and an abandon carries a real score on
most paths — a 9,000-point Twenty48 run ended with "New Game" used to clear a
"score 2,500+" goal. ``won``-style goals were already safe because the abandon
result block reports ``won: false``; threshold goals were not, so the rows are
filtered here instead of relying on each goal kind to notice.

The writes here are pins, never progress. ``schedule.get_or_create_template``
(#2493) freezes a day's shared template into ``daily_challenge_days`` the first
time it is requested, so tuning the goal pool or ``DAILY_CHALLENGE_SALT`` later can
never change what a day already showed. ``assignments.get_or_pin`` (#3992) then
pins the install's own goals for the day into ``daily_challenge_assignments``
(``pick_for_install`` chooses them), so every later read returns the same goals.
The pick (#3993/#3994) reads the install's history once per request
(``history.load_install_history``, at most four queries) and chooses personal goals
with ``personal.choose_core``; an install with too little history, or a day it could
already have been shown unpinned, gets the shared template exactly
(``personal.serves_shared``).
"""

from __future__ import annotations

import logging
from collections.abc import Collection
from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from daily_challenge import assignments, history, personal, schedule
from daily_challenge.assignments import Assignment, derived_template_id
from daily_challenge.definitions import (
    FREE_GOAL_POOL,
    Facts,
    Goal,
    LocalDay,
    Slate,
    Template,
    game_facts,
    local_day,
    template_for,
)
from daily_challenge.history import InstallHistory
from db.models import Game, GameEntitlement, GameType
from entitlements.service import DISABLED_GAMES, is_dev_override_active
from games.filters import not_abandoned

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GoalStatus:
    goal: Goal
    completed: bool
    best_score: int | None


@dataclass(frozen=True)
class ChallengeStatus:
    day: LocalDay
    slate: Slate
    template: Template
    goals: tuple[GoalStatus, ...]
    # The optional bonus goal (#3995): never counted in ``completed_goals`` or the
    # streak. Always None until #3995 fills it.
    bonus: Goal | None = None

    @property
    def completed_goals(self) -> int:
        return sum(1 for g in self.goals if g.completed)

    @property
    def completed(self) -> bool:
        return all(g.completed for g in self.goals)


# (game_type, facts) of a game that ended today — facts from ``game_facts``.
EndedGame = tuple[str, Facts]


def evaluate_goal(goal: Goal, ended: list[EndedGame]) -> GoalStatus:
    mine = [facts for game_type, facts in ended if game_type == goal.game_type]
    completed = any(goal.evaluate(facts) for facts in mine)
    best_score: int | None = None
    if goal.measure == "final_score":
        scores = [f["final_score"] for f in mine if isinstance(f.get("final_score"), int)]
        best_score = max(scores) if scores else None
    return GoalStatus(goal=goal, completed=completed, best_score=best_score)


def slate_for_games(
    premium_named: Collection[str], owned: Collection[str], override: bool
) -> Slate:
    """The slate rule, with no I/O — the one place it is written (#2454).

    ``premium_named``: the premium games that day's premium template names.
    ``owned``: the premium games the session owns. A session gets the premium
    slate only if it owns every premium game named; a template naming none has
    nothing to unlock, so it is the free slate. ``override`` (the dev entitlement
    override) counts every named game as owned. ``resolve_slate`` (one day, one
    query) and the streak (many days, entitlements fetched once) both call this.
    """
    named = set(premium_named)
    if not named:
        return "free"
    return "premium" if override or named <= set(owned) else "free"


def evaluate_template(template: Template, ended: list[EndedGame]) -> tuple[GoalStatus, ...]:
    """Every goal of ``template`` evaluated against one day's finished games.

    The one place a day is scored: ``get_status_for_session`` (today, live) and the
    streak (past days, replayed) both call it, so they cannot disagree.
    """
    return tuple(evaluate_goal(goal, ended) for goal in template.goals)


async def resolve_slate(session: AsyncSession, session_id: str, day: date) -> Slate:
    """Which slate this session's challenge for ``day`` is drawn from (#2454).

    Live from the database, never from a constant: ``game_types.is_premium``
    says which games are premium, ``game_entitlements`` says which this session
    owns. The session gets the **premium** slate only if it owns *every* premium
    game that day's premium template names — a partly-entitled session would
    otherwise be handed a goal in a game it cannot open — else the free slate.
    A premium template naming no premium game has nothing to unlock, so it is
    the free slate too. ``ENTITLEMENT_DEV_OVERRIDE`` counts every named premium
    game as owned, so the dev API follows the same rule as production rather than
    a special case of its own.

    When the two templates are identical (always, until #2458 gives the premium
    pool games of its own) the slate is moot and no query runs — ``/status`` is
    refreshed on every Home focus. Otherwise one statement: the template's games
    joined to this session's entitlements.

    The slate is pinned with the day (#3992): ``pick_for_install`` calls this once,
    when the install's day is first served (for a personal pick too), and the pinned
    row keeps that slate, so a mid-day entitlement change applies from the next day not yet pinned. It
    is resolved per request only for unpinned days (an install that may not pin,
    or ``DAILY_CHALLENGE_PERSONALIZED`` off, via ``shared_for_install``). The choice
    is made from the *computed* templates (``template_for(day, "premium")`` and
    ``template_for(day, "free")``, from the current pool and salt), while the
    template the caller then serves is the *frozen* one for that (day, slate)
    (``schedule.get_or_create_template``, #2493). The two can differ once the
    pool or salt changes after a day was frozen; see #2760.
    """
    premium_template = template_for(day, "premium")
    if premium_template == template_for(day, "free"):
        return "free"
    named = {goal.game_type for goal in premium_template.goals}
    rows = (
        await session.execute(
            select(GameType.name, GameEntitlement.game_slug)
            .select_from(GameType)
            .outerjoin(
                GameEntitlement,
                and_(
                    GameEntitlement.game_slug == GameType.name,
                    GameEntitlement.session_id == session_id,
                ),
            )
            .where(GameType.name.in_(named), GameType.is_premium.is_(True))
        )
    ).all()
    return slate_for_games(
        premium_named={name for name, _ in rows},
        owned={name for name, slug in rows if slug is not None},
        override=is_dev_override_active(),
    )


@dataclass
class PickContext:
    """One request's picks: the days it may pick (so the history is loaded once,
    for all of them) and the client's UTC offset. ``pick_for_install`` records each
    day it picks in ``history.pinned``, so the next day's variety guard sees it
    before it is stored. ``assignments.get_or_pin`` picks missing days in date order."""

    days: list[date]
    tz_offset_minutes: int = 0
    history: InstallHistory | None = None
    eligible: list[str] | None = field(default=None)


async def eligible_games(session: AsyncSession, session_id: str) -> list[str]:
    """The games an install's core goals may come from (#3994): every free game with
    goal specs, plus the premium games with specs it is entitled to (the dev override
    counts as entitled, as in ``resolve_slate``). Never a game in ``DISABLED_GAMES``.

    No premium game has specs yet (#3996), so today this is the free games and runs
    no query. A premium game must not get specs while store builds hide it."""
    spec_games = [g for g in sorted(personal.GAME_SPECS) if g not in DISABLED_GAMES]
    free = [g for g in spec_games if g in FREE_GOAL_POOL]
    premium = [g for g in spec_games if g not in FREE_GOAL_POOL]
    if not premium:
        return free
    if is_dev_override_active():
        return free + premium
    rows = (
        await session.execute(
            select(GameEntitlement.game_slug).where(
                GameEntitlement.session_id == session_id,
                GameEntitlement.game_slug.in_(premium),
            )
        )
    ).scalars()
    owned = set(rows)
    return free + [g for g in premium if g in owned]


async def pick_for_install(
    session: AsyncSession,
    session_id: str,
    day: date,
    *,
    tz_offset_minutes: int = 0,
    context: PickContext | None = None,
) -> Assignment:
    """Choose one install's goals for ``day``; ``assignments.get_or_pin`` stores
    the result, so this runs at most once per (install, day) while the kill switch
    is on, and never while it is off.

    * **Shared** (``personal.serves_shared``): a new install (fewer than 3 finished
      games of games with specs, or none in the affinity window), or a day the
      install could already have been served unpinned (no game created in some
      ``DAILY_CHALLENGE_PIN_RECENT_PLAY_HOURS`` window since the day could first be
      asked for, ``InstallHistory.always_pinnable``). The shared frozen template for
      the slate ``resolve_slate`` chooses (``shared_for_install``), exactly, so goals a
      device already shows for the day never change when it is pinned.
    * **Otherwise**: Daily Word plus two personal goals (``personal.choose_core``),
      on the slate ``resolve_slate`` chooses, stored with the day. No bonus (#3995).

    Queries: the history (at most four, once per ``context``), then none for a personal
    pick while no premium game has specs and the two slates match; the shared path
    adds the frozen template read (and an INSERT for a day never frozen).

    Behaviour change from pinning: the slate is resolved once, when the day is
    pinned, so a mid-day purchase no longer swaps that day's goals (it applies from
    the next unpinned day). Invisible while the free and premium pools match.
    """
    ctx = context or PickContext([day], tz_offset_minutes)
    if day not in ctx.days:
        ctx.days = sorted({*ctx.days, day})
        ctx.history = None
    if ctx.history is None:
        ctx.history = await history.load_install_history(
            session, session_id, min(ctx.days), ctx.tz_offset_minutes, through=max(ctx.days)
        )
    install = ctx.history
    result: Assignment | None = None
    if not personal.serves_shared(install, day):
        if ctx.eligible is None:
            ctx.eligible = await eligible_games(session, session_id)
        slate = await resolve_slate(session, session_id, day)
        try:
            goals = personal.choose_core(
                install,
                day,
                ctx.eligible,
                session_id=session_id,
            )
        except ValueError:
            # Fewer than two goals to offer (every eligible game disabled, say): the
            # shared template, never a failed /status.
            logger.warning("daily_challenge: no personal goals for %s; shared template", day)
        else:
            result = Assignment(Template(derived_template_id(goals), goals), slate=slate)
    if result is None:
        result = await shared_for_install(session, session_id, day)
    install.pinned[day] = result
    return result


async def shared_for_install(session: AsyncSession, session_id: str, day: date) -> Assignment:
    """The shared frozen template for the slate ``resolve_slate`` chooses: what an
    install that may not pin (``assignments.may_pin``) or any install while the
    kill switch is off is served. Never written to ``daily_challenge_assignments``."""
    slate = await resolve_slate(session, session_id, day)
    template = await schedule.get_or_create_template(
        session, day, slate, lambda: template_for(day, slate)
    )
    return Assignment(template=template, slate=slate, bonus=None)


async def _shared_days(
    session: AsyncSession, session_id: str, days: list[date]
) -> dict[date, Assignment]:
    return {d: await shared_for_install(session, session_id, d) for d in days}


async def get_status_for_session(
    session: AsyncSession,
    *,
    session_id: str,
    tz_offset_minutes: int,
    utc_now: datetime | None = None,
) -> ChallengeStatus:
    day = local_day(tz_offset_minutes, utc_now)
    ctx = PickContext([day.date], tz_offset_minutes)
    pinned = await assignments.get_or_pin(
        session,
        session_id,
        [day.date],
        today=day.date,
        pick=lambda d: pick_for_install(
            session, session_id, d, tz_offset_minutes=tz_offset_minutes, context=ctx
        ),
        shared=lambda ds: _shared_days(session, session_id, ds),
    )
    assignment = pinned[day.date]
    template = assignment.template
    game_types = {goal.game_type for goal in template.goals}

    rows = (
        await session.execute(
            select(GameType.name, Game.game_metadata, Game.final_score, Game.duration_ms)
            .select_from(Game)
            .join(GameType, Game.game_type_id == GameType.id)
            .where(
                Game.session_id == session_id,
                GameType.name.in_(game_types),
                Game.completed_at >= day.start_utc,
                Game.completed_at < day.end_utc,
                not_abandoned(),
            )
        )
    ).all()

    ended: list[EndedGame] = [
        (name, game_facts(metadata, final_score, duration_ms))
        for name, metadata, final_score, duration_ms in rows
    ]
    return ChallengeStatus(
        day=day,
        slate=assignment.slate,
        template=template,
        goals=evaluate_template(template, ended),
        bonus=assignment.bonus,
    )

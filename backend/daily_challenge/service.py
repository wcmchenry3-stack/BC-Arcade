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

The only write here is indirect: ``schedule.get_or_create_template`` (#2493)
freezes today's assignment into ``daily_challenge_days`` the first time it is
requested, so tuning the goal pool or ``DAILY_CHALLENGE_SALT`` later can never
change what a day already showed.
"""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from daily_challenge import schedule
from daily_challenge.definitions import (
    Facts,
    Goal,
    LocalDay,
    Slate,
    Template,
    game_facts,
    local_day,
    template_for,
)
from db.models import Game, GameEntitlement, GameType
from entitlements.service import is_dev_override_active
from games.filters import not_abandoned


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

    Only the slate choice is live. Each (day, slate) template is frozen the first
    time it is requested (``schedule.get_or_create_template``, #2493), so a
    mid-day entitlement change swaps the session to the other slate's frozen
    template on the next call; the slate choice itself is not stored.
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


async def get_status_for_session(
    session: AsyncSession,
    *,
    session_id: str,
    tz_offset_minutes: int,
    utc_now: datetime | None = None,
) -> ChallengeStatus:
    day = local_day(tz_offset_minutes, utc_now)
    slate = await resolve_slate(session, session_id, day.date)
    template = await schedule.get_or_create_template(
        session, day.date, slate, lambda: template_for(day.date, slate)
    )
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
        slate=slate,
        template=template,
        goals=evaluate_template(template, ended),
    )

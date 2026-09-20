"""Daily challenge completion — a read-side view over ``games`` (#2392).

Nothing is written. A goal is met by a game the session finished inside the
player's local day; the rows are the ones ``PATCH /games/{id}/complete``
already wrote, so offline plays count as soon as the client's queue uploads
them (``completed_at`` is the client's timestamp, validated on write). Each
goal is evaluated against one row's measures (``game_facts``: the result block
in ``games.metadata`` plus the score/duration columns) — never ``outcome``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from daily_challenge.definitions import (
    Facts,
    Goal,
    LocalDay,
    Template,
    game_facts,
    local_day,
    template_for,
)
from db.models import Game, GameType


@dataclass(frozen=True)
class GoalStatus:
    goal: Goal
    completed: bool
    best_score: int | None


@dataclass(frozen=True)
class ChallengeStatus:
    day: LocalDay
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
    if goal.kind == "final_score_at_least":
        scores = [f["final_score"] for f in mine if isinstance(f.get("final_score"), int)]
        best_score = max(scores) if scores else None
    return GoalStatus(goal=goal, completed=completed, best_score=best_score)


async def get_status_for_session(
    session: AsyncSession,
    *,
    session_id: str,
    tz_offset_minutes: int,
    utc_now: datetime | None = None,
) -> ChallengeStatus:
    day = local_day(tz_offset_minutes, utc_now)
    template = template_for(day.date)
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
            )
        )
    ).all()

    ended: list[EndedGame] = [
        (name, game_facts(metadata, final_score, duration_ms))
        for name, metadata, final_score, duration_ms in rows
    ]
    return ChallengeStatus(
        day=day,
        template=template,
        goals=tuple(evaluate_goal(goal, ended) for goal in template.goals),
    )

"""Daily challenge completion — a read-side view over ``games`` (#2392).

Nothing is written. A goal is met by a game the session finished inside the
player's local day; the rows are the ones ``PATCH /games/{id}/complete``
already wrote, so offline plays count as soon as the client's queue uploads
them (``completed_at`` is the client's timestamp, validated on write).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from daily_challenge.definitions import Goal, LocalDay, Template, local_day, template_for
from db.models import Game, GameType
from vocab import GameOutcome


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


# (game_type, final_score, outcome) of a game that ended today.
EndedGame = tuple[str, int | None, str | None]


def evaluate_goal(goal: Goal, ended: list[EndedGame]) -> GoalStatus:
    mine = [(score, outcome) for game_type, score, outcome in ended if game_type == goal.game_type]
    if goal.kind == "complete":
        # Leaving a game writes an "abandoned" completion — that is not finishing it.
        finished = any(outcome != GameOutcome.ABANDONED.value for _, outcome in mine)
        return GoalStatus(goal=goal, completed=finished, best_score=None)

    # A score that was reached counts however the game ended (see definitions.py).
    real_scores = [score for score, _ in mine if score is not None]
    best = max(real_scores) if real_scores else None
    target = goal.target if goal.target is not None else 0
    return GoalStatus(goal=goal, completed=best is not None and best >= target, best_score=best)


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
            select(GameType.name, Game.final_score, Game.outcome)
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

    ended: list[EndedGame] = [(name, final_score, outcome) for name, final_score, outcome in rows]
    return ChallengeStatus(
        day=day,
        template=template,
        goals=tuple(evaluate_goal(goal, ended) for goal in template.goals),
    )

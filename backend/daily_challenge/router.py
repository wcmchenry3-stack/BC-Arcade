"""Daily cross-game challenge REST endpoints (#2392).

Rate limits:
  GET /today   — 60/minute (IP-keyed, no auth): today's goals, no player state.
                 Always the FREE slate — there is no session to resolve.
  GET /status  — 60/minute keyed by X-Session-ID: the goals from the slate this
                 session resolves to (free or premium, #2454) plus which it has
                 met today. For an entitled session these differ from /today.
"""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from daily_challenge import service
from daily_challenge.definitions import Goal, local_day, template_for
from daily_challenge.schemas import (
    ChallengeResponse,
    ChallengeStatusResponse,
    GoalResponse,
    GoalStatusResponse,
)
from db.base import get_session_factory
from limiter import limiter, session_key
from session import get_session_id

router = APIRouter()


def _goal_fields(goal: Goal) -> dict:
    return {"id": goal.id, "game_type": goal.game_type, "kind": goal.kind, "target": goal.target}


@router.get("/today", response_model=ChallengeResponse)
@limiter.limit("60/minute")
async def get_today(
    request: Request,
    tz_offset_minutes: int = Query(0, ge=-840, le=840),
) -> ChallengeResponse:
    day = local_day(tz_offset_minutes)
    # Always the free slate: no session here, so nothing to resolve. Only /status
    # (below) may return the premium slate.
    template = template_for(day.date, "free")
    return ChallengeResponse(
        challenge_id=day.date.isoformat(),
        template_id=template.id,
        goals=[GoalResponse(**_goal_fields(g)) for g in template.goals],
        resets_at=day.end_utc,
    )


@router.get("/status", response_model=ChallengeStatusResponse)
@limiter.limit("60/minute", key_func=session_key)
async def get_status(
    request: Request,
    tz_offset_minutes: int = Query(0, ge=-840, le=840),
) -> ChallengeStatusResponse:
    sid = get_session_id(request)
    factory = get_session_factory()
    async with factory() as db:
        status = await service.get_status_for_session(
            db, session_id=sid, tz_offset_minutes=tz_offset_minutes
        )
    return ChallengeStatusResponse(
        challenge_id=status.day.date.isoformat(),
        template_id=status.template.id,
        goals=[
            GoalStatusResponse(
                **_goal_fields(g.goal), completed=g.completed, best_score=g.best_score
            )
            for g in status.goals
        ],
        resets_at=status.day.end_utc,
        completed_goals=status.completed_goals,
        total_goals=len(status.goals),
        completed=status.completed,
    )

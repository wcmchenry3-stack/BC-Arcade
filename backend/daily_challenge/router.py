"""Daily cross-game challenge REST endpoints (#2392).

Rate limits:
  GET /today   — 60/minute (IP-keyed, no auth): today's goals, no player state.
                 Always the FREE slate — there is no session to resolve.
  GET /upcoming — 60/minute (IP-keyed): today + the next 2 local days. With a
                 valid X-Session-ID, each day is that install's pinned assignment
                 (#3992), as /status serves it. Without one (or with the kill
                 switch DAILY_CHALLENGE_PERSONALIZED off), the shared FREE slate
                 frozen on first read, like /today.
  GET /status  — 60/minute keyed by X-Session-ID: this install's pinned goals for
                 today (#3992; the slate it resolves to, free or premium, #2454)
                 plus which it has met. For an entitled session these can differ
                 from /today.

Every day payload carries ``bonus``: the optional bonus goal, reserved for #3995
and always null until then. Older app builds ignore it.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Query, Request

from daily_challenge import assignments, schedule, service
from daily_challenge.definitions import (
    Goal,
    LocalDay,
    Template,
    local_day,
    local_day_of,
    template_for,
)
from daily_challenge.schemas import (
    ChallengeResponse,
    ChallengeStatusResponse,
    GoalResponse,
    GoalStatusResponse,
    UpcomingChallengeResponse,
)
from db.base import DbSession
from limiter import limiter, session_key
from rate_limits import (
    DAILY_CHALLENGE_STATUS_IP_RATE_LIMIT,
    DAILY_CHALLENGE_STATUS_SESSION_RATE_LIMIT,
    DAILY_CHALLENGE_TODAY_IP_RATE_LIMIT,
    DAILY_CHALLENGE_UPCOMING_IP_RATE_LIMIT,
)
from session import get_session_id, parse_session_id

router = APIRouter()


def _goal_fields(goal: Goal) -> dict:
    return {"id": goal.id, "game_type": goal.game_type, "kind": goal.kind, "target": goal.target}


def _day_response(day: LocalDay, template: Template, bonus: Goal | None) -> ChallengeResponse:
    return ChallengeResponse(
        challenge_id=day.date.isoformat(),
        template_id=template.id,
        goals=[GoalResponse(**_goal_fields(g)) for g in template.goals],
        resets_at=day.end_utc,
        bonus=None if bonus is None else GoalResponse(**_goal_fields(bonus)),
    )


@router.get("/today", response_model=ChallengeResponse)
@limiter.limit(DAILY_CHALLENGE_TODAY_IP_RATE_LIMIT)
async def get_today(
    request: Request,  # noqa: ARG001 - slowapi resolves `request` by name
    db: DbSession,
    tz_offset_minutes: int = Query(0, ge=-840, le=840),
) -> ChallengeResponse:
    day = local_day(tz_offset_minutes)
    # Always the free slate: no session here, so nothing to resolve. Only /status
    # (below) may return the premium slate.
    template = await schedule.get_or_create_template(
        db, day.date, "free", lambda: template_for(day.date, "free")
    )
    return _day_response(day, template, None)


@router.get("/upcoming", response_model=UpcomingChallengeResponse)
@limiter.limit(DAILY_CHALLENGE_UPCOMING_IP_RATE_LIMIT)
async def get_upcoming(
    request: Request,
    db: DbSession,
    tz_offset_minutes: int = Query(0, ge=-840, le=840),
) -> UpcomingChallengeResponse:
    # Today + the next 2 local days (#3227).
    today = local_day(tz_offset_minutes)
    days = [local_day_of(today.date + timedelta(days=i), tz_offset_minutes) for i in range(3)]
    sid = parse_session_id(request.headers.get("X-Session-ID"))
    if sid is not None and assignments.personalized_on():
        # Per install (#3992): each day is pinned for this install on first read,
        # so /status serves today's exactly as cached here for offline play.
        pinned = await assignments.get_or_pin(
            db,
            sid,
            [d.date for d in days],
            today=today.date,
            pick=lambda d: service.pick_for_install(db, sid, d),
        )
        return UpcomingChallengeResponse(
            days=[_day_response(d, pinned[d.date].template, pinned[d.date].bonus) for d in days]
        )
    # No session (or the kill switch is off): the shared free slate, like /today.
    # Reading a day freezes it, so every device (and a later /today) sees the same
    # goals.
    templates = await schedule.get_or_create_templates(
        db, [d.date for d in days], "free", lambda d: template_for(d, "free")
    )
    return UpcomingChallengeResponse(days=[_day_response(d, templates[d.date], None) for d in days])


@router.get("/status", response_model=ChallengeStatusResponse)
@limiter.limit(DAILY_CHALLENGE_STATUS_SESSION_RATE_LIMIT, key_func=session_key)
@limiter.limit(DAILY_CHALLENGE_STATUS_IP_RATE_LIMIT)
async def get_status(
    request: Request,
    db: DbSession,
    tz_offset_minutes: int = Query(0, ge=-840, le=840),
) -> ChallengeStatusResponse:
    sid = get_session_id(request)
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
        bonus=None if status.bonus is None else GoalResponse(**_goal_fields(status.bonus)),
    )

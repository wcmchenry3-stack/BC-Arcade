"""FastAPI router for /stats/* (#365).

Thin wrapper — actual aggregation lives in games.service.get_stats_for_session.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Query, Request

from daily_challenge.streak import compute_streak
from db.base import get_session_factory
from games import service as games_service
from games.progression import compute_progression
from games.schemas import GameTypeStatsResponse, StatsResponse
from limiter import limiter, session_key
from session import get_session_id

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/me", response_model=StatsResponse)
@limiter.limit("60/minute", key_func=session_key)
async def get_my_stats(
    request: Request,
    # Minutes EAST of UTC — the same convention as /daily-challenge/*. The streak counts
    # the player's local days, so it needs it; old clients omit it and get UTC days.
    tz_offset_minutes: int = Query(0, ge=-840, le=840),
) -> StatsResponse:
    sid = get_session_id(request)
    factory = get_session_factory()
    async with factory() as db:
        # Close this player's games left open > 24 h before counting them (#2621).
        await games_service.sweep_stale_games_safely(db, session_id=sid)
        summary = await games_service.get_stats_for_session(db, session_id=sid)
        try:
            streak_days = await compute_streak(db, sid, tz_offset_minutes)
        except Exception:
            # The streak is a secondary count on the path that also carries XP and level,
            # which Home and Profile read: a failure here (a transient DB error, a bad
            # pool or salt) must not take the whole response down. Logged at ERROR so
            # Sentry still sees it.
            logger.exception("streak computation failed for /stats/me")
            streak_days = 0
    progression = compute_progression(summary)
    return StatsResponse(
        total_games=summary.total_games,
        by_game={
            name: GameTypeStatsResponse(
                played=s.played,
                best=s.best,
                avg=s.avg,
                last_played_at=s.last_played_at,
                best_chips=s.best_chips,
                current_chips=s.current_chips,
                best_run_chips=s.best_run_chips,
                total_runs=s.total_runs,
                runs_completed=s.runs_completed,
                current_table=s.current_table,
            )
            for name, s in summary.by_game.items()
        },
        favorite_game=summary.favorite_game,
        arcade_xp=progression.arcade_xp,
        arcade_level=progression.arcade_level,
        xp_into_level=progression.xp_into_level,
        xp_for_next_level=progression.xp_for_next_level,
        streak_days=streak_days,
    )

"""FastAPI router for /stats/* (#365).

Thin wrapper — actual aggregation lives in games.service.get_stats_for_session.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from db.base import get_session_factory
from games import service as games_service
from games.schemas import GameTypeStatsResponse, StatsResponse
from limiter import limiter, session_key
from session import get_session_id

router = APIRouter()


@router.get("/me", response_model=StatsResponse)
@limiter.limit("60/minute", key_func=session_key)
async def get_my_stats(request: Request) -> StatsResponse:
    sid = get_session_id(request)
    factory = get_session_factory()
    async with factory() as db:
        summary = await games_service.get_stats_for_session(db, session_id=sid)
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
    )

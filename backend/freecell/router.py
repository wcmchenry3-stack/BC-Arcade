"""FreeCell leaderboard (#899) — DB-backed persistence.

POST /freecell/score  — accepts { player_id, move_count }, stores in Postgres,
                        returns the submitter's rank (11 if outside top-10).
GET  /freecell/leaderboard — returns top-10 scores sorted ascending by
                             move_count (fewer moves = better).

Sort order: ascending move_count; ties broken by completed_at (older wins).
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import asc, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import get_session_factory
from db.models import Game, GameType
from limiter import limiter, session_key
from vocab import GameType as GameTypeEnum

from .models import LeaderboardResponse, ScoreEntry, ScoreSubmitRequest

router = APIRouter()

LEADERBOARD_LIMIT = 10
_FREECELL_SESSION = "freecell-anon"


async def _freecell_game_type_id(db: AsyncSession) -> int:
    row = (
        await db.execute(select(GameType.id).where(GameType.name == GameTypeEnum.FREECELL))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=500,
            detail="freecell game_type missing — run alembic migrations.",
        )
    return row


async def _top10(db: AsyncSession) -> list[ScoreEntry]:
    gt_id = await _freecell_game_type_id(db)
    rows = (
        (
            await db.execute(
                select(Game)
                .where(
                    Game.game_type_id == gt_id,
                    Game.final_score.is_not(None),
                )
                .order_by(asc(Game.final_score), asc(Game.completed_at))
                .limit(LEADERBOARD_LIMIT)
            )
        )
        .scalars()
        .all()
    )
    return [
        ScoreEntry(
            player_id=str((g.game_metadata or {}).get("player_name") or "anon"),
            move_count=int(g.final_score or 0),
            rank=i + 1,
        )
        for i, g in enumerate(rows)
    ]


@router.post("/score", response_model=ScoreEntry, status_code=201)
@limiter.limit("5/minute", key_func=session_key)
async def submit_score(request: Request, body: ScoreSubmitRequest) -> ScoreEntry:
    factory = get_session_factory()
    async with factory() as db:
        gt_id = await _freecell_game_type_id(db)
        game = Game(
            session_id=_FREECELL_SESSION,
            game_type_id=gt_id,
            final_score=body.move_count,
            outcome="completed",
            completed_at=datetime.now(timezone.utc),
            game_metadata={"player_name": body.player_id},
        )
        db.add(game)
        await db.commit()
        await db.refresh(game)

        all_rows = (
            (
                await db.execute(
                    select(Game)
                    .where(
                        Game.game_type_id == gt_id,
                        Game.final_score.is_not(None),
                    )
                    .order_by(asc(Game.final_score), asc(Game.completed_at))
                )
            )
            .scalars()
            .all()
        )
        rank = LEADERBOARD_LIMIT + 1
        for i, row in enumerate(all_rows):
            if row.id == game.id:
                rank = i + 1
                break

    return ScoreEntry(player_id=body.player_id, move_count=body.move_count, rank=rank)


@router.get("/leaderboard", response_model=LeaderboardResponse)
@limiter.limit("60/minute")
async def get_leaderboard(request: Request) -> LeaderboardResponse:
    factory = get_session_factory()
    async with factory() as db:
        top = await _top10(db)
    return LeaderboardResponse(scores=top)


def reset_leaderboard() -> None:
    """Test helper — no-op. DB isolation is handled by conftest's _clean_db_tables fixture."""
    return

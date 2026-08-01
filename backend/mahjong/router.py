"""Mahjong Solitaire leaderboard (#871) — mirrors the Solitaire pattern.

POST /mahjong/score inserts-and-completes a Game row tagged with
``mahjong`` and the player name in ``game_metadata``.
GET /mahjong/scores returns the top 10 rows for this game type,
sorted by ``final_score`` descending (older entries break ties).
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import get_session_factory
from db.models import Game, GameType
from limiter import limiter
from vocab import GameType as GameTypeEnum

from .models import LeaderboardResponse, ScoreEntry, ScoreSubmitRequest

router = APIRouter()

LEADERBOARD_LIMIT = 10
_MAHJONG_SESSION = "mahjong-anon"


async def _mahjong_game_type_id(db: AsyncSession) -> int:
    row = (
        await db.execute(select(GameType.id).where(GameType.name == GameTypeEnum.MAHJONG))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=500,
            detail="mahjong game_type missing — run alembic migrations.",
        )
    return row


async def _top_scores(db: AsyncSession) -> list[ScoreEntry]:
    gt_id = await _mahjong_game_type_id(db)
    rows = (
        (
            await db.execute(
                select(Game)
                .where(
                    Game.game_type_id == gt_id,
                    Game.final_score.is_not(None),
                )
                .order_by(desc(Game.final_score), Game.completed_at.asc())
                .limit(LEADERBOARD_LIMIT)
            )
        )
        .scalars()
        .all()
    )

    entries: list[ScoreEntry] = []
    for i, g in enumerate(rows):
        name = (g.game_metadata or {}).get("player_name") or "anon"
        entries.append(ScoreEntry(player_name=str(name), score=int(g.final_score or 0), rank=i + 1))
    return entries


@router.post("/score", response_model=ScoreEntry, status_code=201)
@limiter.limit("5/minute")
async def submit_score(request: Request, body: ScoreSubmitRequest) -> ScoreEntry:
    factory = get_session_factory()
    async with factory() as db:
        gt_id = await _mahjong_game_type_id(db)
        game = Game(
            session_id=_MAHJONG_SESSION,
            game_type_id=gt_id,
            final_score=body.score,
            completed_at=datetime.now(timezone.utc),
            game_metadata={"player_name": body.player_name},
        )
        db.add(game)
        await db.commit()

        top = await _top_scores(db)

    for entry in top:
        if entry.player_name == body.player_name and entry.score == body.score:
            return entry
    return ScoreEntry(player_name=body.player_name, score=body.score, rank=LEADERBOARD_LIMIT + 1)


@router.get("/scores", response_model=LeaderboardResponse)
@limiter.limit("60/minute")
async def get_scores(request: Request) -> LeaderboardResponse:
    factory = get_session_factory()
    async with factory() as db:
        scores = await _top_scores(db)
    return LeaderboardResponse(scores=scores)


def reset_leaderboard() -> None:
    """Test helper — no-op. DB isolation handled by conftest's ``clean_db_tables``."""
    return

"""Hearts leaderboard (#605) — mirrors the Solitaire/Cascade pattern.

POST /hearts/score inserts-and-completes a Game row tagged with
``hearts`` and the player name in ``game_metadata``.
GET /hearts/scores returns the top 10 rows for this game type,
sorted by ``final_score`` descending (older entries break ties).

Score stored as max(0, 100 − human_cumulative_score) so higher = better.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import get_session_factory
from db.models import Game, GameType
from entitlements.dependencies import require_entitlement
from limiter import limiter
from vocab import GameType as GameTypeEnum

from .models import LeaderboardResponse, ScoreEntry, ScoreSubmitRequest

router = APIRouter(dependencies=[Depends(require_entitlement("hearts"))])

LEADERBOARD_LIMIT = 10
_HEARTS_SESSION = "hearts-anon"


async def _hearts_game_type_id(db: AsyncSession) -> int:
    row = (
        await db.execute(select(GameType.id).where(GameType.name == GameTypeEnum.HEARTS))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=500,
            detail="hearts game_type missing — run alembic migrations.",
        )
    return row


async def _top_scores(db: AsyncSession) -> list[ScoreEntry]:
    gt_id = await _hearts_game_type_id(db)
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
        gt_id = await _hearts_game_type_id(db)
        game = Game(
            session_id=_HEARTS_SESSION,
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
    """Test helper — no-op. DB isolation handled by conftest ``clean_db_tables``."""
    return None

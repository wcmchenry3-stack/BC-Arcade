"""Yacht leaderboard — score submission and top-10 board.

POST /yacht/score applies max(0, 400 − raw_score) and persists the result.
GET /yacht/scores returns the top 10 entries sorted by transformed score
descending (older entries break ties).
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

from .models import LeaderboardResponse, ScoreEntry, YachtScoreSubmitRequest

router = APIRouter(dependencies=[Depends(require_entitlement("yacht"))])

LEADERBOARD_LIMIT = 10
_YACHT_SESSION = "yacht-anon"


def _transform_score(raw_score: int) -> int:
    return max(0, 400 - raw_score)


async def _yacht_game_type_id(db: AsyncSession) -> int:
    row = (
        await db.execute(select(GameType.id).where(GameType.name == GameTypeEnum.YACHT))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=500,
            detail="yacht game_type missing — run alembic migrations.",
        )
    return row


async def _top_scores(db: AsyncSession) -> list[ScoreEntry]:
    gt_id = await _yacht_game_type_id(db)
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
        meta = g.game_metadata or {}
        name = meta.get("player_name") or "anon"
        raw = int(meta.get("raw_score", 0))
        diff = str(meta.get("difficulty", "easy"))
        entries.append(
            ScoreEntry(
                player_name=str(name),
                raw_score=raw,
                score=int(g.final_score or 0),
                difficulty=diff,  # type: ignore[arg-type]
                timestamp=g.completed_at,
                rank=i + 1,
            )
        )
    return entries


@router.post("/score", response_model=ScoreEntry, status_code=201)
@limiter.limit("5/minute")
async def submit_score(request: Request, body: YachtScoreSubmitRequest) -> ScoreEntry:
    transformed = _transform_score(body.score)
    submitted_at = datetime.now(timezone.utc)
    factory = get_session_factory()
    async with factory() as db:
        gt_id = await _yacht_game_type_id(db)
        game = Game(
            session_id=_YACHT_SESSION,
            game_type_id=gt_id,
            final_score=transformed,
            completed_at=submitted_at,
            game_metadata={
                "player_name": body.player_name,
                "raw_score": body.score,
                "difficulty": body.difficulty,
            },
        )
        db.add(game)
        await db.commit()

        top = await _top_scores(db)

    for entry in top:
        if (
            entry.player_name == body.player_name
            and entry.raw_score == body.score
            and entry.difficulty == body.difficulty
        ):
            return entry
    return ScoreEntry(
        player_name=body.player_name,
        raw_score=body.score,
        score=transformed,
        difficulty=body.difficulty,
        timestamp=submitted_at,
        rank=LEADERBOARD_LIMIT + 1,
    )


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

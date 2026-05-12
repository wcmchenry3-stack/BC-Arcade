"""Sort Puzzle leaderboard (#1173).

GET /sort/levels  — load and return all 20 handcrafted levels.
POST /sort/score  — record highest level reached; returns rank.
GET /sort/scores  — top-10 entries by level_reached desc (ties: older wins).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import get_session_factory
from db.models import Game, GameType
from entitlements.dependencies import require_entitlement
from limiter import limiter
from vocab import GameType as GameTypeEnum

from .generate_levels import build_levels
from .models import (
    LeaderboardResponse,
    LevelData,
    LevelsResponse,
    ScoreEntry,
    ScoreSubmitRequest,
)

router = APIRouter(dependencies=[Depends(require_entitlement("sort"))])

LEADERBOARD_LIMIT = 10
_SORT_SESSION = "sort-anon"


async def _sort_game_type_id(db: AsyncSession) -> int:
    row = (
        await db.execute(select(GameType.id).where(GameType.name == GameTypeEnum.SORT))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=500,
            detail="sort game_type missing — run alembic migrations.",
        )
    return row


async def _top_scores(db: AsyncSession, gt_id: int) -> list[ScoreEntry]:
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
        entries.append(
            ScoreEntry(
                player_name=str(name),
                level_reached=int(g.final_score or 0),
                rank=i + 1,
            )
        )
    return entries


@router.get("/levels", response_model=LevelsResponse)
@limiter.limit("60/minute")
async def get_levels(request: Request) -> LevelsResponse:
    raw = await asyncio.to_thread(build_levels)
    return LevelsResponse(levels=[LevelData(**item) for item in raw])


@router.post("/score", response_model=ScoreEntry, status_code=201)
@limiter.limit("5/minute")
async def submit_score(request: Request, body: ScoreSubmitRequest) -> ScoreEntry:
    factory = get_session_factory()
    async with factory() as db:
        gt_id = await _sort_game_type_id(db)
        game = Game(
            session_id=_SORT_SESSION,
            game_type_id=gt_id,
            final_score=body.level_reached,
            completed_at=datetime.now(timezone.utc),
            game_metadata={"player_name": body.player_name},
        )
        db.add(game)
        await db.commit()

        top = await _top_scores(db, gt_id)

    for entry in top:
        if entry.player_name == body.player_name and entry.level_reached == body.level_reached:
            return entry
    return ScoreEntry(
        player_name=body.player_name,
        level_reached=body.level_reached,
        rank=LEADERBOARD_LIMIT + 1,
    )


@router.get("/scores", response_model=LeaderboardResponse)
@limiter.limit("60/minute")
async def get_scores(request: Request) -> LeaderboardResponse:
    factory = get_session_factory()
    async with factory() as db:
        gt_id = await _sort_game_type_id(db)
        scores = await _top_scores(db, gt_id)
    return LeaderboardResponse(scores=scores)

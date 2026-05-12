"""Cascade leaderboard — backed by the games table (#366, #477).

PATCH /cascade/score/{game_id} sets the player_name on an existing game row
(created by the SyncWorker via POST /games) and returns the player's rank.
GET /cascade/scores returns the top 10 scores for the leaderboard display.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import get_session_factory
from db.models import Game, GameType
from entitlements.dependencies import require_entitlement
from limiter import limiter, session_key
from session import get_session_id
from vocab import GameType as GameTypeEnum

from .models import LeaderboardResponse, ScoreEntry, SetPlayerNameRequest

router = APIRouter(dependencies=[Depends(require_entitlement("cascade"))])

LEADERBOARD_LIMIT = 10


async def _cascade_game_type_id(db: AsyncSession) -> int:
    row = (
        await db.execute(select(GameType.id).where(GameType.name == GameTypeEnum.CASCADE))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=500,
            detail="cascade game_type missing — run alembic migrations.",
        )
    return row


async def _top_scores(db: AsyncSession) -> list[ScoreEntry]:
    gt_id = await _cascade_game_type_id(db)
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


@router.patch("/score/{game_id}", response_model=ScoreEntry, status_code=200)
@limiter.limit("10/minute", key_func=session_key)
async def set_player_name(
    request: Request, game_id: uuid.UUID, body: SetPlayerNameRequest
) -> ScoreEntry:
    sid = get_session_id(request)
    factory = get_session_factory()
    async with factory() as db:
        gt_id = await _cascade_game_type_id(db)
        game = (
            await db.execute(
                select(Game).where(
                    Game.id == game_id,
                    Game.session_id == sid,
                    Game.game_type_id == gt_id,
                )
            )
        ).scalar_one_or_none()

        if game is None:
            raise HTTPException(status_code=404, detail="Game not found.")

        metadata = dict(game.game_metadata or {})
        metadata["player_name"] = body.player_name
        game.game_metadata = metadata
        await db.commit()

        # Rank = 1 + count of games that outrank this one.
        # Tie-break: equal scores rank older completed_at first (same order as
        # the leaderboard GET), so a game ranks below existing tied entries.
        score_val = game.final_score or 0
        count = (
            await db.execute(
                select(func.count()).where(
                    Game.game_type_id == gt_id,
                    Game.final_score.is_not(None),
                    or_(
                        Game.final_score > score_val,
                        and_(
                            Game.final_score == score_val,
                            Game.completed_at < game.completed_at,
                        ),
                    ),
                )
            )
        ).scalar()

    rank = int(count or 0) + 1
    return ScoreEntry(
        player_name=body.player_name,
        score=int(game.final_score or 0),
        rank=rank,
    )


@router.get("/scores", response_model=LeaderboardResponse)
@limiter.limit("60/minute")
async def get_scores(request: Request) -> LeaderboardResponse:
    factory = get_session_factory()
    async with factory() as db:
        scores = await _top_scores(db)
    return LeaderboardResponse(scores=scores)

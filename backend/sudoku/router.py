"""Sudoku leaderboards (#615, #748) — (variant, difficulty)-scoped top-10 lists.

Each (variant × difficulty) pair has its own leaderboard.  Variant defaults
to "classic" on both submit and read so existing clients remain unchanged.
Rows written before #748 have no ``variant`` key in ``game_metadata``; the
query treats those as "classic" so the classic leaderboard stays populated.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import get_session_factory
from db.models import Game, GameType
from entitlements.dependencies import require_entitlement
from limiter import limiter, session_key
from session import get_session_id
from vocab import GameType as GameTypeEnum

from .models import Difficulty, LeaderboardResponse, ScoreEntry, SetPlayerNameRequest, Variant

router = APIRouter(dependencies=[Depends(require_entitlement("sudoku"))])

LEADERBOARD_LIMIT = 10


async def _sudoku_game_type_id(db: AsyncSession) -> int:
    row = (
        await db.execute(select(GameType.id).where(GameType.name == GameTypeEnum.SUDOKU))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=500,
            detail="sudoku game_type missing — run alembic migrations.",
        )
    return row


async def _top_scores(
    db: AsyncSession, difficulty: Difficulty, variant: Variant = "classic"
) -> list[ScoreEntry]:
    gt_id = await _sudoku_game_type_id(db)
    # `as_string()` produces json_extract(...) on SQLite and ->> on JSONB.
    # Rows predating #748 lack a variant key; treat their NULL as "classic".
    variant_col = Game.game_metadata["variant"].as_string()
    if variant == "classic":
        variant_filter = or_(variant_col == "classic", variant_col.is_(None))
    else:
        variant_filter = variant_col == variant
    rows = (
        (
            await db.execute(
                select(Game)
                .where(
                    Game.game_type_id == gt_id,
                    Game.final_score.is_not(None),
                    Game.game_metadata["difficulty"].as_string() == difficulty,
                    variant_filter,
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
        gt_id = await _sudoku_game_type_id(db)
        game = (
            await db.execute(
                select(Game).where(
                    Game.id == game_id,
                    Game.game_type_id == gt_id,
                )
            )
        ).scalar_one_or_none()

        if game is None:
            raise HTTPException(status_code=404, detail="Game not found.")
        if game.session_id != sid:
            raise HTTPException(status_code=403, detail="Forbidden.")

        metadata = dict(game.game_metadata or {})
        metadata["player_name"] = body.player_name
        game.game_metadata = metadata
        await db.commit()

        # Rank within (difficulty, variant) partition.
        difficulty = metadata.get("difficulty")
        variant = metadata.get("variant") or "classic"
        score_val = game.final_score or 0
        variant_col = Game.game_metadata["variant"].as_string()
        if variant == "classic":
            variant_filter = or_(variant_col == "classic", variant_col.is_(None))
        else:
            variant_filter = variant_col == variant

        count = (
            await db.execute(
                select(func.count()).where(
                    Game.game_type_id == gt_id,
                    Game.final_score.is_not(None),
                    Game.game_metadata["difficulty"].as_string() == difficulty,
                    variant_filter,
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


@router.get("/scores/{difficulty}", response_model=LeaderboardResponse)
@limiter.limit("60/minute")
async def get_scores(
    request: Request,
    difficulty: Difficulty = Path(..., description="One of: easy, medium, hard"),
    variant: Variant = Query("classic", description="One of: classic, mini"),
) -> LeaderboardResponse:
    factory = get_session_factory()
    async with factory() as db:
        scores = await _top_scores(db, difficulty, variant)
    return LeaderboardResponse(scores=scores)

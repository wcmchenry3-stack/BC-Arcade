"""Star Swarm high score submission + leaderboard (#898).

DB-backed — scores persist across server restarts. Top-10 by score,
tie-broken by submission time (earlier submission wins on equal score).
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import get_session_factory
from db.models import Game, GameType
from entitlements.dependencies import require_entitlement
from games.filters import not_abandoned
from limiter import limiter, session_key
from starswarm.models import DEFAULT_DIFFICULTY_TIER
from vocab import GameType as GameTypeEnum

router = APIRouter(dependencies=[Depends(require_entitlement("starswarm"))])

LEADERBOARD_LIMIT = 10
_STARSWARM_SESSION = "starswarm-anon"


class ScoreRequest(BaseModel):
    player_id: str = Field(..., min_length=1, max_length=64)
    score: int = Field(..., ge=0)
    wave_reached: int = Field(..., ge=1)
    difficulty_tier: str = Field(default=DEFAULT_DIFFICULTY_TIER, max_length=32)


class LeaderboardEntry(BaseModel):
    player_id: str
    score: int
    wave_reached: int
    difficulty_tier: str
    timestamp: str
    rank: int


class LeaderboardResponse(BaseModel):
    scores: list[LeaderboardEntry]
    # POST /score only: the submitted run's own rank, or None outside the top 10
    # (#2516). Clients can't find it in `scores` reliably — an identical earlier
    # run (same name, score, wave, tier) is indistinguishable from it there.
    rank: int | None = None


async def _starswarm_game_type_id(db: AsyncSession) -> int:
    row = (
        await db.execute(select(GameType.id).where(GameType.name == GameTypeEnum.STARSWARM))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=500,
            detail="starswarm game_type missing — run alembic migrations.",
        )
    return row


async def _top10(db: AsyncSession) -> list[LeaderboardEntry]:
    gt_id = await _starswarm_game_type_id(db)
    rows = (
        (
            await db.execute(
                select(Game)
                .where(
                    Game.game_type_id == gt_id,
                    Game.final_score.is_not(None),
                    not_abandoned(),
                )
                .order_by(desc(Game.final_score), Game.completed_at.asc())
                .limit(LEADERBOARD_LIMIT)
            )
        )
        .scalars()
        .all()
    )
    entries: list[LeaderboardEntry] = []
    for i, g in enumerate(rows):
        meta = g.game_metadata or {}
        entries.append(
            LeaderboardEntry(
                player_id=str(meta.get("player_name") or "anon"),
                score=int(g.final_score or 0),
                wave_reached=int(meta.get("wave_reached") or 1),
                difficulty_tier=str(meta.get("difficulty_tier") or DEFAULT_DIFFICULTY_TIER),
                timestamp=g.completed_at.isoformat() if g.completed_at else "",
                rank=i + 1,
            )
        )
    return entries


@router.post("/score", response_model=LeaderboardResponse, status_code=200)
@limiter.limit("10/minute", key_func=session_key)
async def submit_score(request: Request, body: ScoreRequest) -> LeaderboardResponse:
    factory = get_session_factory()
    async with factory() as db:
        gt_id = await _starswarm_game_type_id(db)
        game = Game(
            session_id=_STARSWARM_SESSION,
            game_type_id=gt_id,
            final_score=body.score,
            outcome="completed",
            completed_at=datetime.now(timezone.utc),
            game_metadata={
                "player_name": body.player_id,
                "wave_reached": body.wave_reached,
                "difficulty_tier": body.difficulty_tier,
            },
        )
        db.add(game)
        await db.commit()
        top = await _top10(db)
        # Same ordering as _top10: higher score first, earlier run first on a tie.
        ahead = await db.scalar(
            select(func.count())
            .select_from(Game)
            .where(
                Game.game_type_id == gt_id,
                Game.final_score.is_not(None),
                not_abandoned(),
                Game.id != game.id,
                or_(
                    Game.final_score > game.final_score,
                    and_(
                        Game.final_score == game.final_score,
                        Game.completed_at <= game.completed_at,
                    ),
                ),
            )
        )
    rank = int(ahead or 0) + 1
    return LeaderboardResponse(scores=top, rank=rank if rank <= LEADERBOARD_LIMIT else None)


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

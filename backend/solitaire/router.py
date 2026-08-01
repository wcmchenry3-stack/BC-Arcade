"""Solitaire leaderboard (#594) — mirrors the Cascade pattern.

POST /solitaire/score inserts-and-completes a Game row tagged with
``solitaire`` and the player name in ``game_metadata``.
GET /solitaire/scores returns the top 10 rows for this game type,
sorted by ``final_score`` descending (older entries break ties).

The leaderboard is shared across Draw-1 and Draw-3 per epic #591 — the
router doesn't partition on ``drawMode``. If that ever changes, a draw
mode would need to be recorded in metadata and filtered here.
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
_SOLITAIRE_SESSION = "solitaire-anon"  # placeholder until SSO


async def _solitaire_game_type_id(db: AsyncSession) -> int:
    row = (
        await db.execute(select(GameType.id).where(GameType.name == GameTypeEnum.SOLITAIRE))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=500,
            detail="solitaire game_type missing — run alembic migrations.",
        )
    return row


async def _top_scores(db: AsyncSession) -> list[ScoreEntry]:
    gt_id = await _solitaire_game_type_id(db)
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
        gt_id = await _solitaire_game_type_id(db)
        game = Game(
            session_id=_SOLITAIRE_SESSION,
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
    # Not in top 10 — report the truncated-off rank.
    return ScoreEntry(player_name=body.player_name, score=body.score, rank=LEADERBOARD_LIMIT + 1)


@router.get("/scores", response_model=LeaderboardResponse)
@limiter.limit("60/minute")
async def get_scores(request: Request) -> LeaderboardResponse:
    factory = get_session_factory()
    async with factory() as db:
        scores = await _top_scores(db)
    return LeaderboardResponse(scores=scores)


def reset_leaderboard() -> None:
    """Test helper — no-op. The leaderboard lives in the DB; conftest's
    ``clean_db_tables`` fixture handles per-test isolation. Kept so the
    autouse fixture in ``test_solitaire_api.py`` can call it symmetrically
    with the Cascade tests.
    """
    return

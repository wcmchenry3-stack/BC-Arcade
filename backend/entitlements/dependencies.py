"""FastAPI entitlement dependency (#1051).

require_entitlement(game_slug) returns a dependency that enforces session
entitlement on premium game routes. Free games pass through unconditionally.
"""

from __future__ import annotations

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import get_session_factory
from db.models import GameEntitlement, GameType
from entitlements.service import is_dev_override_active
from session import get_session_id


class EntitlementError(HTTPException):
    """Raised when a session lacks entitlement for a premium game."""

    def __init__(self, game_slug: str) -> None:
        super().__init__(status_code=403, detail="not_entitled")
        self.game_slug = game_slug


async def check_entitlement(db: AsyncSession, session_id: str, game_slug: str) -> None:
    """Raise EntitlementError if session_id is not entitled to game_slug.

    No-op for free (non-premium) game types and unknown game slugs.
    """
    if is_dev_override_active():
        return
    is_premium = (
        await db.execute(select(GameType.is_premium).where(GameType.name == game_slug))
    ).scalar_one_or_none()
    if not is_premium:
        return
    entitled = (
        await db.execute(
            select(GameEntitlement).where(
                GameEntitlement.session_id == session_id,
                GameEntitlement.game_slug == game_slug,
            )
        )
    ).scalar_one_or_none()
    if entitled is None:
        raise EntitlementError(game_slug)


def require_entitlement(game_slug: str):
    """Dependency factory — inject as router-level dependency to gate all routes."""

    async def _dep(request: Request) -> None:
        sid = get_session_id(request)
        factory = get_session_factory()
        async with factory() as db:
            await check_entitlement(db, sid, game_slug)

    return _dep

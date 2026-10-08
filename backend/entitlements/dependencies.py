"""FastAPI entitlement dependency (#1051).

require_entitlement(game_slug) returns a dependency that enforces session
entitlement on premium game routes. Free games pass through unconditionally.
"""

from __future__ import annotations

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import DbSession
from db.models import GameEntitlement
from entitlements.service import is_dev_override_active
from games import catalog_cache
from session import get_session_id


class EntitlementError(HTTPException):
    """Raised when a session lacks entitlement for a premium game."""

    def __init__(self, game_slug: str) -> None:
        super().__init__(status_code=403, detail="not_entitled")
        self.game_slug = game_slug


async def check_entitlement(db: AsyncSession, session_id: str, game_slug: str) -> None:
    """Raise EntitlementError if session_id is not entitled to game_slug.

    No-op for free (non-premium) game types and unknown game slugs. The tier
    comes from the process-level catalog cache (#2966), so a free game costs no
    query and a premium one only the indexed ``game_entitlements`` lookup.
    """
    if is_dev_override_active():
        return
    game_type = await catalog_cache.get_game_type(db, game_slug)
    if game_type is None or not game_type.is_premium:
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
    """Dependency factory — inject as router-level dependency to gate all routes.

    Depends on ``get_db``, so it checks on the request's own session (the one
    a route taking ``db: DbSession`` also gets) rather than opening a second.
    """

    async def _dep(request: Request, db: DbSession) -> None:
        sid = get_session_id(request)
        await check_entitlement(db, sid, game_slug)

    return _dep

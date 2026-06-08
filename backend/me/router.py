"""FastAPI router for /me — user data management (#1923)."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import Response
from sqlalchemy import delete

from db.base import get_session_factory
from db.models import BugLog, Game, GameEntitlement
from limiter import limiter, session_key
from session import get_session_id

router = APIRouter()


@router.delete("", status_code=204)
@limiter.limit("5/minute", key_func=session_key)
async def delete_me(request: Request) -> Response:
    """Delete all data associated with the caller's session (GDPR/CCPA right to erasure)."""
    sid = get_session_id(request)
    factory = get_session_factory()
    async with factory() as db:
        # GameEvent rows cascade via DB FK (ondelete="CASCADE") when Games are deleted.
        await db.execute(delete(Game).where(Game.session_id == sid))
        await db.execute(delete(GameEntitlement).where(GameEntitlement.session_id == sid))
        await db.execute(delete(BugLog).where(BugLog.session_id == sid))
        await db.commit()
    return Response(status_code=204)

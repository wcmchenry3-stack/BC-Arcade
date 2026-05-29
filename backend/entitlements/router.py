"""FastAPI router for GET /entitlements (#1050)."""

from __future__ import annotations

from fastapi import APIRouter, Request

from db.base import get_session_factory
from limiter import limiter, session_key
from session import get_session_id

from . import service
from .schemas import EntitlementsResponse

router = APIRouter()


@router.get("", response_model=EntitlementsResponse)
@limiter.limit("30/minute", key_func=session_key)
async def get_entitlements(request: Request) -> EntitlementsResponse:
    """Return a signed RS256 JWT listing games this session may access."""
    sid = get_session_id(request)
    if service.is_dev_override_active():
        entitled_games = await service.get_entitled_games(None, sid)
    else:
        factory = get_session_factory()
        async with factory() as db:
            entitled_games = await service.get_entitled_games(db, sid)
    token, expires_at = service.issue_token(sid, entitled_games)
    return EntitlementsResponse(
        token=token,
        expires_at=expires_at,
    )

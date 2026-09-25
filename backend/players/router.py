"""``/players/me``: the caller's one display name (#2624, #2519 decisions 17-18).

The player is the ``X-Session-ID`` (one per install until accounts, #1047).
Every leaderboard shows this name for all of the player's finished games, and
a player without one appears on no board. All three routes are idempotent, so
the app's offline sync can replay them safely.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.exc import SQLAlchemyError

from db.base import get_session_factory
from limiter import limiter, session_key
from session import get_session_id

from . import service
from .schemas import PlayerResponse, SetDisplayNameRequest

logger = logging.getLogger(__name__)

router = APIRouter()

# Keyed by session, like the games write routes. The write limit matches
# PATCH /games/{id}/name, which also sets the name.
PLAYER_READ_RATE_LIMIT = "60/minute"
PLAYER_WRITE_RATE_LIMIT = "10/minute"


def _db_error(what: str, detail: str, exc: SQLAlchemyError) -> HTTPException:
    # Class name only: the message carries bound parameters (the session id).
    logger.error("players %s failed: %s", what, type(exc).__name__)
    return HTTPException(status_code=500, detail=detail)


@router.get("/me", response_model=PlayerResponse)
@limiter.limit(PLAYER_READ_RATE_LIMIT, key_func=session_key)
async def get_my_player(request: Request) -> PlayerResponse:
    """The caller's display name, or ``{"display_name": null}``."""
    sid = get_session_id(request)
    factory = get_session_factory()
    async with factory() as db:
        try:
            name = await service.get_display_name(db, sid)
        except SQLAlchemyError as exc:
            raise _db_error("read", "Failed to load display name.", exc) from exc
    return PlayerResponse(display_name=name)


@router.put("/me", response_model=PlayerResponse)
@limiter.limit(PLAYER_WRITE_RATE_LIMIT, key_func=session_key)
async def put_my_player(request: Request, body: SetDisplayNameRequest) -> PlayerResponse:
    """Set the caller's display name; returns the stored (trimmed) name.

    Sending the name the player already has writes nothing and returns the
    same response.
    """
    sid = get_session_id(request)
    factory = get_session_factory()
    async with factory() as db:
        try:
            if await service.set_display_name(db, sid, body.display_name):
                await db.commit()
        except SQLAlchemyError as exc:
            await db.rollback()
            raise _db_error("write", "Failed to save display name.", exc) from exc
    return PlayerResponse(display_name=body.display_name)


@router.delete("/me", status_code=204)
@limiter.limit(PLAYER_WRITE_RATE_LIMIT, key_func=session_key)
async def delete_my_player(request: Request) -> Response:
    """Clear the caller's display name, which takes them off every board.

    204 whether or not a name was set.
    """
    sid = get_session_id(request)
    factory = get_session_factory()
    async with factory() as db:
        try:
            await service.clear_display_name(db, sid)
            await db.commit()
        except SQLAlchemyError as exc:
            await db.rollback()
            raise _db_error("delete", "Failed to clear display name.", exc) from exc
    return Response(status_code=204)

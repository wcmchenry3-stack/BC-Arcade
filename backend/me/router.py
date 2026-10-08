"""FastAPI router for /me — user data management (#1923)."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import Response
from sqlalchemy import delete

from db.base import DbSession
from db.models import (
    BugLog,
    DailyWordProgress,
    Game,
    GameEntitlement,
    Player,
    PurchaseLink,
)
from limiter import limiter, session_key
from session import get_session_id

router = APIRouter()


@router.delete("", status_code=204)
@limiter.limit("5/minute", key_func=session_key)
async def delete_me(request: Request, db: DbSession) -> Response:
    """Delete all data associated with the caller's session (GDPR/CCPA right to erasure)."""
    sid = get_session_id(request)
    # GameEvent rows cascade via DB FK (ondelete="CASCADE") when Games are deleted.
    await db.execute(delete(Game).where(Game.session_id == sid))
    # The session's links to store purchases (#2786, docs/IAP.md §8.5). The
    # `purchases` rows and their `purchase_events` stay: they are the store's
    # transaction records, kept for refunds, chargebacks, fraud and legal
    # claims. A later Restore Purchases re-links from the store. No
    # recompute is needed: this session's entitlements are deleted next.
    await db.execute(delete(PurchaseLink).where(PurchaseLink.session_id == sid))
    await db.execute(delete(GameEntitlement).where(GameEntitlement.session_id == sid))
    await db.execute(delete(BugLog).where(BugLog.session_id == sid))
    # Daily Word guess records are session-keyed too (#2197); the 14-day
    # retention prune is a backstop, not the erasure path (#2779).
    await db.execute(delete(DailyWordProgress).where(DailyWordProgress.session_id == sid))
    # The display name (#2624) is personal data too.
    await db.execute(delete(Player).where(Player.session_id == sid))
    await db.commit()
    return Response(status_code=204)

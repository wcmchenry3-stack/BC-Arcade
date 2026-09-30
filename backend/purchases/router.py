"""``POST /purchases/apple`` and ``POST /purchases/google`` (#840, docs/IAP.md §8.2).

Flow for both: validate ``X-Session-ID`` → parse the store key → per-store-key
rate limit → store verification (pluggable, ``purchases/verifiers.py``) →
idempotent upsert / link / entitlement recompute (``purchases/service.py``) →
Google acknowledgement → a fresh entitlement JWT from the existing
``entitlements.service``.

Rate limits (all apply; the first to trip returns 429): per session, per
client IP, and per ``store_key`` — the last counted after the key is parsed
and before any store call.

``POST /purchases/apple/notifications`` (#2786) takes App Store Server
Notifications V2 with no session: it is authenticated by Apple's JWS
signature alone, rate limited per IP, and answers 200 for anything verified
(even if irrelevant) so Apple stops retrying, ``4xx`` for a payload that fails
verification and ``503`` while Apple verification is not configured.
The Google RTDN webhook belongs to #2787.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable, Coroutine
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from limits import parse_many

from db.base import get_session_factory
from entitlements import service as entitlements_service
from entitlements.schemas import EntitlementsResponse
from limiter import limiter, session_key
from session import get_session_id

from . import apple, apple_notifications, service
from .google import get_google_verifier
from .schemas import (
    AppleNotificationRequest,
    ApplePurchaseRequest,
    GooglePurchaseRequest,
    PurchaseResponse,
)
from .verifiers import (
    AppleEvidence,
    AppleVerifier,
    GoogleEvidence,
    GoogleVerifier,
    PurchaseError,
    VerifiedPurchase,
)

_log = logging.getLogger("audit")

# Owner-tunable (IAP.md §8.2).
PURCHASE_SESSION_RATE_LIMIT = "20/minute"
PURCHASE_IP_RATE_LIMIT = "30/minute;200/day"
PURCHASE_STORE_KEY_RATE_LIMIT = "10/hour;30/day"
# Apple sends from its own address ranges; a 429 loses nothing (Apple retries,
# and the notification-history replay backfills).
APPLE_NOTIFICATION_IP_RATE_LIMIT = "300/minute"


class _InvalidRequestRoute(APIRoute):
    """Report a malformed body as ``400 invalid_request`` (IAP.md §8.2), not FastAPI's 422.

    422 is reserved for store-verification failures, which the client must not finish.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            try:
                return await original(request)
            except RequestValidationError:
                raise HTTPException(status_code=400, detail="invalid_request") from None

        return handler


router = APIRouter(route_class=_InvalidRequestRoute)


def _session_id(request: Request) -> str:
    """``X-Session-ID``, or the contract's ``400 invalid_request`` (IAP.md §8.2).

    The shared ``session.get_session_id`` answers with a free-text detail;
    these routes speak only the documented codes.
    """
    try:
        return get_session_id(request)
    except HTTPException:
        raise HTTPException(status_code=400, detail="invalid_request") from None


def _hit_store_key_limit(platform: str, store_key: str) -> None:
    # Bucketed by a hash so raw store keys never sit in limiter storage.
    bucket = hashlib.sha256(f"{platform}:{store_key}".encode()).hexdigest()
    for item in parse_many(PURCHASE_STORE_KEY_RATE_LIMIT):
        if not limiter.limiter.hit(item, "purchases_store_key", bucket):
            _log.warning('{"event": "rate_limit_exceeded", "scope": "purchase_store_key"}')
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Try again later.",
                headers={"Retry-After": "3600"},
            )


async def _complete(
    *,
    session_id: str,
    source: service.Source,
    verified: VerifiedPurchase,
    observed_at: datetime,
    platform: str,
    store_key: str,
    google_verifier: GoogleVerifier | None = None,
    google_evidence: GoogleEvidence | None = None,
) -> PurchaseResponse:
    if verified.platform != platform or verified.store_key != store_key:
        # The verifier's answer must describe the evidence that was rate-limited.
        raise PurchaseError(422, "verification_failed")
    factory = get_session_factory()
    async with factory() as db:
        result = await service.process_verified_purchase(
            db,
            session_id=session_id,
            source=source,
            verified=verified,
            observed_at=observed_at,
        )
        if result.needs_acknowledgement and google_verifier and google_evidence:
            try:
                await google_verifier.acknowledge(google_evidence)
            except PurchaseError:
                # The grant is persisted; the unacknowledged-purchase sweep
                # (#2787) retries within Google's 3-day window.
                _log.warning('{"event": "purchase_ack_failed", "platform": "google"}')
            else:
                await service.mark_acknowledged(db, result.purchase_id)
        entitled = await entitlements_service.get_entitled_games(db, session_id)
    token, expires_at = entitlements_service.issue_token(session_id, entitled)
    return PurchaseResponse(
        status=result.status,
        game_slug=result.game_slug,
        product_id=result.product_id,
        finish=result.status != "pending",
        entitlements=EntitlementsResponse(token=token, expires_at=expires_at),
    )


def _http(exc: PurchaseError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.post("/apple", response_model=PurchaseResponse)
@limiter.limit(PURCHASE_IP_RATE_LIMIT)
@limiter.limit(PURCHASE_SESSION_RATE_LIMIT, key_func=session_key)
async def post_apple_purchase(
    request: Request,
    body: ApplePurchaseRequest,
    verifier: AppleVerifier = Depends(apple.get_apple_verifier),  # noqa: B008
) -> PurchaseResponse:
    """Verify an App Store transaction and link it to this session."""
    sid = _session_id(request)
    try:
        store_key = apple.parse_store_key(body.signed_transaction)
        _hit_store_key_limit("apple", store_key)
        # Taken before the store call: a stale answer must lose to a newer event.
        observed_at = datetime.now(timezone.utc)
        verified = await verifier.verify(AppleEvidence(signed_transaction=body.signed_transaction))
        return await _complete(
            session_id=sid,
            source=body.source,
            verified=verified,
            observed_at=observed_at,
            platform="apple",
            store_key=store_key,
        )
    except PurchaseError as exc:
        raise _http(exc) from None


@router.post("/google", response_model=PurchaseResponse)
@limiter.limit(PURCHASE_IP_RATE_LIMIT)
@limiter.limit(PURCHASE_SESSION_RATE_LIMIT, key_func=session_key)
async def post_google_purchase(
    request: Request,
    body: GooglePurchaseRequest,
    verifier: GoogleVerifier = Depends(get_google_verifier),  # noqa: B008
) -> PurchaseResponse:
    """Verify a Google Play purchase, link it to this session and acknowledge it."""
    sid = _session_id(request)
    try:
        if service.slug_for_product(body.product_id) is None:
            raise PurchaseError(422, "unknown_product")
        _hit_store_key_limit("google", body.purchase_token)
        evidence = GoogleEvidence(product_id=body.product_id, purchase_token=body.purchase_token)
        observed_at = datetime.now(timezone.utc)
        verified = await verifier.verify(evidence)
        if verified.product_id != body.product_id:
            raise PurchaseError(422, "verification_failed")
        return await _complete(
            session_id=sid,
            source=body.source,
            verified=verified,
            observed_at=observed_at,
            platform="google",
            store_key=body.purchase_token,
            google_verifier=verifier,
            google_evidence=evidence,
        )
    except PurchaseError as exc:
        raise _http(exc) from None


@router.post("/apple/notifications")
@limiter.limit(APPLE_NOTIFICATION_IP_RATE_LIMIT)
async def post_apple_notification(request: Request, body: AppleNotificationRequest) -> dict:
    """App Store Server Notifications V2 (docs/IAP.md §6.5)."""
    verifier = apple.configured_verifier()
    if verifier is None:
        raise HTTPException(status_code=503, detail="store_unavailable")
    try:
        outcome = await apple_notifications.handle_signed_notification(
            verifier, body.signedPayload, get_session_factory()
        )
    except PurchaseError as exc:
        # Why it was refused — never the payload.
        _log.warning(
            json.dumps(
                {
                    "event": "apple_notification_rejected",
                    "status": exc.status_code,
                    "detail": exc.detail,
                }
            )
        )
        raise _http(exc) from None
    return {"status": outcome}

"""Google Play RTDN handling: parse a Pub/Sub push and apply it (#2787, IAP.md §7.4, §7.6).

Called only after :class:`purchases.google_push_auth.PushAuthenticator` has
accepted the push. The notification only says *which* purchase to look at
(:func:`handle_developer_notification`). Its claims are never applied: the
purchase is always re-read from the Play Developer API and the store's answer
is what gets written, with the notification's ``eventTimeMillis`` as the event
time and ``pubsub:<messageId>`` as the dedupe key.

Nothing here logs a payload, a purchase token, an order id or the bearer
token: only the notification kind, the outcome and the Pub/Sub message id.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Purchase

from . import service
from ._common import log_event
from .google_play import PlayVerifier, parse_millis
from .schemas import MAX_PURCHASE_TOKEN_CHARS
from .verifiers import GoogleEvidence, PurchaseError, VerifiedPurchase

_log = logging.getLogger("audit")

Outcome = Literal["applied", "unchanged", "ignored", "test", "unconfirmed"]

# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------

# OneTimeProductNotification.notificationType
ONE_TIME_PRODUCT_PURCHASED = 1
ONE_TIME_PRODUCT_CANCELED = 2
# VoidedPurchaseNotification
PRODUCT_TYPE_ONE_TIME = 2
REFUND_TYPE_QUANTITY_BASED_PARTIAL = 2
MAX_MESSAGE_ID_CHARS = 128
MAX_DATA_CHARS = 16_000

# VoidedPurchase.voidedReason → purchases.revocation_reason
_VOIDED_REASONS = {
    0: "voided_other",
    1: "voided_remorse",
    2: "voided_not_received",
    3: "voided_defective",
    4: "voided_accidental_purchase",
    5: "voided_fraud",
    6: "voided_friendly_fraud",
    7: "voided_chargeback",
    8: "voided_unacknowledged_purchase",
}


def voided_reason(value: object) -> str:
    return _VOIDED_REASONS.get(value, "voided") if isinstance(value, int) else "voided"


def parse_push(body: bytes) -> tuple[str, dict[str, Any]]:
    """(messageId, decoded DeveloperNotification) from a Pub/Sub push body. Only call after auth.

    ``400 invalid_request`` for anything that is not a push envelope with a
    message id and base64 JSON-object data.
    """
    invalid = PurchaseError(400, "invalid_request")
    try:
        envelope = json.loads(body)
    except ValueError:
        raise invalid from None
    message = envelope.get("message") if isinstance(envelope, dict) else None
    if not isinstance(message, dict):
        raise invalid
    message_id = message.get("messageId") or message.get("message_id")
    data = message.get("data")
    if not isinstance(message_id, str) or not 0 < len(message_id) <= MAX_MESSAGE_ID_CHARS:
        raise invalid
    if not isinstance(data, str) or not 0 < len(data) <= MAX_DATA_CHARS:
        raise invalid
    try:
        note = json.loads(base64.b64decode(data, validate=True))
    except (ValueError, binascii.Error):
        raise invalid from None
    if not isinstance(note, dict):
        raise invalid
    return message_id, note


# A notification's eventTimeMillis comes from the (authenticated but not
# body-bound) push; it may not claim a time further ahead than this.
EVENT_TIME_LEEWAY = timedelta(minutes=2)
# Most time an RTDN push spends acknowledging (the subscription's ack deadline
# should be 60 s, IAP.md §7.6).
RTDN_ACK_BUDGET_S = 20.0


def clamp_event_time(event_at: datetime | None, now: datetime) -> datetime | None:
    """``min(event_at, now + EVENT_TIME_LEEWAY)`` — a replayed far-future time cannot pin the watermark."""
    if event_at is None:
        return None
    return min(event_at, now + EVENT_TIME_LEEWAY)


def is_partial_refund(record: dict[str, Any]) -> bool:
    """A quantity-based partial refund (``voidedQuantity`` set): our products are quantity 1, so
    it cannot void one of them; ignored on both the RTDN and the poll path."""
    return record.get("voidedQuantity") is not None


def valid_token(value: object) -> str | None:
    if isinstance(value, str) and 0 < len(value) <= MAX_PURCHASE_TOKEN_CHARS:
        return value
    return None


async def read_store_purchase(verifier: PlayVerifier, token: str) -> VerifiedPurchase | None:
    """The purchase as Play reports it now; None when it is not one of ours.

    A store outage (503) propagates, so Pub/Sub retries the message.
    """
    try:
        return await verifier.read(token)
    except PurchaseError as exc:
        if exc.status_code >= 500:
            raise
        return None


async def _acknowledge_if_needed(
    verifier: PlayVerifier, session_factory: Callable[[], AsyncSession], token: str
) -> None:
    """Acknowledge a persisted, owned, unacknowledged purchase (IAP.md §7.3)."""
    async with session_factory() as db:
        row = (
            await db.execute(
                select(
                    Purchase.id, Purchase.product_id, Purchase.state, Purchase.acknowledged_at
                ).where(Purchase.platform == "google", Purchase.store_key == token)
            )
        ).first()
        if row is None or row.state != "owned" or row.acknowledged_at is not None:
            return
        try:
            # Bounded so the push is answered well inside the subscription's
            # ack deadline; the sweep finishes anything left.
            await asyncio.wait_for(
                verifier.acknowledge(
                    GoogleEvidence(product_id=row.product_id, purchase_token=token)
                ),
                timeout=RTDN_ACK_BUDGET_S,
            )
        except (PurchaseError, TimeoutError):
            # Persisted; the sweep retries inside the 3-day window.
            _log.warning(json.dumps({"event": "purchase_ack_failed", "platform": "google"}))
            return
        await service.mark_acknowledged(db, row.id)


async def _apply(
    session_factory: Callable[[], AsyncSession],
    verified: VerifiedPurchase,
    *,
    dedupe_key: str,
    event_at: datetime | None,
) -> bool:
    """Apply a re-read store state to a known purchase, or record an unknown one (unlinked).

    ``event_at`` None means the store read's own time (``verified.event_at``:
    completion time for owned, the epoch for pending), else the request time.
    """
    if event_at is None:
        event_at = verified.event_at
    async with session_factory() as db:
        if verified.state != "pending" and await service.purchase_exists(
            db, "google", verified.store_key
        ):
            return await service.apply_store_state(
                db,
                platform="google",
                store_key=verified.store_key,
                state=verified.state,  # type: ignore[arg-type]
                reason=verified.revocation_reason,
                dedupe_key=dedupe_key,
                event_at=event_at,
                environment=verified.environment,
            )
        return await service.record_store_purchase(
            db, verified, dedupe_key=dedupe_key, event_at=event_at
        )


async def find_voided(
    verifier: PlayVerifier, token: str, *, around: datetime, now: datetime, max_pages: int = 5
) -> dict[str, Any] | None:
    """The ``voidedpurchases.list`` record for ``token`` near ``around``, or None."""
    earliest = now - timedelta(days=30) + timedelta(minutes=5)
    start = max(around - timedelta(hours=1), earliest)
    page_token: str | None = None
    for _ in range(max_pages):
        page = await verifier.api.list_voided(
            start_ms=int(start.timestamp() * 1000), page_token=page_token
        )
        for record in page.get("voidedPurchases") or []:
            if (
                isinstance(record, dict)
                and record.get("purchaseToken") == token
                and not is_partial_refund(record)
            ):
                return record
        page_token = (page.get("tokenPagination") or {}).get("nextPageToken")
        if not page_token:
            break
    return None


async def _one_time(
    verifier: PlayVerifier,
    otp: dict[str, Any],
    *,
    dedupe_key: str,
    event_at: datetime | None,
    session_factory: Callable[[], AsyncSession],
) -> tuple[str, Outcome]:
    ntype = otp.get("notificationType")
    token = valid_token(otp.get("purchaseToken"))
    if ntype not in (ONE_TIME_PRODUCT_PURCHASED, ONE_TIME_PRODUCT_CANCELED) or token is None:
        return "one_time", "ignored"
    kind = "purchased" if ntype == ONE_TIME_PRODUCT_PURCHASED else "canceled"
    verified = await read_store_purchase(verifier, token)
    if verified is None:
        return kind, "ignored"
    announced = {"owned", "pending"} if kind == "purchased" else {"cancelled", "revoked"}
    if kind == "canceled" and verified.state not in announced:
        # Play does not (yet) say what the notification claims: apply nothing.
        return kind, "unconfirmed"
    # For PURCHASED the notification's time is never used (#2787 review B2,
    # S1): an owned answer is ordered by Play's own purchaseCompletionTime and a
    # pending one keeps the epoch, so neither a notification that raced a
    # completing payment nor a replayed far-future eventTimeMillis can move the
    # watermark past a later real event. A terminal state Play confirms for a
    # CANCELED notification uses its (clamped) event time.
    at = event_at if kind == "canceled" else None
    changed = await _apply(session_factory, verified, dedupe_key=dedupe_key, event_at=at)
    if kind == "purchased":
        # Delivered even if no client ever reports: meets the 3-day deadline.
        await _acknowledge_if_needed(verifier, session_factory, token)
    return kind, "applied" if changed else "unchanged"


async def _voided(
    verifier: PlayVerifier,
    voided: dict[str, Any],
    *,
    dedupe_key: str,
    event_at: datetime | None,
    session_factory: Callable[[], AsyncSession],
    now: datetime,
) -> Outcome:
    token = valid_token(voided.get("purchaseToken"))
    if (
        token is None
        or voided.get("productType") != PRODUCT_TYPE_ONE_TIME
        or voided.get("refundType") == REFUND_TYPE_QUANTITY_BASED_PARTIAL
    ):
        return "ignored"
    verified = await read_store_purchase(verifier, token)
    reason = "voided"
    if verified is None or verified.state != "revoked":
        # getproductpurchasev2 can lag a refund; the Voided Purchases API is
        # Google's record of voids. Confirm there before revoking anything.
        record = await find_voided(verifier, token, around=event_at or now, now=now)
        if record is None:
            return "unconfirmed"
        reason = voided_reason(record.get("voidedReason"))
    async with session_factory() as db:
        known = await service.purchase_exists(db, "google", token)
        if known:
            changed = await service.apply_store_state(
                db,
                platform="google",
                store_key=token,
                state="revoked",
                reason=reason,
                dedupe_key=dedupe_key,
                event_at=event_at,
                environment=verified.environment if verified else None,
            )
            return "applied" if changed else "unchanged"
    if verified is None:
        return "ignored"  # not one of ours, or no product to record it under
    revoked = replace(
        verified, state="revoked", revoked_at=event_at, revocation_reason=reason, event_at=None
    )
    changed = await _apply(session_factory, revoked, dedupe_key=dedupe_key, event_at=event_at)
    return "applied" if changed else "unchanged"


async def handle_developer_notification(
    verifier: PlayVerifier,
    note: dict[str, Any],
    message_id: str,
    session_factory: Callable[[], AsyncSession],
    *,
    now: datetime | None = None,
) -> Outcome:
    """Apply one authenticated RTDN ``DeveloperNotification`` (IAP.md §7.4, §7.6)."""
    dedupe_key = f"pubsub:{message_id}"
    if note.get("packageName") != verifier.config.package_name:
        log_event("google_notification", kind="other_package", outcome="ignored", id=message_id)
        return "ignored"
    if isinstance(note.get("testNotification"), dict):
        log_event("google_notification", kind="test", outcome="test", id=message_id)
        return "test"
    now = now or datetime.now(UTC)
    event_at = clamp_event_time(parse_millis(note.get("eventTimeMillis")), now)
    otp = note.get("oneTimeProductNotification")
    voided = note.get("voidedPurchaseNotification")
    if isinstance(otp, dict):
        kind, outcome = await _one_time(
            verifier, otp, dedupe_key=dedupe_key, event_at=event_at, session_factory=session_factory
        )
    elif isinstance(voided, dict):
        kind = "voided"
        outcome = await _voided(
            verifier,
            voided,
            dedupe_key=dedupe_key,
            event_at=event_at,
            session_factory=session_factory,
            now=now,
        )
    else:
        # Subscription notifications and future types: acknowledge, do nothing.
        kind, outcome = "other", "ignored"
    log_event("google_notification", kind=kind, outcome=outcome, id=message_id)
    return outcome

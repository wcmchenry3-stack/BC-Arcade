"""Google Play RTDN webhook, voided-purchases poll and acknowledgement sweep (#2787, IAP.md §7.6).

**Push authentication** (:class:`PushAuthenticator`). Pub/Sub push requests
carry a Google-signed OIDC ID token in ``Authorization: Bearer``. It is
verified before the body is even parsed: header ``alg`` must be ``RS256``
(no ``none``, no HMAC), the ``kid`` must name a key in Google's JWKS
(fetched over HTTPS from Google, cached), and the signature, ``iss``
(``https://accounts.google.com``), ``aud`` (``GOOGLE_RTDN_AUDIENCE``),
``exp`` and ``iat`` must check out; then ``email`` must be the configured push
service account with ``email_verified``. Anything else is 401 (403 for a
valid token from another service account). A JWKS that cannot be fetched is
503, so Pub/Sub retries. It never fails open.

**Notifications** (:func:`handle_developer_notification`). The notification
only says *which* purchase to look at. Its claims are never applied: the
purchase is always re-read from the Play Developer API and the store's
answer is what gets written, with the notification's ``eventTimeMillis`` as
the event time and ``pubsub:<messageId>`` as the dedupe key.

**Backstops.** :func:`poll_voided_purchases` reads ``voidedpurchases.list``
for the last 48 h and revokes matches (event time ``voidedTimeMillis``,
dedupe per voided purchase); :func:`acknowledge_sweep` acknowledges ``owned``
purchases that are still unacknowledged inside Google's 3-day window. Both
run at startup and daily (:func:`run_google_jobs_loop`) and by hand
(``scripts/google_play_jobs.py``).

Nothing here logs a payload, a purchase token, an order id or the bearer
token: only the notification kind, the outcome and the Pub/Sub message id.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import httpx
import jwt
import sentry_sdk
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.models import Purchase

from . import service
from .google_play import (
    GoogleConfig,
    PlayVerifier,
    build_verifier,
    misconfigured,
    parse_millis,
)
from .schemas import MAX_PURCHASE_TOKEN_CHARS
from .verifiers import GoogleEvidence, PurchaseError, VerifiedPurchase

_log = logging.getLogger("audit")

Outcome = Literal["applied", "unchanged", "ignored", "test", "unconfirmed"]

# ---------------------------------------------------------------------------
# Push authentication (Pub/Sub OIDC)
# ---------------------------------------------------------------------------

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
PUSH_ALGORITHM = "RS256"
MAX_BEARER_CHARS = 4_096
JWKS_TTL_S = 3_600.0
# An unknown kid refetches the JWKS at most this often (Google rotates keys
# rarely; this stops a flood of bogus kids from hammering Google).
JWKS_MIN_REFRESH_S = 60.0
# A failed fetch is retried at most this often, and while Google's JWKS is
# unreachable the last good keys keep serving for this long past their TTL
# (Google publishes each key well before use and keeps it for days after).
JWKS_RETRY_BACKOFF_S = 60.0
JWKS_STALE_GRACE_S = 24 * 3_600.0
JWKS_FETCH_TIMEOUT_S = 5.0
CLOCK_LEEWAY_S = 30


class GoogleJwks:
    """Google's OAuth2 signing keys (JWKS), RSA/RS256 only, cached."""

    def __init__(
        self,
        transport: httpx.AsyncBaseTransport | None = None,
        *,
        url: str = GOOGLE_JWKS_URL,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = httpx.AsyncClient(transport=transport, timeout=JWKS_FETCH_TIMEOUT_S)
        self._url = url
        self._clock = clock
        self._keys: dict[str, Any] = {}
        self._fetched_at: float | None = None
        self._failed_at: float | None = None
        self._lock = asyncio.Lock()

    async def _refresh(self) -> None:
        try:
            response = await self._client.get(self._url)
            data = response.json() if response.status_code == 200 else None
        except (httpx.HTTPError, ValueError):
            data = None
        listed = data.get("keys") if isinstance(data, dict) else None
        keys: dict[str, Any] = {}
        for jwk in listed if isinstance(listed, list) else []:
            if not isinstance(jwk, dict) or jwk.get("kty") != "RSA":
                continue
            if jwk.get("alg") not in (None, PUSH_ALGORITHM) or jwk.get("use") not in (None, "sig"):
                continue
            kid = jwk.get("kid")
            if not isinstance(kid, str) or not kid:
                continue
            try:
                keys[kid] = jwt.PyJWK(jwk, algorithm=PUSH_ALGORITHM).key
            except (jwt.PyJWKError, jwt.InvalidKeyError, ValueError, TypeError):
                continue
        if not keys:
            _log.warning(json.dumps({"event": "google_jwks_unavailable"}))
            raise PurchaseError(503, "store_unavailable")
        self._keys = keys
        self._fetched_at = self._clock()

    async def key(self, kid: str) -> Any | None:
        """The key for ``kid``, or None. 503 only when no usable keys exist at all.

        Refetches when the cache is past its TTL, or for an unknown ``kid``
        at most every ``JWKS_MIN_REFRESH_S``. A failed fetch is not retried
        for ``JWKS_RETRY_BACKOFF_S`` (so an outage does not make every
        request, junk tokens included, wait on Google under the lock), and
        the previous keys keep serving for ``JWKS_STALE_GRACE_S`` past the TTL.
        """
        async with self._lock:
            now = self._clock()
            age = None if self._fetched_at is None else now - self._fetched_at
            expired = age is None or age >= JWKS_TTL_S
            unknown_kid = age is not None and kid not in self._keys and age >= JWKS_MIN_REFRESH_S
            backing_off = (
                self._failed_at is not None and now - self._failed_at < JWKS_RETRY_BACKOFF_S
            )
            if (expired or unknown_kid) and not backing_off:
                try:
                    await self._refresh()
                    self._failed_at = None
                except PurchaseError:
                    self._failed_at = now
            usable = self._fetched_at is not None and (
                now - self._fetched_at < JWKS_TTL_S + JWKS_STALE_GRACE_S
            )
            if not usable:
                raise PurchaseError(503, "store_unavailable")
            return self._keys.get(kid)


class PushAuthenticator:
    """Verifies the OIDC token Pub/Sub attaches to each push (fails closed)."""

    def __init__(self, audience: str, service_account: str, jwks: GoogleJwks) -> None:
        self.audience = audience
        self.service_account = service_account.lower()
        self._jwks = jwks

    async def authenticate(self, authorization: str | None) -> dict[str, Any]:
        unauthorized = PurchaseError(401, "unauthorized")
        if not authorization or not authorization.startswith("Bearer "):
            raise unauthorized
        token = authorization[len("Bearer ") :].strip()
        if not token or len(token) > MAX_BEARER_CHARS:
            raise unauthorized
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError:
            raise unauthorized from None
        # Pin the algorithm before choosing a key: no "none", no HS256 with
        # the RSA public key as an HMAC secret, no ES/PS variants.
        if header.get("alg") != PUSH_ALGORITHM:
            raise unauthorized
        kid = header.get("kid")
        if not isinstance(kid, str) or not kid:
            raise unauthorized
        key = await self._jwks.key(kid)  # 503 when Google's JWKS is unreachable
        if key is None:
            raise unauthorized
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=[PUSH_ALGORITHM],
                audience=self.audience,
                issuer=GOOGLE_ISSUERS,
                leeway=CLOCK_LEEWAY_S,
                options={"require": ["exp", "iat", "iss", "aud"]},
            )
        except jwt.PyJWTError:
            raise unauthorized from None
        email = claims.get("email")
        if (
            not isinstance(email, str)
            or email.lower() != self.service_account
            or claims.get("email_verified") is not True
        ):
            raise PurchaseError(403, "forbidden")
        return claims


# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------


@dataclass
class GoogleRuntime:
    """Everything the Google routes and jobs need, built once from the environment."""

    config: GoogleConfig
    verifier: PlayVerifier
    push_auth: PushAuthenticator


def build_runtime(
    config: GoogleConfig,
    *,
    play_transport: httpx.AsyncBaseTransport | None = None,
    token_transport: httpx.BaseTransport | None = None,
    jwks_transport: httpx.AsyncBaseTransport | None = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> GoogleRuntime:
    verifier = build_verifier(
        config, play_transport=play_transport, token_transport=token_transport, sleep=sleep
    )
    auth = PushAuthenticator(
        config.rtdn_audience,
        config.rtdn_push_service_account,
        GoogleJwks(jwks_transport, clock=clock),
    )
    return GoogleRuntime(config=config, verifier=verifier, push_auth=auth)


def build_from_env() -> GoogleRuntime | None:
    """A :class:`GoogleRuntime` from the environment, or None (dormant)."""
    from .google_play import load_config

    config = load_config()
    if config is None:
        return None
    try:
        return build_runtime(config)
    except Exception:  # noqa: BLE001 — e.g. an unreadable private key: stay dormant, loudly
        misconfigured("init")
        return None


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


def _log_event(event: str, **fields: object) -> None:
    _log.info(json.dumps({"event": event, **fields}))


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


def _token(value: object) -> str | None:
    if isinstance(value, str) and 0 < len(value) <= MAX_PURCHASE_TOKEN_CHARS:
        return value
    return None


async def _read(verifier: PlayVerifier, token: str) -> VerifiedPurchase | None:
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
    token = _token(otp.get("purchaseToken"))
    if ntype not in (ONE_TIME_PRODUCT_PURCHASED, ONE_TIME_PRODUCT_CANCELED) or token is None:
        return "one_time", "ignored"
    kind = "purchased" if ntype == ONE_TIME_PRODUCT_PURCHASED else "canceled"
    verified = await _read(verifier, token)
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
    token = _token(voided.get("purchaseToken"))
    if (
        token is None
        or voided.get("productType") != PRODUCT_TYPE_ONE_TIME
        or voided.get("refundType") == REFUND_TYPE_QUANTITY_BASED_PARTIAL
    ):
        return "ignored"
    verified = await _read(verifier, token)
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
        _log_event("google_notification", kind="other_package", outcome="ignored", id=message_id)
        return "ignored"
    if isinstance(note.get("testNotification"), dict):
        _log_event("google_notification", kind="test", outcome="test", id=message_id)
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
    _log_event("google_notification", kind=kind, outcome=outcome, id=message_id)
    return outcome


# ---------------------------------------------------------------------------
# Voided-purchases poll
# ---------------------------------------------------------------------------

VOIDED_WINDOW = timedelta(hours=48)
VOIDED_MAX_PAGES = 50  # up to 1000 records a page; a bound, not an expectation
JOBS_INTERVAL_S = 24 * 60 * 60
JOBS_TIMEOUT_S = 300.0


@dataclass
class VoidedPollResult:
    fetched: int = 0
    applied: int = 0
    failed: int = 0
    api_failed: bool = False
    truncated: bool = False


def _voided_dedupe_key(token: str, voided_ms: object) -> str:
    # One key per voided purchase; the token itself never goes into the table.
    digest = hashlib.sha256(f"{token}:{voided_ms}".encode()).hexdigest()
    return f"google_voided:{digest}"


async def _apply_voided_record(
    verifier: PlayVerifier, record: dict[str, Any], session_factory: Callable[[], AsyncSession]
) -> bool:
    token = _token(record.get("purchaseToken"))
    if token is None or is_partial_refund(record):
        return False
    voided_at = parse_millis(record.get("voidedTimeMillis"))
    dedupe_key = _voided_dedupe_key(token, record.get("voidedTimeMillis"))
    reason = voided_reason(record.get("voidedReason"))
    async with session_factory() as db:
        if await service.purchase_exists(db, "google", token):
            return await service.apply_store_state(
                db,
                platform="google",
                store_key=token,
                state="revoked",
                reason=reason,
                dedupe_key=dedupe_key,
                event_at=voided_at,
            )
    # Never posted by a client: record it revoked (unlinked), so a later post
    # of this token cannot grant even if the purchase read still lags the void.
    verified = await _read(verifier, token)
    if verified is None:
        return False
    revoked = replace(
        verified, state="revoked", revoked_at=voided_at, revocation_reason=reason, event_at=None
    )
    async with session_factory() as db:
        return await service.record_store_purchase(
            db, revoked, dedupe_key=dedupe_key, event_at=voided_at
        )


async def poll_voided_purchases(
    verifier: PlayVerifier | None,
    session_factory: Callable[[], AsyncSession],
    *,
    window: timedelta = VOIDED_WINDOW,
    now: datetime | None = None,
    max_pages: int = VOIDED_MAX_PAGES,
) -> VoidedPollResult | None:
    """Revoke every purchase ``voidedpurchases.list`` reports for the last ``window``.

    None (nothing done) while Google is not configured. Follows token
    pagination up to ``max_pages``; hitting the cap logs
    ``google_voided_page_limit`` and the rest waits for the next run. An API
    error ends the run (the next one retries). Idempotent: one dedupe key per
    voided purchase, and a revoke of a revoked purchase changes nothing.
    """
    if verifier is None:
        return None
    end = now or datetime.now(UTC)
    # The API refuses a startTime older than 30 days.
    start = max(end - window, end - timedelta(days=30) + timedelta(minutes=5))
    result = VoidedPollResult()
    page_token: str | None = None
    for page_no in range(max_pages):
        try:
            page = await verifier.api.list_voided(
                start_ms=int(start.timestamp() * 1000),
                end_ms=int(end.timestamp() * 1000),
                page_token=page_token,
            )
        except PurchaseError:
            result.api_failed = True
            _log.warning(json.dumps({"event": "google_voided_api_failed"}))
            break
        for record in page.get("voidedPurchases") or []:
            if not isinstance(record, dict):
                continue
            result.fetched += 1
            try:
                if await _apply_voided_record(verifier, record, session_factory):
                    result.applied += 1
            except PurchaseError:
                result.failed += 1
        page_token = (page.get("tokenPagination") or {}).get("nextPageToken")
        if not page_token:
            break
        if page_no == max_pages - 1:
            result.truncated = True
            _log.warning(json.dumps({"event": "google_voided_page_limit", "pages": max_pages}))
    _log_event(
        "google_voided_poll_done",
        fetched=result.fetched,
        applied=result.applied,
        failed=result.failed,
        api_failed=result.api_failed,
        truncated=result.truncated,
    )
    return result


# ---------------------------------------------------------------------------
# Acknowledgement sweep
# ---------------------------------------------------------------------------

# Google refunds an unacknowledged purchase after 3 days; a day of slack so a
# purchase near the edge still gets its try. Older rows are left alone.
ACK_SWEEP_MAX_AGE = timedelta(days=4)
ACK_SWEEP_LIMIT = 500


@dataclass
class AckSweepResult:
    candidates: int = 0
    acknowledged: int = 0
    failed: int = 0


async def acknowledge_sweep(
    verifier: PlayVerifier | None,
    session_factory: Callable[[], AsyncSession],
    *,
    now: datetime | None = None,
    max_age: timedelta = ACK_SWEEP_MAX_AGE,
    limit: int = ACK_SWEEP_LIMIT,
) -> AckSweepResult | None:
    """Acknowledge ``owned`` Google purchases whose ``acknowledged_at`` is still null.

    Covers a failed in-request acknowledgement, a refused link (403/409), and
    an RTDN whose acknowledgement failed. Only purchases completed (or first
    recorded) within ``max_age``. Idempotent: an already-acknowledged purchase
    counts as success. None while Google is not configured.
    """
    if verifier is None:
        return None
    cutoff = (now or datetime.now(UTC)) - max_age
    # When the 3-day clock started: completion, else when we first recorded it.
    started = func.coalesce(Purchase.purchased_at, Purchase.created_at)
    async with session_factory() as db:
        due = (
            await db.execute(
                select(Purchase.id, Purchase.product_id, Purchase.store_key)
                .where(
                    Purchase.platform == "google",
                    Purchase.state == "owned",
                    Purchase.acknowledged_at.is_(None),
                    started >= cutoff,
                )
                .order_by(started)
                .limit(limit)
            )
        ).all()
    result = AckSweepResult(candidates=len(due))
    for row in due:
        evidence = GoogleEvidence(product_id=row.product_id, purchase_token=row.store_key)
        try:
            await verifier.acknowledge(evidence)
        except PurchaseError:
            result.failed += 1
            continue
        async with session_factory() as db:
            await service.mark_acknowledged(db, row.id)
        result.acknowledged += 1
    _log_event(
        "google_ack_sweep_done",
        candidates=result.candidates,
        acknowledged=result.acknowledged,
        failed=result.failed,
    )
    return result


# ---------------------------------------------------------------------------
# Daily jobs
# ---------------------------------------------------------------------------


async def run_google_jobs(
    verifier: PlayVerifier | None,
    session_factory: Callable[[], AsyncSession],
    *,
    now: datetime | None = None,
    window: timedelta = VOIDED_WINDOW,
) -> tuple[VoidedPollResult, AckSweepResult] | None:
    """The voided poll, then the acknowledgement sweep. None while Google is not configured."""
    if verifier is None:
        return None
    voided = await poll_voided_purchases(verifier, session_factory, window=window, now=now)
    swept = await acknowledge_sweep(verifier, session_factory, now=now)
    return voided, swept  # type: ignore[return-value]


async def run_google_jobs_loop(
    get_verifier: Callable[[], PlayVerifier | None],
    get_session_factory: Callable[[], async_sessionmaker[AsyncSession]],
    *,
    interval_s: float = JOBS_INTERVAL_S,
    timeout_s: float = JOBS_TIMEOUT_S,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> None:
    """Run the Google jobs now, then every ``interval_s``, until cancelled (``main.lifespan``).

    A failure is reported and retried next cycle, never raised. ``sleep`` and
    ``clock`` are injectable so tests drive cycles without real time.
    """
    while True:
        try:
            await asyncio.wait_for(
                run_google_jobs(get_verifier(), get_session_factory(), now=clock()),
                timeout=timeout_s,
            )
        except Exception as exc:  # noqa: BLE001 — any failure waits for the next cycle
            _log.warning(json.dumps({"event": "google_jobs_failed"}))
            with sentry_sdk.new_scope() as scope:
                scope.set_tag("subsystem", "purchases.google_jobs")
                scope.fingerprint = ["google-play-jobs-failed"]
                sentry_sdk.capture_exception(exc)
        await sleep(interval_s)

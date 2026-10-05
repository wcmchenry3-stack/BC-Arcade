"""Real Google Play verification for ``POST /purchases/google`` (#2787, docs/IAP.md §7.6).

Built on the Google Play Developer API (Android Publisher v3), called over
``httpx`` with a service-account access token minted by ``google-auth``:

* :class:`PlayApi` — the three calls we use: ``purchases.productsv2.getproductpurchasev2``
  (read a one-time purchase by its token), ``purchases.products.acknowledge``
  and ``purchases.voidedpurchases.list``. Store errors map to the contract
  codes of IAP.md §8.2.
* :class:`PlayVerifier` implements :class:`~purchases.verifiers.GoogleVerifier`:
  it reads the purchase from Play (never trusting the client beyond the token
  and the product it names), checks it, and normalizes it. It also
  acknowledges, with retries, idempotently.
* :func:`load_config` reads the environment. Without
  ``GOOGLE_PLAY_PACKAGE_NAME`` it returns None and every Google route keeps
  answering ``503 store_unavailable`` — the dormant default. With the package
  name set, anything missing or broken also stays dormant **and is
  reported** (reason code only; never a value).

The package name is bound into every request path, so Play answers only for
purchases of our app: a token from another app is ``404`` → ``422
verification_failed``. Nothing here logs a token, an order id or a key.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

import anyio
import google.auth.exceptions
import google.auth.transport
import httpx
import sentry_sdk
from google.oauth2 import service_account

from .verifiers import (
    Environment,
    GoogleEvidence,
    PurchaseError,
    PurchaseState,
    VerifiedPurchase,
    allowed_environments,
)

_log = logging.getLogger("audit")

ANDROIDPUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher"
API_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
# The only token endpoints google-auth may send the signed assertion to.
ALLOWED_TOKEN_URIS = frozenset(
    {"https://oauth2.googleapis.com/token", "https://accounts.google.com/o/oauth2/token"}
)
_GOOGLE_ENVIRONMENTS: frozenset[str] = frozenset({"production", "test"})
# Android applicationId rules: dot-separated segments, each starting with a letter.
_PACKAGE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# obfuscatedExternalAccountId as our client sets it: hex(SHA-256(X-Session-ID)) (IAP.md §4).
ACCOUNT_TOKEN_RE = re.compile(r"\A[0-9a-fA-F]{64}\Z")

HTTP_TIMEOUT_S = 15.0
# Acknowledgement retries inside one call (IAP.md §7.3): 3 attempts in all.
ACK_BACKOFF_S: tuple[float, ...] = (0.5, 2.0)

# A pending purchase carries no store time of its own. It is the weakest state
# (never granted; ``owned`` never regresses to it), so it gets the earliest
# possible event time: it can never be ordered after a real store event, and
# a completion read later always applies (no clock-skew race with our own
# request time). See "Event ordering" in IAP.md §7.6.
PENDING_EVENT_AT = datetime(1970, 1, 1, tzinfo=UTC)

# ProductPurchaseV2 enum values (Android Publisher v3 discovery document).
PURCHASED = "PURCHASED"
PENDING = "PENDING"
CANCELLED = "CANCELLED"
ACKNOWLEDGED = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"
CONSUMED = "CONSUMPTION_STATE_CONSUMED"


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GoogleConfig:
    package_name: str
    environments: frozenset[Environment]
    # The parsed service-account key. Never in a repr or a log.
    service_account_info: dict[str, Any] = field(repr=False)
    rtdn_audience: str
    rtdn_push_service_account: str


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def misconfigured(reason: str) -> None:
    """Report why Google verification stays dormant: the reason code only.

    Never an exception text or a variable's value (the service-account key).
    Goes to the audit log and, as a message, to Sentry, so a set-but-broken
    configuration is not silent (same rule as Apple, IAP.md §6.6).
    """
    _log.warning(json.dumps({"event": "google_play_misconfigured", "reason": reason}))
    sentry_sdk.capture_message(f"google_play_misconfigured: {reason}", level="warning")


def _parse_service_account(raw: str) -> dict[str, Any] | None:
    try:
        info = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(info, dict) or info.get("type") != "service_account":
        return None
    for key in ("client_email", "private_key"):
        if not isinstance(info.get(key), str) or not info[key]:
            return None
    if info.get("token_uri") not in ALLOWED_TOKEN_URIS:
        return None
    return info


def load_config() -> GoogleConfig | None:
    """The Google settings from the environment, or None when verification must stay dormant.

    Required: ``GOOGLE_PLAY_PACKAGE_NAME``, ``GOOGLE_PLAY_SERVICE_ACCOUNT_JSON``
    (the key file's JSON), ``GOOGLE_RTDN_AUDIENCE`` and ``GOOGLE_RTDN_PUSH_SA``
    (the Pub/Sub push subscription's OIDC audience and service-account email).
    Optional: ``GOOGLE_PLAY_ENVIRONMENTS`` (default ``production,test``).
    Unset package name → quietly dormant. Package name set but anything else
    missing or invalid → dormant and reported.
    """
    package = _env("GOOGLE_PLAY_PACKAGE_NAME")
    if not package:
        return None
    if not _PACKAGE_RE.match(package):
        misconfigured("package_name")
        return None
    envs = frozenset(e for e in allowed_environments("google") if e in _GOOGLE_ENVIRONMENTS)
    if not envs:
        misconfigured("environments")
        return None
    raw_key = _env("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON")
    if not raw_key:
        misconfigured("service_account_missing")
        return None
    info = _parse_service_account(raw_key)
    if info is None:
        misconfigured("service_account")
        return None
    audience = _env("GOOGLE_RTDN_AUDIENCE")
    push_sa = _env("GOOGLE_RTDN_PUSH_SA")
    if not audience:
        misconfigured("rtdn_audience")
        return None
    if not _EMAIL_RE.match(push_sa):
        misconfigured("rtdn_push_sa")
        return None
    return GoogleConfig(
        package_name=package,
        environments=envs,  # type: ignore[arg-type]
        service_account_info=info,
        rtdn_audience=audience,
        rtdn_push_service_account=push_sa.lower(),
    )


# ---------------------------------------------------------------------------
# Service-account access tokens (google-auth over httpx)
# ---------------------------------------------------------------------------


class _AuthResponse(google.auth.transport.Response):
    def __init__(self, response: httpx.Response) -> None:
        self._response = response

    @property
    def status(self) -> int:
        return self._response.status_code

    @property
    def headers(self):  # type: ignore[override]
        return self._response.headers

    @property
    def data(self) -> bytes:
        return self._response.content


class HttpxAuthRequest(google.auth.transport.Request):
    """google-auth's transport interface over a (sync) ``httpx.Client``.

    Lets google-auth mint tokens without ``requests`` sessions of its own and
    lets tests replace the network with an ``httpx.MockTransport``.
    """

    def __init__(self, client: httpx.Client) -> None:
        self._client = client

    def __call__(  # type: ignore[override]
        self, url, method="GET", body=None, headers=None, timeout=None, **kwargs
    ) -> _AuthResponse:
        try:
            response = self._client.request(
                method, url, content=body, headers=headers, timeout=timeout or HTTP_TIMEOUT_S
            )
        except httpx.HTTPError as exc:
            raise google.auth.exceptions.TransportError("token request failed") from exc
        return _AuthResponse(response)


class ServiceAccountTokens:
    """OAuth access tokens for the Play Developer API (scope ``androidpublisher`` only).

    google-auth signs the JWT assertion with the service-account key and
    exchanges it at Google's token endpoint; the token is cached until shortly
    before it expires. The refresh is blocking, so it runs in a worker thread.
    """

    def __init__(self, info: dict[str, Any], transport: httpx.BaseTransport | None = None) -> None:
        self._credentials = service_account.Credentials.from_service_account_info(
            info, scopes=[ANDROIDPUBLISHER_SCOPE]
        )
        self._request = HttpxAuthRequest(httpx.Client(transport=transport))
        self._lock = asyncio.Lock()

    async def token(self) -> str:
        async with self._lock:
            if not self._credentials.valid:
                try:
                    await anyio.to_thread.run_sync(self._credentials.refresh, self._request)
                except google.auth.exceptions.GoogleAuthError:
                    _log.warning(json.dumps({"event": "google_play_token_failed"}))
                    raise PurchaseError(503, "store_unavailable") from None
            return str(self._credentials.token)


# ---------------------------------------------------------------------------
# Play Developer API
# ---------------------------------------------------------------------------


class AckRejected(Exception):
    """Play refused an acknowledgement with a 4xx (already acknowledged, not owned, ...)."""


class PlayApi:
    """The Android Publisher v3 calls we use, for one package."""

    def __init__(
        self,
        package_name: str,
        tokens: Any,  # ServiceAccountTokens, or a fake with ``async token()``
        transport: httpx.AsyncBaseTransport | None = None,
        base_url: str = API_BASE,
    ) -> None:
        self.package_name = package_name
        self._tokens = tokens
        self._base = f"{base_url}/{quote(package_name, safe='')}/purchases"
        self._client = httpx.AsyncClient(transport=transport, timeout=HTTP_TIMEOUT_S)

    async def _call(
        self, method: str, url: str, *, params: dict | None = None, json_body: dict | None = None
    ) -> httpx.Response:
        token = await self._tokens.token()
        try:
            return await self._client.request(
                method,
                url,
                params=params,
                json=json_body,
                headers={"Authorization": f"Bearer {token}"},
            )
        except httpx.HTTPError:
            raise PurchaseError(503, "store_unavailable") from None

    @staticmethod
    def _unavailable(response: httpx.Response, call: str) -> PurchaseError:
        if response.status_code in (401, 403):
            # Our credentials or Play Console permissions, not the purchase.
            _log.warning(
                json.dumps(
                    {
                        "event": "google_play_auth_failed",
                        "call": call,
                        "status": response.status_code,
                    }
                )
            )
        return PurchaseError(503, "store_unavailable")

    @staticmethod
    def _json(response: httpx.Response) -> dict[str, Any]:
        try:
            data = response.json()
        except ValueError:
            raise PurchaseError(503, "store_unavailable") from None
        if not isinstance(data, dict):
            raise PurchaseError(503, "store_unavailable")
        return data

    async def get_purchase(self, purchase_token: str) -> dict[str, Any]:
        """``purchases.productsv2.getproductpurchasev2`` — a ProductPurchaseV2 resource."""
        url = f"{self._base}/productsv2/tokens/{quote(purchase_token, safe='')}"
        response = await self._call("GET", url)
        if response.status_code == 200:
            return self._json(response)
        if response.status_code in (400, 404, 410):
            # Unknown, malformed or expired token, or one from another app.
            raise PurchaseError(422, "verification_failed")
        raise self._unavailable(response, "get")

    async def acknowledge(self, product_id: str, purchase_token: str) -> None:
        """``purchases.products.acknowledge``. Raises :class:`AckRejected` on a 4xx refusal."""
        url = (
            f"{self._base}/products/{quote(product_id, safe='')}"
            f"/tokens/{quote(purchase_token, safe='')}:acknowledge"
        )
        response = await self._call("POST", url, json_body={})
        if 200 <= response.status_code < 300:
            return
        if response.status_code in (400, 404, 409, 410):
            raise AckRejected
        raise self._unavailable(response, "acknowledge")

    async def list_voided(
        self, *, start_ms: int, end_ms: int | None = None, page_token: str | None = None
    ) -> dict[str, Any]:
        """``purchases.voidedpurchases.list`` (one-time products only, the default ``type=0``)."""
        params: dict[str, Any] = {"startTime": str(start_ms)}
        if end_ms is not None:
            params["endTime"] = str(end_ms)
        if page_token:
            params["token"] = page_token
        response = await self._call("GET", f"{self._base}/voidedpurchases", params=params)
        if response.status_code == 200:
            return self._json(response)
        raise self._unavailable(response, "voided")


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------


def parse_rfc3339(value: object) -> datetime | None:
    """A Play timestamp (``2026-09-30T12:00:00.123Z``) as aware UTC, or None."""
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(
            value.replace("Z", "+00:00")  # noqa: FURB162  # explicit Z, no behaviour change
        )
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(UTC)


def parse_millis(value: object) -> datetime | None:
    """Epoch milliseconds (Play sends them as strings) as aware UTC, or None."""
    if isinstance(value, bool) or not isinstance(value, str | int):
        return None
    try:
        ms = int(value)
    except ValueError:
        return None
    if ms <= 0:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000, tz=UTC)
    except (OverflowError, OSError, ValueError):
        return None


def to_verified(
    purchase_token: str,
    data: dict[str, Any],
    *,
    environments: frozenset[str],
    expected_product_id: str | None = None,
) -> VerifiedPurchase:
    """Check a ProductPurchaseV2 and normalize it (IAP.md §7.6 table). Raises PurchaseError.

    * exactly one line item, whose ``productId`` follows the catalog convention
      (``unknown_product`` otherwise; the service then requires ``is_premium``)
      and, for a client post, equals the product the client named;
    * not a rental (``unknown_product``: not lasting access), quantity 1;
    * **never consumed** (``verification_failed``);
    * ``purchaseState``: PURCHASED → owned, PENDING → pending, CANCELLED →
      revoked when the purchase had completed (a refund or chargeback) or
      cancelled when it never did (a declined pending payment);
    * ``testPurchaseContext`` present → ``test`` (licence tester), else
      ``production``; outside ``environments`` → ``environment_not_allowed``.
    """
    from .service import slug_for_product  # service imports google → this module

    items = data.get("productLineItem")
    if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict):
        raise PurchaseError(422, "verification_failed")
    item = items[0]
    product_id = item.get("productId")
    if not isinstance(product_id, str) or slug_for_product(product_id) is None:
        raise PurchaseError(422, "unknown_product")
    if expected_product_id is not None and product_id != expected_product_id:
        raise PurchaseError(422, "verification_failed")
    offer = item.get("productOfferDetails") or {}
    if not isinstance(offer, dict):
        raise PurchaseError(422, "verification_failed")
    if offer.get("rentOfferDetails") is not None:
        raise PurchaseError(422, "unknown_product")
    quantity = offer.get("quantity", 1)
    if quantity not in (None, 1):
        raise PurchaseError(422, "verification_failed")
    if offer.get("consumptionState") == CONSUMED:
        # A consumed purchase is not owned any more; we never consume (§3).
        raise PurchaseError(422, "verification_failed")

    raw_state = (data.get("purchaseStateContext") or {}).get("purchaseState")
    completed_at = parse_rfc3339(data.get("purchaseCompletionTime"))
    state: PurchaseState
    event_at: datetime | None
    if raw_state == PURCHASED:
        # No completion time (never expected): the weakest time, so it can never
        # out-order a real store event (a void) — see "Event ordering".
        state, event_at = "owned", completed_at or PENDING_EVENT_AT
    elif raw_state == PENDING:
        state, event_at = "pending", PENDING_EVENT_AT
    elif raw_state == CANCELLED:
        # No void time here: the caller's request time orders it (a cancellation
        # is final for a token, so "now" is safe and never hides a real event).
        state, event_at = ("revoked" if completed_at else "cancelled"), None
    else:
        raise PurchaseError(422, "verification_failed")

    environment: Environment = (
        "test" if data.get("testPurchaseContext") is not None else "production"
    )
    if environment not in environments:
        raise PurchaseError(422, "environment_not_allowed")
    account = data.get("obfuscatedExternalAccountId")
    order_id = data.get("orderId")
    return VerifiedPurchase(
        platform="google",
        product_id=product_id,
        store_key=purchase_token,
        transaction_id=order_id if isinstance(order_id, str) and order_id else None,
        environment=environment,
        ownership_type="purchased",  # Play Family Library does not share in-app products
        state=state,
        purchased_at=completed_at,
        # Our client sends hex(SHA-256(session)); anything else is treated as
        # absent (so a source=purchase post is 403 ownership_mismatch, never a 500).
        account_token=(
            account if isinstance(account, str) and ACCOUNT_TOKEN_RE.match(account) else None
        ),
        revocation_reason="voided" if state == "revoked" else None,
        acknowledged=data.get("acknowledgementState") == ACKNOWLEDGED,
        event_at=event_at,
    )


# ---------------------------------------------------------------------------
# Verifier
# ---------------------------------------------------------------------------


class PlayVerifier:
    """The real :class:`~purchases.verifiers.GoogleVerifier` (IAP.md §7.6)."""

    def __init__(
        self,
        config: GoogleConfig,
        api: PlayApi,
        *,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        ack_backoff: tuple[float, ...] = ACK_BACKOFF_S,
    ) -> None:
        self.config = config
        self.api = api
        self._sleep = sleep
        self._ack_backoff = ack_backoff

    async def read(
        self, purchase_token: str, expected_product_id: str | None = None
    ) -> VerifiedPurchase:
        """Fetch the purchase from Play and normalize it (client posts, RTDN, sweeps)."""
        data = await self.api.get_purchase(purchase_token)
        return to_verified(
            purchase_token,
            data,
            environments=self.config.environments,
            expected_product_id=expected_product_id,
        )

    async def verify(self, evidence: GoogleEvidence) -> VerifiedPurchase:
        from .service import slug_for_product

        # Catalog convention before any store call; the service re-checks is_premium.
        if slug_for_product(evidence.product_id) is None:
            raise PurchaseError(422, "unknown_product")
        return await self.read(evidence.purchase_token, evidence.product_id)

    async def acknowledge(self, evidence: GoogleEvidence) -> None:
        """``purchases.products.acknowledge``, retried, idempotent.

        Transient failures (network, 429, 5xx) are retried with backoff. A 4xx
        refusal re-reads the purchase: already acknowledged counts as success
        (so repeating is safe); anything else is ``422 verification_failed``.
        Never consumes.
        """
        attempts = len(self._ack_backoff) + 1
        for attempt in range(attempts):
            try:
                await self.api.acknowledge(evidence.product_id, evidence.purchase_token)
                return
            except AckRejected:
                data = await self.api.get_purchase(evidence.purchase_token)
                if data.get("acknowledgementState") == ACKNOWLEDGED:
                    return
                raise PurchaseError(422, "verification_failed") from None
            except PurchaseError:
                if attempt == attempts - 1:
                    raise
                await self._sleep(self._ack_backoff[attempt])


def build_verifier(
    config: GoogleConfig,
    *,
    play_transport: httpx.AsyncBaseTransport | None = None,
    token_transport: httpx.BaseTransport | None = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> PlayVerifier:
    tokens = ServiceAccountTokens(config.service_account_info, transport=token_transport)
    api = PlayApi(config.package_name, tokens, transport=play_transport)
    return PlayVerifier(config, api, sleep=sleep)

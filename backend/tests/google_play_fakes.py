"""Test doubles for Google Play (#2787): a fake Play Developer API, token endpoint and OIDC signer.

Everything is mocked at the HTTP transport layer (``httpx.MockTransport``), so
the real ``google-auth`` token exchange, the real Play client and the real
OIDC verification all run. Every key is a throwaway RSA key generated at
runtime; nothing here is a real credential.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from functools import cache
from typing import Any
from urllib.parse import unquote

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from purchases.google_play import GoogleConfig

PACKAGE = "com.buffingchi.games"
HEARTS = "com.buffingchi.games.premium.hearts"
CASCADE = "com.buffingchi.games.premium.cascade"
AUDIENCE = "https://games-api.example.test/purchases/google/notifications"
PUSH_SA = "rtdn-push@bc-arcade-test.iam.gserviceaccount.com"
PLAY_SA = "play-api@bc-arcade-test.iam.gserviceaccount.com"
ACCESS_TOKEN = "ya29.fake-access-token"
KID = "test-kid-1"


# ---------------------------------------------------------------------------
# Keys
# ---------------------------------------------------------------------------


@cache
def rsa_key(name: str) -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def private_pem(name: str) -> str:
    return (
        rsa_key(name)
        .private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        .decode()
    )


def public_pem(name: str) -> bytes:
    return (
        rsa_key(name)
        .public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    )


def service_account_info(**overrides: Any) -> dict[str, Any]:
    info = {
        "type": "service_account",
        "project_id": "bc-arcade-test",
        "private_key_id": "0123456789abcdef",
        "private_key": private_pem("service-account"),
        "client_email": PLAY_SA,
        "token_uri": "https://oauth2.googleapis.com/token",
    }
    info.update(overrides)
    return info


def make_config(envs: frozenset[str] = frozenset({"production", "test"})) -> GoogleConfig:
    return GoogleConfig(
        package_name=PACKAGE,
        environments=envs,  # type: ignore[arg-type]
        service_account_info=service_account_info(),
        rtdn_audience=AUDIENCE,
        rtdn_push_service_account=PUSH_SA,
    )


# ---------------------------------------------------------------------------
# Token endpoint (sync transport; google-auth refreshes in a worker thread)
# ---------------------------------------------------------------------------


@dataclass
class FakeTokenEndpoint:
    calls: int = 0
    fail: bool = False
    assertions: list[dict] = field(default_factory=list)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        if self.fail:
            return httpx.Response(500, json={"error": "backend_error"})
        form = dict(pair.split("=", 1) for pair in request.content.decode().split("&"))
        assertion = unquote(form["assertion"])
        # The assertion must be signed with the service-account key, for our scope only.
        claims = jwt.decode(
            assertion,
            public_pem("service-account"),
            algorithms=["RS256"],
            audience="https://oauth2.googleapis.com/token",
        )
        self.assertions.append(claims)
        return httpx.Response(
            200, json={"access_token": ACCESS_TOKEN, "expires_in": 3600, "token_type": "Bearer"}
        )

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)


# ---------------------------------------------------------------------------
# Play Developer API
# ---------------------------------------------------------------------------


def rfc3339(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def ms(dt: datetime) -> str:
    return str(int(dt.timestamp() * 1000))


def play_purchase(
    product: str = HEARTS,
    state: str = "PURCHASED",
    *,
    account: str | None = None,
    acknowledged: bool = False,
    consumed: bool = False,
    test: bool = False,
    completed: datetime | None = None,
    never_completed: bool = False,
    order: str | None = "GPA.1234-5678-9012-34567",
    quantity: int | None = 1,
    rent: bool = False,
    items: list | None = None,
) -> dict[str, Any]:
    """A ProductPurchaseV2 resource as the Play Developer API returns it."""
    offer: dict[str, Any] = {
        "consumptionState": (
            "CONSUMPTION_STATE_CONSUMED" if consumed else "CONSUMPTION_STATE_YET_TO_BE_CONSUMED"
        ),
        "purchaseOptionId": "buy",
        "refundableQuantity": 1,
    }
    if quantity is not None:
        offer["quantity"] = quantity
    if rent:
        offer["rentOfferDetails"] = {}
    data: dict[str, Any] = {
        "kind": "androidpublisher#productPurchaseV2",
        "productLineItem": (
            items if items is not None else [{"productId": product, "productOfferDetails": offer}]
        ),
        "purchaseStateContext": {"purchaseState": state},
        "acknowledgementState": (
            "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"
            if acknowledged
            else "ACKNOWLEDGEMENT_STATE_PENDING"
        ),
        "regionCode": "US",
    }
    if order:
        data["orderId"] = order
    if account:
        data["obfuscatedExternalAccountId"] = account
    if test:
        data["testPurchaseContext"] = {"fopType": "TEST"}
    if state in ("PURCHASED", "CANCELLED") and not never_completed:
        data["purchaseCompletionTime"] = rfc3339(
            completed or datetime.now(UTC) - timedelta(minutes=5)
        )
    return data


@dataclass
class FakePlay:
    """The Android Publisher calls we use, answering from test data."""

    purchases: dict[str, dict] = field(default_factory=dict)  # token -> ProductPurchaseV2
    voided_pages: list[dict] = field(default_factory=list)
    # Queued HTTP statuses (or "network") for the next calls of each kind.
    get_errors: list[Any] = field(default_factory=list)
    ack_errors: list[Any] = field(default_factory=list)
    voided_errors: list[Any] = field(default_factory=list)
    get_calls: list[str] = field(default_factory=list)
    ack_calls: list[tuple[str, str]] = field(default_factory=list)
    voided_calls: list[dict] = field(default_factory=list)
    auth_headers: set[str] = field(default_factory=set)

    PREFIX = f"/androidpublisher/v3/applications/{PACKAGE}/purchases/"

    @staticmethod
    def _error(item: Any, request: httpx.Request) -> httpx.Response:
        if item == "network":
            raise httpx.ConnectError("boom", request=request)
        if item == "not-json":
            return httpx.Response(200, content=b"<html>")
        if item == "not-object":
            return httpx.Response(200, json=["x"])
        return httpx.Response(int(item), json={"error": {"code": int(item)}})

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.auth_headers.add(request.headers.get("authorization", ""))
        assert request.url.host == "androidpublisher.googleapis.com"
        path = request.url.raw_path.decode().split("?")[0]
        if not path.startswith(self.PREFIX):
            # Another package: Play answers 404 for tokens that are not this app's.
            return httpx.Response(404, json={"error": {"code": 404}})
        rest = path[len(self.PREFIX) :]
        if request.method == "GET" and rest.startswith("productsv2/tokens/"):
            token = unquote(rest[len("productsv2/tokens/") :])
            self.get_calls.append(token)
            if self.get_errors:
                return self._error(self.get_errors.pop(0), request)
            if token not in self.purchases:
                return httpx.Response(404, json={"error": {"code": 404}})
            return httpx.Response(200, json=self.purchases[token])
        if (
            request.method == "POST"
            and rest.startswith("products/")
            and rest.endswith(":acknowledge")
        ):
            product, _, token = rest[len("products/") : -len(":acknowledge")].partition("/tokens/")
            product, token = unquote(product), unquote(token)
            self.ack_calls.append((product, token))
            if self.ack_errors:
                return self._error(self.ack_errors.pop(0), request)
            data = self.purchases.get(token)
            if data is None or data["purchaseStateContext"]["purchaseState"] != "PURCHASED":
                return httpx.Response(400, json={"error": {"code": 400}})
            if data["acknowledgementState"] == "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED":
                return httpx.Response(400, json={"error": {"code": 400}})
            data["acknowledgementState"] = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"
            return httpx.Response(204)
        if request.method == "GET" and rest == "voidedpurchases":
            params = dict(request.url.params)
            self.voided_calls.append(params)
            if self.voided_errors:
                return self._error(self.voided_errors.pop(0), request)
            index = int(params.get("token") or 0)
            return httpx.Response(200, json=self.voided_pages[index] if self.voided_pages else {})
        return httpx.Response(404)

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)


def voided_page(records: list[dict], next_token: str | None = None) -> dict:
    page: dict[str, Any] = {"voidedPurchases": records}
    if next_token:
        page["tokenPagination"] = {"nextPageToken": next_token}
    return page


def voided_record(token: str, voided_at: datetime, reason: int = 1) -> dict:
    return {
        "kind": "androidpublisher#voidedPurchase",
        "purchaseToken": token,
        "orderId": "GPA.0000",
        "purchaseTimeMillis": ms(voided_at - timedelta(days=1)),
        "voidedTimeMillis": ms(voided_at),
        "voidedSource": 0,
        "voidedReason": reason,
    }


# ---------------------------------------------------------------------------
# OIDC (Pub/Sub push) signer and JWKS
# ---------------------------------------------------------------------------


def jwk_for(name: str, kid: str = KID) -> dict:
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(rsa_key(name).public_key()))
    jwk.update({"kid": kid, "alg": "RS256", "use": "sig"})
    return jwk


@dataclass
class FakeJwks:
    keys: list[dict] = field(default_factory=lambda: [jwk_for("google-oidc")])
    calls: int = 0
    fail: bool = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        assert str(request.url) == "https://www.googleapis.com/oauth2/v3/certs"
        if self.fail:
            return httpx.Response(503)
        return httpx.Response(200, json={"keys": self.keys})

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)


def oidc_claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    claims = {
        "iss": "https://accounts.google.com",
        "aud": AUDIENCE,
        "azp": "1234567890",
        "sub": "1234567890",
        "email": PUSH_SA,
        "email_verified": True,
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    return {k: v for k, v in claims.items() if v is not None}


def oidc_token(key_name: str = "google-oidc", kid: str = KID, **claims: Any) -> str:
    return jwt.encode(
        oidc_claims(**claims), private_pem(key_name), algorithm="RS256", headers={"kid": kid}
    )


def _seg(obj: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")


def alg_none_token(**claims: Any) -> str:
    return f"{_seg({'alg': 'none', 'typ': 'JWT', 'kid': KID})}.{_seg(oidc_claims(**claims))}."


def hs256_with_public_key_token(**claims: Any) -> str:
    """The classic alg-confusion forgery: HMAC-SHA256 keyed with the RSA public key PEM."""
    signing_input = (
        f"{_seg({'alg': 'HS256', 'typ': 'JWT', 'kid': KID})}.{_seg(oidc_claims(**claims))}"
    )
    sig = hmac.new(public_pem("google-oidc"), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{base64.urlsafe_b64encode(sig).decode().rstrip('=')}"


# ---------------------------------------------------------------------------
# RTDN
# ---------------------------------------------------------------------------


def developer_notification(
    *,
    one_time: tuple[int, str] | None = None,
    voided: dict | None = None,
    test: bool = False,
    subscription: bool = False,
    package: str = PACKAGE,
    event_at: datetime | None = None,
) -> dict[str, Any]:
    note: dict[str, Any] = {
        "version": "1.0",
        "packageName": package,
        "eventTimeMillis": ms(event_at or datetime.now(UTC)),
    }
    if one_time is not None:
        ntype, token = one_time
        note["oneTimeProductNotification"] = {
            "version": "1.0",
            "notificationType": ntype,
            "purchaseToken": token,
            "sku": HEARTS,
        }
    if voided is not None:
        note["voidedPurchaseNotification"] = voided
    if test:
        note["testNotification"] = {"version": "1.0"}
    if subscription:
        note["subscriptionNotification"] = {
            "version": "1.0",
            "notificationType": 4,
            "purchaseToken": "sub-token",
            "subscriptionId": "monthly",
        }
    return note


def push_body(note: dict, message_id: str | None = None) -> dict[str, Any]:
    return {
        "message": {
            "data": base64.b64encode(json.dumps(note).encode()).decode(),
            "messageId": message_id or str(uuid.uuid4().int)[:16],
            "publishTime": "2026-09-30T12:00:00.000Z",
            "attributes": {},
        },
        "subscription": "projects/bc-arcade-test/subscriptions/play-rtdn-push",
    }

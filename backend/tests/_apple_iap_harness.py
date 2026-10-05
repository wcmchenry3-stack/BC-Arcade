"""Shared harness for the Apple IAP tests (#2786, split in #2955).

Every JWS here is signed by a throwaway test CA (``tests/apple_jws.py``) whose
root the verifier is told to trust; Apple's real root is only checked for its
pinned fingerprint. No network: online (OCSP) checks are off and the App Store
Server API is a fake at the client boundary.

Not a test module. Plain helpers are imported directly; the fixtures defined
here reach a test module through its
``pytest_plugins = ["tests._apple_iap_harness"]`` line, which avoids the
F811 shadowing an imported fixture would cause.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from types import SimpleNamespace

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from db.base import get_session_factory
from db.models import Purchase
from entitlements import service as entitlements_service
from purchases import apple
from purchases.apple_store import AppleConfig, AppStoreVerifier
from tests.apple_jws import APP_APPLE_ID, BUNDLE_ID, default_ca, notification, transaction

CASCADE = "com.buffingchi.games.premium.cascade"

BOTH = frozenset({"production", "sandbox"})

# ---------------------------------------------------------------------------
# Fixtures and helpers
# ---------------------------------------------------------------------------


@dataclass
class FakeApiClient:
    """The two App Store Server API calls we use, answering from test data."""

    transactions: dict[str, str] = field(default_factory=dict)  # transactionId -> JWS
    pages: list[SimpleNamespace] = field(default_factory=list)
    error: Exception | None = None
    history_calls: int = 0

    async def get_transaction_info(self, transaction_id: str) -> SimpleNamespace:
        if self.error:
            raise self.error
        return SimpleNamespace(signedTransactionInfo=self.transactions.get(transaction_id))

    async def get_notification_history(self, token, request) -> SimpleNamespace:
        self.history_calls += 1
        if self.error:
            raise self.error
        index = int(token or 0)
        return self.pages[index]


def config(envs: frozenset = BOTH, app_id: int | None = APP_APPLE_ID) -> AppleConfig:
    return AppleConfig(
        bundle_id=BUNDLE_ID,
        app_apple_id=app_id,
        environments=envs,  # type: ignore[arg-type]
        online_checks=False,
        api=None,
    )


def make_verifier(
    envs: frozenset = BOTH, api: dict | None = None, roots: list[bytes] | None = None
) -> AppStoreVerifier:
    return AppStoreVerifier(
        config(envs),
        root_certificates=roots if roots is not None else [default_ca().root_der],
        api_clients=api,
    )


@pytest.fixture()
def use_verifier() -> Iterator:
    """Install a verifier as the configured one (both the dependency and the webhook)."""

    def install(v: AppStoreVerifier) -> AppStoreVerifier:
        apple._verifier = v
        return v

    yield install
    apple.reset_apple_verifier()


@pytest.fixture()
def verifier(use_verifier) -> AppStoreVerifier:
    return use_verifier(make_verifier())


def hdr(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


def post_txn(client: TestClient, sid: str, jws: str, source: str = "sync"):
    return client.post(
        "/purchases/apple", json={"signed_transaction": jws, "source": source}, headers=hdr(sid)
    )


def post_note(client: TestClient, jws: str):
    return client.post("/purchases/apple/notifications", json={"signedPayload": jws})


def jwt_games(client: TestClient, sid: str) -> list[str]:
    r = client.get("/entitlements", headers=hdr(sid))
    assert r.status_code == 200
    pub = entitlements_service.get_public_key_pem()
    return jwt.decode(r.json()["token"], pub, algorithms=["RS256"])["entitled_games"]


async def purchase_row(store_key: str) -> Purchase | None:
    async with get_session_factory()() as db:
        return (
            await db.execute(select(Purchase).where(Purchase.store_key == store_key))
        ).scalar_one_or_none()


async def count(model, *where) -> int:
    async with get_session_factory()() as db:
        return (
            await db.execute(select(func.count()).select_from(model).where(*where))
        ).scalar_one()


def signed_txn(key: str, **kw) -> str:
    return default_ca().sign(transaction(key, **kw))


def signed_note(ntype: str, txn_jws: str | None, **kw) -> str:
    return default_ca().sign(notification(ntype, txn_jws, **kw))


def tamper(jws: str, **claims) -> str:
    """Change payload claims but keep the original signature."""
    header, payload, sig = jws.split(".")
    data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    data.update(claims)
    new = base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")
    return f"{header}.{new}.{sig}"

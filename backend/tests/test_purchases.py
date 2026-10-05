"""POST /purchases/{apple,google} — verified purchases, links and derived entitlements (#840).

Store verification is faked at the verifier boundary (``purchases/verifiers.py``):
the fakes return a test-controlled :class:`VerifiedPurchase`, so these tests
exercise everything #840 owns — upsert, ownership check, link caps,
revocation, derived ``game_entitlements``, rate limits and the returned JWT —
and nothing that #2786 / #2787 own (JWS signatures, store APIs).

Covers docs/IAP.md §8.3 and SECURITY.md §14 where they fall in this story.
"""

from __future__ import annotations

import base64
import hashlib
import json
import uuid
from collections.abc import Iterator
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from db.base import get_session_factory
from db.models import GameEntitlement, Purchase, PurchaseEvent, PurchaseLink
from entitlements import service as entitlements_service
from purchases import apple, google
from purchases import service as purchase_service
from purchases.router import (
    PURCHASE_IP_RATE_LIMIT,
    PURCHASE_SESSION_RATE_LIMIT,
    PURCHASE_STORE_KEY_RATE_LIMIT,
)
from purchases.verifiers import (
    AppleEvidence,
    AppleVerifier,
    GoogleEvidence,
    GoogleVerifier,
    NotConfiguredGoogleVerifier,
    PurchaseError,
    VerifiedPurchase,
)

HEARTS = "com.buffingchi.games.premium.hearts"
CASCADE = "com.buffingchi.games.premium.cascade"


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


def make_jws(store_key: str, **claims: object) -> str:
    """An unsigned three-part JWS — enough for the store-key parse; the fake verifies."""

    def seg(obj: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")

    return f"{seg({'alg': 'ES256'})}.{seg({'originalTransactionId': store_key, **claims})}.sig"


def verified(
    store_key: str,
    *,
    platform: str = "apple",
    product_id: str = HEARTS,
    state: str = "owned",
    account_token: str | None = None,
    ownership_type: str = "purchased",
    **kw: object,
) -> VerifiedPurchase:
    return VerifiedPurchase(
        platform=platform,  # type: ignore[arg-type]
        product_id=product_id,
        store_key=store_key,
        transaction_id=f"txn-{store_key}",
        environment=kw.pop("environment", "sandbox" if platform == "apple" else "test"),  # type: ignore[arg-type]
        ownership_type=ownership_type,  # type: ignore[arg-type]
        state=state,  # type: ignore[arg-type]
        purchased_at=datetime(2026, 9, 1, tzinfo=timezone.utc),
        account_token=account_token,
        **kw,  # type: ignore[arg-type]
    )


class FakeAppleVerifier:
    """Answers from ``answers[store_key]``; raises ``error`` when set."""

    def __init__(self) -> None:
        self.answers: dict[str, VerifiedPurchase] = {}
        self.error: PurchaseError | None = None
        self.calls = 0

    async def verify(self, evidence: AppleEvidence) -> VerifiedPurchase:
        self.calls += 1
        if self.error:
            raise self.error
        return self.answers[apple.parse_store_key(evidence.signed_transaction)]


class FakeGoogleVerifier:
    def __init__(self) -> None:
        self.answers: dict[str, VerifiedPurchase] = {}
        self.acks: list[str] = []
        self.ack_error: PurchaseError | None = None

    async def verify(self, evidence: GoogleEvidence) -> VerifiedPurchase:
        return self.answers[evidence.purchase_token]

    async def acknowledge(self, evidence: GoogleEvidence) -> None:
        if self.ack_error:
            raise self.ack_error
        self.acks.append(evidence.purchase_token)


@pytest.fixture()
def fake_apple() -> Iterator[FakeAppleVerifier]:
    from main import app

    fake = FakeAppleVerifier()
    app.dependency_overrides[apple.get_apple_verifier] = lambda: fake
    yield fake
    app.dependency_overrides.pop(apple.get_apple_verifier, None)


@pytest.fixture()
def fake_google() -> Iterator[FakeGoogleVerifier]:
    from main import app

    fake = FakeGoogleVerifier()
    app.dependency_overrides[google.get_google_verifier] = lambda: fake
    yield fake
    app.dependency_overrides.pop(google.get_google_verifier, None)


def new_sid() -> str:
    return str(uuid.uuid4())


def hdr(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


def post_apple(client: TestClient, sid: str, store_key: str, source: str = "sync"):
    return client.post(
        "/purchases/apple",
        json={"signed_transaction": make_jws(store_key), "source": source},
        headers=hdr(sid),
    )


def post_google(
    client: TestClient, sid: str, token: str, source: str = "sync", product_id: str = HEARTS
):
    return client.post(
        "/purchases/google",
        json={"product_id": product_id, "purchase_token": token, "source": source},
        headers=hdr(sid),
    )


def token_games(body: dict) -> list[str]:
    pub = entitlements_service.get_public_key_pem()
    return jwt.decode(body["entitlements"]["token"], pub, algorithms=["RS256"])["entitled_games"]


def jwt_games(client: TestClient, sid: str) -> list[str]:
    r = client.get("/entitlements", headers=hdr(sid))
    assert r.status_code == 200
    return token_games({"entitlements": r.json()})


async def count(model, *where) -> int:
    async with get_session_factory()() as db:
        return (
            await db.execute(select(func.count()).select_from(model).where(*where))
        ).scalar_one()


async def entitlement(sid: str, slug: str = "hearts") -> GameEntitlement | None:
    async with get_session_factory()() as db:
        return (
            await db.execute(
                select(GameEntitlement).where(
                    GameEntitlement.session_id == sid, GameEntitlement.game_slug == slug
                )
            )
        ).scalar_one_or_none()


async def backdate_links(days: int) -> None:
    async with get_session_factory()() as db:
        await db.execute(
            update(PurchaseLink).values(
                created_at=datetime.now(timezone.utc) - timedelta(days=days)
            )
        )
        # The caps also count the retained "linked" audit events (S1, #2786).
        await db.execute(
            update(PurchaseEvent)
            .where(PurchaseEvent.kind == "linked")
            .values(created_at=datetime.now(timezone.utc) - timedelta(days=days))
        )
        await db.commit()


# ---------------------------------------------------------------------------
# Account-token derivation (IAP.md §4)
# ---------------------------------------------------------------------------


def test_apple_account_token_is_uuid5_of_session_and_not_the_session() -> None:
    sid = new_sid()
    token = apple.expected_account_token(sid)
    assert token == str(uuid.uuid5(apple.APP_ACCOUNT_NS, sid))
    assert token != sid
    assert apple.account_token_matches(sid, token.upper())
    assert not apple.account_token_matches(new_sid(), token)
    assert not apple.account_token_matches(sid, None)
    assert not apple.account_token_matches(sid, "not-a-uuid")


def test_google_account_token_is_sha256_hex_of_session() -> None:
    sid = new_sid()
    token = google.expected_account_token(sid)
    assert token == hashlib.sha256(sid.encode()).hexdigest()
    assert len(token) == 64 and token != sid
    assert google.account_token_matches(sid, token)
    assert not google.account_token_matches(sid, None)
    assert not google.account_token_matches(new_sid(), token)


def test_verifier_protocols_are_satisfied_by_defaults_and_fakes() -> None:
    assert isinstance(apple.get_apple_verifier(), AppleVerifier)
    assert isinstance(google.get_google_verifier(), GoogleVerifier)
    assert isinstance(FakeAppleVerifier(), AppleVerifier)
    assert isinstance(FakeGoogleVerifier(), GoogleVerifier)


@pytest.mark.parametrize(
    "jws",
    [
        "only.two",
        "a.!!!notbase64!!!.c",
        "a." + base64.urlsafe_b64encode(b"[1,2]").decode() + ".c",
        "a." + base64.urlsafe_b64encode(b'{"originalTransactionId": ""}').decode() + ".c",
        "a." + base64.urlsafe_b64encode(b'{"originalTransactionId": true}').decode() + ".c",
    ],
)
def test_parse_store_key_rejects_malformed_jws(jws: str) -> None:
    with pytest.raises(PurchaseError) as exc:
        apple.parse_store_key(jws)
    assert (exc.value.status_code, exc.value.detail) == (400, "invalid_request")


def test_parse_store_key_reads_original_transaction_id() -> None:
    assert apple.parse_store_key(make_jws("2000000123")) == "2000000123"


# ---------------------------------------------------------------------------
# Not configured (until #2786 / #2787): nothing is granted
# ---------------------------------------------------------------------------


def test_apple_not_configured_returns_503(client: TestClient) -> None:
    sid = new_sid()
    r = post_apple(client, sid, "1000")
    assert r.status_code == 503
    assert r.json()["detail"] == "store_unavailable"
    assert jwt_games(client, sid) == []


def test_google_not_configured_returns_503(client: TestClient) -> None:
    r = post_google(client, new_sid(), "tok")
    assert r.status_code == 503
    assert r.json()["detail"] == "store_unavailable"


async def test_not_configured_google_acknowledge_raises() -> None:
    with pytest.raises(PurchaseError):
        await NotConfiguredGoogleVerifier().acknowledge(GoogleEvidence(HEARTS, "t"))


# ---------------------------------------------------------------------------
# Purchase → access
# ---------------------------------------------------------------------------


async def test_paid_access_denied_before_purchase_allowed_after(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    sid = new_sid()
    assert client.post("/games", json={"game_type": "hearts"}, headers=hdr(sid)).status_code == 403

    fake_apple.answers["1000"] = verified("1000", account_token=apple.expected_account_token(sid))
    r = post_apple(client, sid, "1000", source="purchase")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "owned"
    assert body["game_slug"] == "hearts"
    assert body["product_id"] == HEARTS
    assert body["finish"] is True
    assert token_games(body) == ["hearts"]
    assert jwt_games(client, sid) == ["hearts"]
    assert client.post("/games", json={"game_type": "hearts"}, headers=hdr(sid)).status_code != 403

    row = await entitlement(sid)
    assert row is not None and row.purchase_id is not None
    assert row.source == "purchase" and row.last_verified_at is not None
    async with get_session_factory()() as db:
        purchase = (await db.execute(select(Purchase))).scalar_one()
    assert (purchase.platform, purchase.store_key, purchase.state) == ("apple", "1000", "owned")
    assert purchase.environment == "sandbox"
    assert purchase.store_transaction_id == "txn-1000"
    assert purchase.account_token == apple.expected_account_token(sid)
    assert purchase.verified_at is not None and purchase.purchased_at is not None


async def test_repeat_validation_is_idempotent(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    sid = new_sid()
    fake_apple.answers["1000"] = verified("1000", account_token=apple.expected_account_token(sid))
    for source in ("purchase", "purchase", "sync", "restore"):
        r = post_apple(client, sid, "1000", source=source)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "owned"
    assert await count(Purchase) == 1
    assert await count(PurchaseLink) == 1
    assert await count(GameEntitlement, GameEntitlement.session_id == sid) == 1
    assert await count(PurchaseEvent, PurchaseEvent.kind == "linked") == 1
    # The link keeps its original source.
    assert (await entitlement(sid)).source == "purchase"


async def test_restore_from_second_session_links(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    buyer, reinstall = new_sid(), new_sid()
    fake_apple.answers["1000"] = verified("1000", account_token=apple.expected_account_token(buyer))
    assert post_apple(client, buyer, "1000", source="purchase").status_code == 200
    r = post_apple(client, reinstall, "1000", source="restore")
    assert r.status_code == 200
    assert token_games(r.json()) == ["hearts"]
    assert (await entitlement(reinstall)).source == "restore"
    assert await count(PurchaseLink) == 2
    assert await count(Purchase) == 1


# ---------------------------------------------------------------------------
# Ownership check (source = "purchase" only)
# ---------------------------------------------------------------------------


async def test_foreign_account_token_on_purchase_is_403_then_sync_links(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    sid = new_sid()
    fake_apple.answers["1000"] = verified(
        "1000", account_token=apple.expected_account_token(new_sid())
    )
    r = post_apple(client, sid, "1000", source="purchase")
    assert r.status_code == 403
    assert r.json()["detail"] == "ownership_mismatch"
    # Evidence was real: the purchase row is kept, the refusal audited, no link.
    assert await count(Purchase) == 1
    assert await count(PurchaseLink) == 0
    assert await count(PurchaseEvent, PurchaseEvent.kind == "link_rejected") == 1
    assert await entitlement(sid) is None

    r = post_apple(client, sid, "1000", source="sync")
    assert r.status_code == 200
    assert token_games(r.json()) == ["hearts"]


def test_missing_account_token_on_purchase_is_403(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    fake_apple.answers["1000"] = verified("1000", account_token=None)
    r = post_apple(client, new_sid(), "1000", source="purchase")
    assert r.status_code == 403


async def test_google_purchase_checks_sha256_token(
    client: TestClient, fake_google: FakeGoogleVerifier
) -> None:
    sid = new_sid()
    fake_google.answers["gtok"] = verified(
        "gtok", platform="google", account_token=google.expected_account_token(new_sid())
    )
    assert post_google(client, sid, "gtok", source="purchase").status_code == 403
    fake_google.answers["gtok"] = replace(
        fake_google.answers["gtok"], account_token=google.expected_account_token(sid)
    )
    r = post_google(client, sid, "gtok", source="purchase")
    assert r.status_code == 200
    assert token_games(r.json()) == ["hearts"]


# ---------------------------------------------------------------------------
# Link caps (IAP.md §4)
# ---------------------------------------------------------------------------


async def test_link_caps_30_day_limit_then_session_cap_without_eviction(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    fake_apple.answers["1000"] = verified("1000")
    sessions = [new_sid() for _ in range(6)]

    # Three new links in 30 days, then the fourth is refused.
    for sid in sessions[:3]:
        assert post_apple(client, sid, "1000").status_code == 200
    r = post_apple(client, sessions[3], "1000")
    assert r.status_code == 409
    assert r.json()["detail"] == "link_limit"
    assert await entitlement(sessions[3]) is None

    # Once those age out, two more fit — five sessions in all.
    await backdate_links(31)
    for sid in sessions[3:5]:
        assert post_apple(client, sid, "1000").status_code == 200
    await backdate_links(31)

    # A sixth session is refused, even with the 30-day window clear.
    r = post_apple(client, sessions[5], "1000", source="restore")
    assert r.status_code == 409
    assert r.json()["detail"] == "link_limit"

    # Nothing was evicted, and a linked session can still re-present at the cap.
    assert await count(PurchaseLink) == 5
    for sid in sessions[:5]:
        assert (await entitlement(sid)) is not None
    assert post_apple(client, sessions[0], "1000").status_code == 200
    assert await count(PurchaseEvent, PurchaseEvent.kind == "link_rejected") == 2


# ---------------------------------------------------------------------------
# Revocation / refund reversal
# ---------------------------------------------------------------------------


async def test_revoke_removes_access_for_all_linked_sessions_and_reversal_restores(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    fake_apple.answers["1000"] = verified("1000")
    a, b = new_sid(), new_sid()
    for sid in (a, b):
        assert post_apple(client, sid, "1000").status_code == 200

    async with get_session_factory()() as db:
        changed = await purchase_service.apply_store_state(
            db,
            platform="apple",
            store_key="1000",
            state="revoked",
            reason="REFUND",
            dedupe_key="notif-1",
        )
    assert changed is True
    for sid in (a, b):
        assert jwt_games(client, sid) == []
        r = client.post("/games", json={"game_type": "hearts"}, headers=hdr(sid))
        assert r.status_code == 403
    assert await count(PurchaseLink) == 2  # links are kept

    # A redelivered notification is a no-op.
    async with get_session_factory()() as db:
        assert not await purchase_service.apply_store_state(
            db, platform="apple", store_key="1000", state="owned", dedupe_key="notif-1"
        )
    assert jwt_games(client, a) == []

    # REFUND_REVERSED: every still-linked session gets the game back at once.
    async with get_session_factory()() as db:
        assert await purchase_service.apply_store_state(
            db, platform="apple", store_key="1000", state="owned", dedupe_key="notif-2"
        )
    for sid in (a, b):
        assert jwt_games(client, sid) == ["hearts"]

    async with get_session_factory()() as db:
        purchase = (await db.execute(select(Purchase))).scalar_one()
        assert purchase.revoked_at is None and purchase.revocation_reason is None
        # Same state again, unknown purchase: nothing changes.
        assert not await purchase_service.apply_store_state(
            db, platform="apple", store_key="1000", state="owned"
        )
        assert not await purchase_service.apply_store_state(
            db, platform="apple", store_key="nope", state="revoked"
        )


async def test_revoked_answer_on_repost_drops_access_and_says_finish(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    sid, other = new_sid(), new_sid()
    fake_apple.answers["1000"] = verified("1000")
    assert post_apple(client, sid, "1000").status_code == 200
    assert post_apple(client, other, "1000").status_code == 200

    fake_apple.answers["1000"] = verified("1000", state="revoked", revocation_reason="refund")
    r = post_apple(client, sid, "1000")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "revoked" and body["finish"] is True
    assert token_games(body) == []
    assert jwt_games(client, other) == []

    async with get_session_factory()() as db:
        purchase = (await db.execute(select(Purchase))).scalar_one()
    assert purchase.state == "revoked"
    assert purchase.revoked_at is not None and purchase.revocation_reason == "refund"

    # The store says owned again (refund reversed) → access is back for both.
    fake_apple.answers["1000"] = verified("1000")
    assert post_apple(client, sid, "1000").json()["status"] == "owned"
    assert jwt_games(client, other) == ["hearts"]


async def test_revoking_one_purchase_keeps_game_owned_through_another(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    sid = new_sid()
    fake_apple.answers["own"] = verified("own")
    fake_apple.answers["family"] = verified("family", ownership_type="family_shared")
    assert post_apple(client, sid, "own").status_code == 200
    assert post_apple(client, sid, "family").status_code == 200
    assert await count(GameEntitlement, GameEntitlement.session_id == sid) == 1

    async with get_session_factory()() as db:
        await purchase_service.apply_store_state(
            db, platform="apple", store_key="own", state="revoked", reason="REFUND"
        )
    assert jwt_games(client, sid) == ["hearts"]
    row = await entitlement(sid)
    async with get_session_factory()() as db:
        family_id = (
            await db.execute(select(Purchase.id).where(Purchase.store_key == "family"))
        ).scalar_one()
    assert row.purchase_id == family_id


async def test_legacy_entitlement_rows_are_never_touched(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    sid = new_sid()
    async with get_session_factory()() as db:
        db.add(GameEntitlement(session_id=sid, game_slug="hearts"))
        await db.commit()
    fake_apple.answers["1000"] = verified("1000")
    assert post_apple(client, sid, "1000").status_code == 200
    async with get_session_factory()() as db:
        await purchase_service.apply_store_state(
            db, platform="apple", store_key="1000", state="revoked"
        )
    row = await entitlement(sid)
    assert row is not None and row.source == "legacy" and row.purchase_id is None
    assert jwt_games(client, sid) == ["hearts"]


# ---------------------------------------------------------------------------
# Google specifics: pending, acknowledgement
# ---------------------------------------------------------------------------


async def test_google_pending_records_but_does_not_link_or_finish(
    client: TestClient, fake_google: FakeGoogleVerifier
) -> None:
    sid = new_sid()
    fake_google.answers["gtok"] = verified("gtok", platform="google", state="pending")
    r = post_google(client, sid, "gtok")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "pending" and body["finish"] is False
    assert token_games(body) == []
    assert await count(Purchase, Purchase.state == "pending") == 1
    assert await count(PurchaseLink) == 0
    assert fake_google.acks == []

    # Pending → purchased: the listener posts it again with source=sync.
    fake_google.answers["gtok"] = verified("gtok", platform="google")
    r = post_google(client, sid, "gtok")
    assert r.json()["status"] == "owned"
    assert fake_google.acks == ["gtok"]


async def test_google_acknowledges_once_after_persisting(
    client: TestClient, fake_google: FakeGoogleVerifier
) -> None:
    sid = new_sid()
    fake_google.answers["gtok"] = verified("gtok", platform="google")
    assert post_google(client, sid, "gtok").status_code == 200
    assert post_google(client, sid, "gtok").status_code == 200
    assert fake_google.acks == ["gtok"]
    async with get_session_factory()() as db:
        purchase = (await db.execute(select(Purchase))).scalar_one()
    assert purchase.acknowledged_at is not None


async def test_google_ack_failure_still_grants(
    client: TestClient, fake_google: FakeGoogleVerifier
) -> None:
    sid = new_sid()
    fake_google.answers["gtok"] = verified("gtok", platform="google")
    fake_google.ack_error = PurchaseError(503, "store_unavailable")
    r = post_google(client, sid, "gtok")
    assert r.status_code == 200 and r.json()["status"] == "owned"
    async with get_session_factory()() as db:
        purchase = (await db.execute(select(Purchase))).scalar_one()
    assert purchase.acknowledged_at is None


async def test_google_already_acknowledged_is_not_reacknowledged(
    client: TestClient, fake_google: FakeGoogleVerifier
) -> None:
    fake_google.answers["gtok"] = verified("gtok", platform="google", acknowledged=True)
    assert post_google(client, new_sid(), "gtok").status_code == 200
    assert fake_google.acks == []


# ---------------------------------------------------------------------------
# Rejections
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "product_id",
    [
        "com.buffingchi.games.premium.yacht",  # a free game
        "com.buffingchi.games.premium.nosuchgame",
        "com.buffingchi.games.premium.",
        "com.example.hearts",
    ],
)
def test_unknown_or_free_product_is_422(
    client: TestClient, fake_apple: FakeAppleVerifier, product_id: str
) -> None:
    fake_apple.answers["1000"] = verified("1000", product_id=product_id)
    r = post_apple(client, new_sid(), "1000")
    assert r.status_code == 422
    assert r.json()["detail"] == "unknown_product"


def test_google_bad_product_prefix_rejected_before_verification(
    client: TestClient, fake_google: FakeGoogleVerifier
) -> None:
    r = post_google(client, new_sid(), "gtok", product_id="com.example.x")
    assert r.status_code == 422 and r.json()["detail"] == "unknown_product"


def test_google_verifier_product_mismatch_is_422(
    client: TestClient, fake_google: FakeGoogleVerifier
) -> None:
    fake_google.answers["gtok"] = verified("gtok", platform="google", product_id=CASCADE)
    r = post_google(client, new_sid(), "gtok", product_id=HEARTS)
    assert r.status_code == 422 and r.json()["detail"] == "verification_failed"


@pytest.mark.parametrize("code", ["verification_failed", "wrong_app", "environment_not_allowed"])
def test_verifier_errors_pass_through(
    client: TestClient, fake_apple: FakeAppleVerifier, code: str
) -> None:
    fake_apple.error = PurchaseError(422, code)
    r = post_apple(client, new_sid(), "1000")
    assert r.status_code == 422 and r.json()["detail"] == code


def test_verifier_answer_for_a_different_store_key_is_422(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    fake_apple.answers["1000"] = verified("9999")
    r = post_apple(client, new_sid(), "1000")
    assert r.status_code == 422 and r.json()["detail"] == "verification_failed"


def test_product_change_for_same_store_key_is_422(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    fake_apple.answers["1000"] = verified("1000")
    assert post_apple(client, new_sid(), "1000").status_code == 200
    fake_apple.answers["1000"] = verified("1000", product_id=CASCADE)
    r = post_apple(client, new_sid(), "1000")
    assert r.status_code == 422 and r.json()["detail"] == "verification_failed"


def test_cancelled_purchase_grants_nothing(
    client: TestClient, fake_google: FakeGoogleVerifier
) -> None:
    sid = new_sid()
    fake_google.answers["gtok"] = verified("gtok", platform="google", state="cancelled")
    r = post_google(client, sid, "gtok")
    assert r.status_code == 422 and r.json()["detail"] == "verification_failed"
    assert jwt_games(client, sid) == []


@pytest.mark.parametrize(
    "body",
    [
        {"signed_transaction": "only.two", "source": "sync"},
        {"signed_transaction": make_jws("1"), "source": "gift"},
        {"signed_transaction": "", "source": "sync"},
        {"source": "sync"},
        {"signed_transaction": make_jws("1"), "source": "sync", "extra": 1},
    ],
)
def test_malformed_apple_request_is_400_invalid_request(
    client: TestClient, fake_apple: FakeAppleVerifier, body: dict
) -> None:
    r = client.post("/purchases/apple", json=body, headers=hdr(new_sid()))
    assert r.status_code == 400
    assert r.json()["detail"] == "invalid_request"
    assert fake_apple.calls == 0


@pytest.mark.parametrize("headers", [{}, {"X-Session-ID": "not-a-uuid"}, {"X-Session-ID": " "}])
def test_purchase_requires_session_header(
    client: TestClient, fake_apple: FakeAppleVerifier, headers: dict[str, str]
) -> None:
    for path, body in (
        ("/purchases/apple", {"signed_transaction": make_jws("1"), "source": "sync"}),
        ("/purchases/google", {"product_id": HEARTS, "purchase_token": "t", "source": "sync"}),
    ):
        r = client.post(path, json=body, headers=headers)
        assert r.status_code == 400
        assert r.json()["detail"] == "invalid_request"
    assert fake_apple.calls == 0


def test_other_routes_keep_their_session_header_detail(client: TestClient) -> None:
    # The invalid_request mapping is scoped to /purchases.
    r = client.get("/entitlements")
    assert r.status_code == 400
    assert r.json()["detail"] != "invalid_request"


def test_realistic_jws_size_is_not_rejected_as_too_large(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    fake_apple.answers["1000"] = verified("1000")
    jws = make_jws("1000", x5c="A" * 9_000)
    r = client.post(
        "/purchases/apple",
        json={"signed_transaction": jws, "source": "sync"},
        headers=hdr(new_sid()),
    )
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Rate limits (IAP.md §8.2)
# ---------------------------------------------------------------------------


def _first_limit(spec: str) -> int:
    return int(spec.split(";")[0].split("/")[0])


def test_store_key_rate_limit_counts_across_sessions(client: TestClient) -> None:
    # Unconfigured verifier (503) — the store-key limit is counted before any store call.
    limit = _first_limit(PURCHASE_STORE_KEY_RATE_LIMIT)
    for _ in range(limit):
        assert post_apple(client, new_sid(), "1000").status_code == 503
    assert post_apple(client, new_sid(), "1000").status_code == 429
    assert post_apple(client, new_sid(), "2000").status_code == 503
    for _ in range(limit):
        assert post_google(client, new_sid(), "gtok").status_code == 503
    assert post_google(client, new_sid(), "gtok").status_code == 429


def test_per_session_rate_limit(client: TestClient) -> None:
    sid = new_sid()
    limit = _first_limit(PURCHASE_SESSION_RATE_LIMIT)
    for i in range(limit):
        assert post_apple(client, sid, f"k{i}").status_code == 503
    assert post_apple(client, sid, "another").status_code == 429


def test_per_ip_rate_limit_is_not_lifted_by_rotating_sessions(client: TestClient) -> None:
    limit = _first_limit(PURCHASE_IP_RATE_LIMIT)
    for i in range(limit):
        assert post_google(client, new_sid(), f"t{i}").status_code == 503
    assert post_google(client, new_sid(), "fresh").status_code == 429


# ---------------------------------------------------------------------------
# Free-game regression
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("game", ["yacht", "solitaire", "freecell", "sudoku"])
def test_free_games_unaffected_by_purchase_code(
    client: TestClient, fake_apple: FakeAppleVerifier, game: str
) -> None:
    sid = new_sid()
    fake_apple.answers["1000"] = verified("1000")
    assert post_apple(client, new_sid(), "1000").status_code == 200
    r = client.post("/games", json={"game_type": game}, headers=hdr(sid))
    assert r.status_code != 403
    assert jwt_games(client, sid) == []


# ---------------------------------------------------------------------------
# Admin PATCH is_premium (IAP.md §13)
# ---------------------------------------------------------------------------

_ADMIN = "test-admin-token-840"


def _catalog_id(client: TestClient, name: str) -> int:
    items = client.get("/games/catalog").json()["items"]
    return next(g["id"] for g in items if g["name"] == name)


def test_patch_cannot_flip_catalog_game_to_free(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ADMIN_API_TOKEN", _ADMIN)
    gid = _catalog_id(client, "hearts")
    headers = {"X-Admin-Token": _ADMIN}
    r = client.patch(f"/games/catalog/{gid}", json={"is_premium": False}, headers=headers)
    assert r.status_code == 409
    assert r.json()["detail"] == "is_premium_migration_only"
    # Unchanged value and other fields are still editable.
    r = client.patch(f"/games/catalog/{gid}", json={"is_premium": True}, headers=headers)
    assert r.status_code == 200 and r.json()["is_premium"] is True


async def test_patch_cannot_change_tier_of_game_with_purchases(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ADMIN_API_TOKEN", _ADMIN)
    async with get_session_factory()() as db:
        db.add(
            Purchase(
                platform="google",
                store_key="legacy-free-game",
                product_id="com.buffingchi.games.premium.twenty48",
                game_slug="twenty48",
                state="owned",
                environment="test",
                verified_at=datetime.now(timezone.utc),
                state_changed_at=datetime.now(timezone.utc),
            )
        )
        await db.commit()
    gid = _catalog_id(client, "twenty48")
    r = client.patch(
        f"/games/catalog/{gid}", json={"is_premium": True}, headers={"X-Admin-Token": _ADMIN}
    )
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# Review hardening: dedupe race, concurrent recompute, event ordering,
# environment allow-list, owned→pending, purchase deletion (PR #2862)
# ---------------------------------------------------------------------------


async def purchase_row(store_key: str) -> Purchase:
    async with get_session_factory()() as db:
        return (
            await db.execute(select(Purchase).where(Purchase.store_key == store_key))
        ).scalar_one()


async def apply_state(store_key: str, state: str, **kw: object) -> bool:
    async with get_session_factory()() as db:
        return await purchase_service.apply_store_state(
            db, platform="apple", store_key=store_key, state=state, **kw  # type: ignore[arg-type]
        )


async def test_dedupe_key_committed_while_waiting_for_lock_is_a_noop(
    client: TestClient, fake_apple: FakeAppleVerifier, monkeypatch: pytest.MonkeyPatch
) -> None:
    sid = new_sid()
    fake_apple.answers["1000"] = verified("1000")
    assert post_apple(client, sid, "1000").status_code == 200
    original = purchase_service._lock_purchase

    async def lock_then_race(db, platform, store_key):  # type: ignore[no-untyped-def]
        purchase = await original(db, platform, store_key)
        # A parallel delivery of the same notification commits while this one
        # waited for the row lock.
        async with get_session_factory()() as other:
            other.add(PurchaseEvent(kind="state_changed", dedupe_key="race-1", detail={}))
            await other.commit()
        return purchase

    monkeypatch.setattr(purchase_service, "_lock_purchase", lock_then_race)
    assert await apply_state("1000", "revoked", reason="REFUND", dedupe_key="race-1") is False
    assert (await purchase_row("1000")).state == "owned"
    assert await count(PurchaseEvent, PurchaseEvent.dedupe_key == "race-1") == 1
    assert jwt_games(client, sid) == ["hearts"]


async def test_dedupe_unique_violation_on_commit_rolls_back_to_noop(
    client: TestClient, fake_apple: FakeAppleVerifier, monkeypatch: pytest.MonkeyPatch
) -> None:
    sid = new_sid()
    fake_apple.answers["1000"] = verified("1000")
    assert post_apple(client, sid, "1000").status_code == 200
    async with get_session_factory()() as db:
        db.add(PurchaseEvent(kind="state_changed", dedupe_key="race-2", detail={}))
        await db.commit()

    async def never_seen(db, key):  # type: ignore[no-untyped-def]
        return False  # both checks raced past the other delivery

    monkeypatch.setattr(purchase_service, "_dedupe_seen", never_seen)
    assert await apply_state("1000", "revoked", reason="REFUND", dedupe_key="race-2") is False
    assert (await purchase_row("1000")).state == "owned"
    assert await count(PurchaseEvent, PurchaseEvent.dedupe_key == "race-2") == 1
    assert jwt_games(client, sid) == ["hearts"]


async def test_two_owned_purchases_for_one_session_game_upsert_without_conflict(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    sid = new_sid()
    fake_apple.answers["own"] = verified("own")
    fake_apple.answers["family"] = verified("family", ownership_type="family_shared")
    # Sequentially, in either order and repeated: one row, never an IntegrityError.
    for key in ("own", "family", "own", "family"):
        assert post_apple(client, sid, key).status_code == 200
    assert await count(GameEntitlement, GameEntitlement.session_id == sid) == 1
    async with get_session_factory()() as db:
        await purchase_service.recompute_entitlement(db, sid, "hearts")
        await purchase_service.recompute_entitlement(db, sid, "hearts")
        await db.commit()
    assert await count(GameEntitlement, GameEntitlement.session_id == sid) == 1


async def test_recompute_upserts_over_a_row_a_concurrent_grant_inserted(
    client: TestClient, fake_apple: FakeAppleVerifier, monkeypatch: pytest.MonkeyPatch
) -> None:
    sid = new_sid()
    fake_apple.answers["own"] = verified("own")
    fake_apple.answers["family"] = verified("family", ownership_type="family_shared")
    assert post_apple(client, sid, "own").status_code == 200
    assert post_apple(client, sid, "family").status_code == 200
    own_id = (await purchase_row("own")).id
    family_id = (await purchase_row("family")).id
    async with get_session_factory()() as db:
        await db.execute(
            GameEntitlement.__table__.delete().where(GameEntitlement.session_id == sid)
        )
        await db.commit()

    original = purchase_service.dialect_insert
    pending: list = []

    async def rival() -> None:
        # Another transaction (the family purchase's grant) inserts and
        # commits the same (session_id, game_slug) between this one's read
        # and its write.
        async with get_session_factory()() as other:
            other.add(
                GameEntitlement(
                    session_id=sid, game_slug="hearts", purchase_id=family_id, source="sync"
                )
            )
            await other.commit()
        rival_ran.append(True)

    rival_ran: list[bool] = []

    def insert_after_rival(db, table):  # type: ignore[no-untyped-def]
        pending.append(rival())
        return original(db, table)

    monkeypatch.setattr(purchase_service, "dialect_insert", insert_after_rival)
    async with get_session_factory()() as db:
        # Run the rival right before the upsert executes.
        real_execute = db.execute

        async def execute(stmt, *a, **k):  # type: ignore[no-untyped-def]
            while pending:
                await pending.pop()
            return await real_execute(stmt, *a, **k)

        db.execute = execute  # type: ignore[method-assign]
        await purchase_service.recompute_entitlement(db, sid, "hearts")
        await db.commit()
    assert rival_ran == [True]
    row = await entitlement(sid)
    assert row is not None and row.purchase_id == own_id  # the earliest link wins
    assert await count(GameEntitlement, GameEntitlement.session_id == sid) == 1


async def test_recompute_all_links_locks_sessions_in_sorted_order(
    client: TestClient, fake_apple: FakeAppleVerifier, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_apple.answers["1000"] = verified("1000")
    sids = sorted((new_sid() for _ in range(3)), reverse=True)
    for sid in sids:
        assert post_apple(client, sid, "1000").status_code == 200
    seen: list[str] = []
    original = purchase_service.recompute_entitlement

    async def record(db, session_id, game_slug):  # type: ignore[no-untyped-def]
        seen.append(session_id)
        await original(db, session_id, game_slug)

    monkeypatch.setattr(purchase_service, "recompute_entitlement", record)
    assert await apply_state("1000", "revoked")
    assert seen == sorted(sids)


async def test_refund_older_than_refund_reversed_is_ignored(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    sid = new_sid()
    fake_apple.answers["1000"] = verified("1000")
    assert post_apple(client, sid, "1000").status_code == 200
    t0 = datetime.now(timezone.utc)
    assert await apply_state(
        "1000", "revoked", reason="REFUND", dedupe_key="n1", event_at=t0 + timedelta(hours=1)
    )
    assert await apply_state("1000", "owned", dedupe_key="n2", event_at=t0 + timedelta(hours=2))
    # A second REFUND notification signed before the reversal arrives last.
    assert not await apply_state(
        "1000", "revoked", reason="REFUND", dedupe_key="n3", event_at=t0 + timedelta(minutes=90)
    )
    purchase = await purchase_row("1000")
    assert purchase.state == "owned" and purchase.revoked_at is None
    assert jwt_games(client, sid) == ["hearts"]
    stale = await count(
        PurchaseEvent, PurchaseEvent.kind == "stale_ignored", PurchaseEvent.dedupe_key == "n3"
    )
    assert stale == 1
    # And its redelivery is still a no-op.
    assert not await apply_state(
        "1000", "revoked", dedupe_key="n3", event_at=t0 + timedelta(hours=3)
    )
    assert (await purchase_row("1000")).state == "owned"


@pytest.mark.parametrize("platform", ["apple", "google"])
async def test_same_state_notification_advances_watermark_reversal_then_older_refund(
    client: TestClient,
    fake_apple: FakeAppleVerifier,
    fake_google: FakeGoogleVerifier,
    platform: str,
) -> None:
    """Codex P1 on #2871, for every store: REFUND_REVERSED at T2 on an owned
    purchase, then REFUND at T1 < T2, must not revoke."""
    sid = new_sid()
    key = f"wm-a-{platform}"
    if platform == "apple":
        fake_apple.answers[key] = verified(key)
        assert post_apple(client, sid, key).status_code == 200
    else:
        fake_google.answers[key] = verified(key, platform="google")
        assert post_google(client, sid, key).status_code == 200
    t0 = datetime.now(timezone.utc) + timedelta(minutes=1)

    async def apply(state: str, dedupe: str, at: datetime) -> bool:
        async with get_session_factory()() as db:
            return await purchase_service.apply_store_state(
                db,
                platform=platform,
                store_key=key,
                state=state,  # type: ignore[arg-type]
                dedupe_key=dedupe,
                event_at=at,
            )

    assert not await apply("owned", f"{key}-n2", t0 + timedelta(hours=2))  # same state
    row = await purchase_row(key)
    assert row.state == "owned"
    assert purchase_service._utc(row.state_changed_at) == t0 + timedelta(hours=2)
    assert not await apply("revoked", f"{key}-n1", t0 + timedelta(hours=1))  # older
    assert (await purchase_row(key)).state == "owned"
    assert jwt_games(client, sid) == ["hearts"]
    assert (
        await count(
            PurchaseEvent,
            PurchaseEvent.kind == "stale_ignored",
            PurchaseEvent.dedupe_key == f"{key}-n1",
        )
        == 1
    )
    # An older same-state event never moves the watermark back.
    assert not await apply("owned", f"{key}-n0", t0)
    assert purchase_service._utc((await purchase_row(key)).state_changed_at) == t0 + timedelta(
        hours=2
    )


@pytest.mark.parametrize("platform", ["apple", "google"])
async def test_same_state_notification_advances_watermark_refund_then_older_reversal(
    client: TestClient,
    fake_apple: FakeAppleVerifier,
    fake_google: FakeGoogleVerifier,
    platform: str,
) -> None:
    sid = new_sid()
    key = f"wm-b-{platform}"
    if platform == "apple":
        fake_apple.answers[key] = verified(key)
        assert post_apple(client, sid, key).status_code == 200
    else:
        fake_google.answers[key] = verified(key, platform="google")
        assert post_google(client, sid, key).status_code == 200
    t0 = datetime.now(timezone.utc) + timedelta(minutes=1)

    async def apply(state: str, dedupe: str, at: datetime) -> bool:
        async with get_session_factory()() as db:
            return await purchase_service.apply_store_state(
                db,
                platform=platform,
                store_key=key,
                state=state,  # type: ignore[arg-type]
                dedupe_key=dedupe,
                event_at=at,
            )

    assert await apply("revoked", f"{key}-r1", t0 + timedelta(hours=1))
    assert not await apply("revoked", f"{key}-r3", t0 + timedelta(hours=3))  # same, newer
    assert not await apply("owned", f"{key}-v2", t0 + timedelta(hours=2))  # older reversal
    assert (await purchase_row(key)).state == "revoked"
    assert jwt_games(client, sid) == []


async def test_same_state_client_post_does_not_advance_watermark(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    """A client answer's time may be only when verification started, so a
    same-state post must not hide a real store event signed just before it."""
    sid = new_sid()
    t0 = datetime.now(timezone.utc)
    fake_apple.answers["wm-c"] = verified("wm-c", event_at=t0)
    assert post_apple(client, sid, "wm-c").status_code == 200
    fake_apple.answers["wm-c"] = verified("wm-c", event_at=t0 + timedelta(hours=2))
    assert post_apple(client, sid, "wm-c").status_code == 200  # same state, later time
    assert purchase_service._utc((await purchase_row("wm-c")).state_changed_at) == t0
    assert await apply_state(
        "wm-c", "revoked", dedupe_key="wm-c-r", event_at=t0 + timedelta(hours=1)
    )
    assert jwt_games(client, sid) == []


async def test_stale_owned_answer_after_webhook_revoke_is_ignored(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    sid = new_sid()
    fake_apple.answers["1000"] = verified("1000")
    assert post_apple(client, sid, "1000").status_code == 200
    revoked_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    assert await apply_state("1000", "revoked", reason="REFUND", event_at=revoked_at)

    # The client's verifier read the store before the refund: its "owned"
    # (default event time = when verification started) loses.
    r = post_apple(client, sid, "1000")
    assert r.status_code == 200
    assert r.json()["status"] == "revoked" and token_games(r.json()) == []
    # An explicit store time older than the revoke loses too.
    fake_apple.answers["1000"] = verified("1000", event_at=revoked_at - timedelta(seconds=1))
    assert post_apple(client, sid, "1000").json()["status"] == "revoked"
    assert (await purchase_row("1000")).state == "revoked"
    assert await count(PurchaseEvent, PurchaseEvent.kind == "stale_ignored") == 2

    # A newer store answer (the refund was reversed) is applied.
    fake_apple.answers["1000"] = verified("1000", event_at=revoked_at + timedelta(seconds=1))
    assert post_apple(client, sid, "1000").json()["status"] == "owned"
    assert jwt_games(client, sid) == ["hearts"]


async def test_verified_event_time_orders_client_answers(
    client: TestClient, fake_google: FakeGoogleVerifier
) -> None:
    sid = new_sid()
    t0 = datetime(2026, 9, 1, tzinfo=timezone.utc)
    fake_google.answers["gtok"] = verified("gtok", platform="google", event_at=t0)
    assert post_google(client, sid, "gtok").status_code == 200
    stored = (await purchase_row("gtok")).state_changed_at
    assert purchase_service._utc(stored) == t0


@pytest.mark.parametrize(
    ("platform", "environment", "setting"),
    [
        ("apple", "test", None),  # not an Apple environment at all
        ("apple", "sandbox", "Production"),  # sandbox switched off
        ("google", "sandbox", None),
        ("google", "test", "production"),
    ],
)
async def test_environment_outside_allow_list_is_rejected_even_if_verified(
    client: TestClient,
    fake_apple: FakeAppleVerifier,
    fake_google: FakeGoogleVerifier,
    monkeypatch: pytest.MonkeyPatch,
    platform: str,
    environment: str,
    setting: str | None,
) -> None:
    var = "APPLE_IAP_ENVIRONMENTS" if platform == "apple" else "GOOGLE_PLAY_ENVIRONMENTS"
    if setting is None:
        monkeypatch.delenv(var, raising=False)
    else:
        monkeypatch.setenv(var, setting)
    answer = verified("k1", platform=platform, environment=environment)
    if platform == "apple":
        fake_apple.answers["k1"] = answer
        r = post_apple(client, new_sid(), "k1")
    else:
        fake_google.answers["k1"] = answer
        r = post_google(client, new_sid(), "k1")
    assert r.status_code == 422
    assert r.json()["detail"] == "environment_not_allowed"
    assert await count(Purchase) == 0 and await count(PurchaseLink) == 0


def test_allowed_environments_parsing(monkeypatch: pytest.MonkeyPatch) -> None:
    from purchases.verifiers import allowed_environments

    monkeypatch.delenv("APPLE_IAP_ENVIRONMENTS", raising=False)
    monkeypatch.delenv("GOOGLE_PLAY_ENVIRONMENTS", raising=False)
    assert allowed_environments("apple") == {"production", "sandbox"}
    assert allowed_environments("google") == {"production", "test"}
    monkeypatch.setenv("APPLE_IAP_ENVIRONMENTS", " Production , ")
    assert allowed_environments("apple") == {"production"}
    assert allowed_environments("amazon") == frozenset()


async def test_owned_never_regresses_to_pending(
    client: TestClient, fake_google: FakeGoogleVerifier, caplog: pytest.LogCaptureFixture
) -> None:
    sid = new_sid()
    fake_google.answers["gtok"] = verified("gtok", platform="google")
    assert post_google(client, sid, "gtok").json()["status"] == "owned"
    fake_google.answers["gtok"] = verified(
        "gtok", platform="google", state="pending", event_at=datetime.now(timezone.utc)
    )
    with caplog.at_level("WARNING", logger="audit"):
        r = post_google(client, sid, "gtok")
    assert r.status_code == 200 and r.json()["status"] == "owned"
    assert (await purchase_row("gtok")).state == "owned"
    assert jwt_games(client, sid) == ["hearts"]
    assert await count(PurchaseEvent, PurchaseEvent.kind == "regression_refused") == 1
    assert any("purchase_regression_refused" in rec.getMessage() for rec in caplog.records)


async def test_deleting_one_purchase_keeps_access_through_another(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    sid = new_sid()
    fake_apple.answers["own"] = verified("own")
    fake_apple.answers["family"] = verified("family", ownership_type="family_shared")
    assert post_apple(client, sid, "own").status_code == 200
    assert post_apple(client, sid, "family").status_code == 200
    own_id = (await purchase_row("own")).id
    family_id = (await purchase_row("family")).id
    assert (await entitlement(sid)).purchase_id == own_id

    async with get_session_factory()() as db:
        assert await purchase_service.delete_purchase(db, own_id)
    row = await entitlement(sid)
    assert row is not None and row.purchase_id == family_id
    assert jwt_games(client, sid) == ["hearts"]

    async with get_session_factory()() as db:
        assert await purchase_service.delete_purchase(db, family_id)
        assert not await purchase_service.delete_purchase(db, family_id)
    assert await entitlement(sid) is None
    assert jwt_games(client, sid) == []
    assert await count(PurchaseEvent, PurchaseEvent.kind == "deleted") == 2


async def test_foreign_key_sets_null_and_recompute_repairs_the_row(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    sid = new_sid()
    fake_apple.answers["own"] = verified("own")
    fake_apple.answers["family"] = verified("family", ownership_type="family_shared")
    assert post_apple(client, sid, "own").status_code == 200
    assert post_apple(client, sid, "family").status_code == 200
    own_id = (await purchase_row("own")).id
    family_id = (await purchase_row("family")).id
    async with get_session_factory()() as db:
        # A raw delete (not delete_purchase): the FK keeps the row, unpointed.
        await db.execute(Purchase.__table__.delete().where(Purchase.id == own_id))
        await db.commit()
    row = await entitlement(sid)
    assert row is not None and row.purchase_id is None and row.source != "legacy"
    async with get_session_factory()() as db:
        await purchase_service.recompute_entitlement(db, sid, "hearts")
        await db.commit()
    assert (await entitlement(sid)).purchase_id == family_id


async def test_delete_my_data_churn_cannot_reset_link_caps(
    client: TestClient, fake_apple: FakeAppleVerifier
) -> None:
    """Security review S1 (#2786): restore, DELETE /me, restore on a new install, repeat.

    DELETE /me removes the install's purchase_links, so the caps count the
    retained "linked" audit events instead.
    """
    from purchases.service import MAX_NEW_LINKS_PER_PURCHASE_PER_30D, MAX_SESSIONS_PER_PURCHASE

    fake_apple.answers["churn"] = verified("churn")

    def restore_then_erase(sid: str) -> int:
        status = post_apple(client, sid, "churn", source="restore").status_code
        assert client.delete("/me", headers={"X-Session-ID": sid}).status_code == 204
        return status

    first = [new_sid() for _ in range(MAX_NEW_LINKS_PER_PURCHASE_PER_30D)]
    assert [restore_then_erase(s) for s in first] == [200] * len(first)
    assert await count(PurchaseLink) == 0  # every link was erased
    r = post_apple(client, new_sid(), "churn", source="restore")
    assert r.status_code == 409 and r.json()["detail"] == "link_limit"

    # A returning install (same ID) is not a new session for either cap.
    assert post_apple(client, first[0], "churn", source="restore").status_code == 200
    assert client.delete("/me", headers={"X-Session-ID": first[0]}).status_code == 204

    # After the 30-day window, the lifetime cap still counts erased installs.
    await backdate_links(31)
    extra = MAX_SESSIONS_PER_PURCHASE - MAX_NEW_LINKS_PER_PURCHASE_PER_30D
    assert [restore_then_erase(new_sid()) for _ in range(extra)] == [200] * extra
    await backdate_links(31)
    r = post_apple(client, new_sid(), "churn", source="restore")
    assert r.status_code == 409 and r.json()["detail"] == "link_limit"
    assert await count(PurchaseEvent, PurchaseEvent.kind == "link_rejected") == 2

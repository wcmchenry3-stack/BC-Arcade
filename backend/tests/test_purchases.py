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
        environment="sandbox",
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
def client() -> Iterator[TestClient]:
    from main import app

    with TestClient(app) as c:
        yield c


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


def test_purchase_requires_session_header(client: TestClient) -> None:
    r = client.post(
        "/purchases/apple", json={"signed_transaction": make_jws("1"), "source": "sync"}
    )
    assert r.status_code == 400


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
            )
        )
        await db.commit()
    gid = _catalog_id(client, "twenty48")
    r = client.patch(
        f"/games/catalog/{gid}", json={"is_premium": True}, headers={"X-Admin-Token": _ADMIN}
    )
    assert r.status_code == 409

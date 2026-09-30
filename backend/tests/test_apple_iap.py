"""Real Apple verification, the ASSN v2 webhook and the history replay (#2786).

Every JWS here is signed by a throwaway test CA (``tests/apple_jws.py``) whose
root the verifier is told to trust; Apple's real root is only checked for its
pinned fingerprint. No network: online (OCSP) checks are off and the App Store
Server API is a fake at the client boundary.
"""

from __future__ import annotations

import asyncio
import base64
import json
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import jwt
import pytest
from appstoreserverlibrary.api_client import APIException
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from db.base import get_session_factory
from db.models import GameEntitlement, Purchase, PurchaseEvent, PurchaseLink
from entitlements import service as entitlements_service
from purchases import apple, apple_notifications, apple_store
from purchases.apple_notifications import (
    replay_notification_history,
    run_replay_loop,
)
from purchases.apple_store import AppleConfig, AppStoreVerifier, load_config
from purchases.router import APPLE_NOTIFICATION_IP_RATE_LIMIT
from purchases.verifiers import AppleEvidence, NotConfiguredAppleVerifier, PurchaseError
from tests.apple_jws import (
    APP_APPLE_ID,
    BUNDLE_ID,
    HEARTS,
    default_ca,
    make_ca,
    notification,
    now_ms,
    transaction,
)

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
def client() -> Iterator[TestClient]:
    from main import app

    with TestClient(app) as c:
        yield c


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


# ---------------------------------------------------------------------------
# Bundled Apple root and configuration
# ---------------------------------------------------------------------------


def test_bundled_apple_root_matches_pinned_fingerprint() -> None:
    [der] = apple_store.load_apple_root_certificates()
    from cryptography import x509

    cert = x509.load_der_x509_certificate(der)
    assert "Apple Root CA - G3" in cert.subject.rfc4514_string()
    assert cert.subject == cert.issuer


def test_tampered_root_file_is_refused(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    bad = tmp_path / "root.cer"
    bad.write_bytes(default_ca().root_der)
    monkeypatch.setattr(apple_store, "APPLE_ROOT_CA_G3_FILE", bad)
    with pytest.raises(RuntimeError):
        apple_store.load_apple_root_certificates()


_APPLE_VARS = (
    "APPLE_BUNDLE_ID",
    "APPLE_APP_ID",
    "APPLE_IAP_ENVIRONMENTS",
    "APPLE_IAP_ISSUER_ID",
    "APPLE_IAP_KEY_ID",
    "APPLE_IAP_PRIVATE_KEY",
    "APPLE_IAP_ONLINE_CHECKS",
)


@pytest.fixture()
def apple_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[pytest.MonkeyPatch]:
    for var in _APPLE_VARS:
        monkeypatch.delenv(var, raising=False)
    apple.reset_apple_verifier()
    yield monkeypatch
    apple.reset_apple_verifier()


def _pem_key() -> str:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


def test_config_missing_bundle_id_is_dormant(apple_env) -> None:
    assert load_config() is None
    assert apple.configured_verifier() is None
    assert isinstance(apple.get_apple_verifier(), NotConfiguredAppleVerifier)


def test_config_requires_app_id_when_production_allowed(apple_env) -> None:
    apple_env.setenv("APPLE_BUNDLE_ID", BUNDLE_ID)
    assert load_config() is None  # default environments include Production
    apple_env.setenv("APPLE_IAP_ENVIRONMENTS", "Sandbox")
    cfg = load_config()
    assert cfg is not None and cfg.environments == {"sandbox"} and cfg.app_apple_id is None
    apple_env.setenv("APPLE_APP_ID", "not-a-number")
    assert load_config() is None


def test_config_rejects_half_set_api_key_and_unknown_environments(apple_env) -> None:
    apple_env.setenv("APPLE_BUNDLE_ID", BUNDLE_ID)
    apple_env.setenv("APPLE_APP_ID", str(APP_APPLE_ID))
    apple_env.setenv("APPLE_IAP_KEY_ID", "KEY123")
    assert load_config() is None
    apple_env.delenv("APPLE_IAP_KEY_ID")
    apple_env.setenv("APPLE_IAP_ENVIRONMENTS", "Xcode,LocalTesting")
    assert load_config() is None


def test_config_full_builds_real_verifier_with_api(apple_env) -> None:
    apple_env.setenv("APPLE_BUNDLE_ID", BUNDLE_ID)
    apple_env.setenv("APPLE_APP_ID", str(APP_APPLE_ID))
    apple_env.setenv("APPLE_IAP_ISSUER_ID", "issuer")
    apple_env.setenv("APPLE_IAP_KEY_ID", "KEY123")
    apple_env.setenv("APPLE_IAP_PRIVATE_KEY", _pem_key().replace("\n", "\\n"))
    apple_env.setenv("APPLE_IAP_ONLINE_CHECKS", "false")
    cfg = load_config()
    assert cfg is not None and cfg.api is not None and cfg.online_checks is False
    v = apple.configured_verifier()
    assert isinstance(v, AppStoreVerifier)
    assert v.has_api and v.api_environments() == ["production", "sandbox"]
    assert apple.get_apple_verifier() is v  # cached


def test_config_with_unreadable_private_key_stays_dormant(apple_env) -> None:
    apple_env.setenv("APPLE_BUNDLE_ID", BUNDLE_ID)
    apple_env.setenv("APPLE_APP_ID", str(APP_APPLE_ID))
    apple_env.setenv("APPLE_IAP_ISSUER_ID", "issuer")
    apple_env.setenv("APPLE_IAP_KEY_ID", "KEY123")
    apple_env.setenv("APPLE_IAP_PRIVATE_KEY", "not a pem")
    assert apple.configured_verifier() is None


def test_dormant_config_keeps_both_routes_503(apple_env, client: TestClient) -> None:
    r = post_txn(client, str(uuid.uuid4()), signed_txn("3000"))
    assert r.status_code == 503 and r.json()["detail"] == "store_unavailable"
    r = post_note(client, signed_note("REFUND", signed_txn("3000")))
    assert r.status_code == 503 and r.json()["detail"] == "store_unavailable"


# ---------------------------------------------------------------------------
# POST /purchases/apple with real verification
# ---------------------------------------------------------------------------


async def test_valid_transaction_grants_and_sets_event_time(
    client: TestClient, verifier: AppStoreVerifier
) -> None:
    sid = str(uuid.uuid4())
    signed = now_ms(timedelta(minutes=-1))
    token = apple.expected_account_token(sid)
    r = post_txn(
        client, sid, signed_txn("4000", app_account_token=token, signed_date=signed), "purchase"
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "owned" and r.json()["finish"] is True
    assert jwt_games(client, sid) == ["hearts"]
    row = await purchase_row("4000")
    assert row is not None
    assert row.environment == "sandbox" and row.account_token == token
    assert row.store_transaction_id == "40009"
    changed = row.state_changed_at.replace(tzinfo=timezone.utc)
    assert abs(changed.timestamp() * 1000 - signed) < 2


async def test_bad_signature_is_422(client: TestClient, verifier: AppStoreVerifier) -> None:
    forged = tamper(signed_txn("4100"), productId=CASCADE)
    r = post_txn(client, str(uuid.uuid4()), forged)
    assert r.status_code == 422 and r.json()["detail"] == "verification_failed"
    assert (await purchase_row("4100")) is None


def test_chain_from_an_untrusted_root_is_422(client: TestClient, verifier) -> None:
    other = make_ca(name="Attacker")
    r = post_txn(client, str(uuid.uuid4()), other.sign(transaction("4200")))
    assert r.status_code == 422 and r.json()["detail"] == "verification_failed"


def test_trusted_intermediate_with_foreign_leaf_is_422(client: TestClient, verifier) -> None:
    # Leaf from another CA, intermediate + root from the trusted one.
    other = make_ca(name="Attacker")
    ca = default_ca()
    jws = other.sign(transaction("4210"), x5c=[other.x5c[0], ca.x5c[1], ca.x5c[2]])
    assert post_txn(client, str(uuid.uuid4()), jws).status_code == 422


@pytest.mark.parametrize(
    "x5c",
    [[], ["only-one"], None],
    ids=["empty", "short", "missing"],
)
def test_bad_x5c_header_is_422(client: TestClient, verifier, x5c) -> None:
    ca = default_ca()
    headers = {} if x5c is None else {"x5c": x5c}
    jws = jwt.encode(transaction("4220"), ca.leaf_key, algorithm="ES256", headers=headers)
    assert post_txn(client, str(uuid.uuid4()), jws).status_code == 422


def test_leaf_without_apple_marker_oid_is_422(client: TestClient, use_verifier) -> None:
    ca = make_ca(leaf_marker=False, name="NoMarker")
    use_verifier(make_verifier(roots=[ca.root_der]))
    assert post_txn(client, str(uuid.uuid4()), ca.sign(transaction("4230"))).status_code == 422


def test_leaf_expired_at_signed_date_is_422(client: TestClient, use_verifier) -> None:
    ca = make_ca(leaf_not_after=datetime.now(timezone.utc) - timedelta(hours=1), name="Old")
    use_verifier(make_verifier(roots=[ca.root_der]))
    assert post_txn(client, str(uuid.uuid4()), ca.sign(transaction("4240"))).status_code == 422


def test_non_es256_algorithm_is_422(client: TestClient, verifier) -> None:
    # alg confusion: an HMAC "signature" keyed with public data must not verify.
    ca = default_ca()
    jws = jwt.encode(transaction("4250"), "k" * 32, algorithm="HS256", headers={"x5c": ca.x5c})
    assert post_txn(client, str(uuid.uuid4()), jws).status_code == 422
    unsigned = jwt.encode(transaction("4251"), None, algorithm="none", headers={"x5c": ca.x5c})
    assert post_txn(client, str(uuid.uuid4()), unsigned).status_code == 422


def test_wrong_bundle_id_is_wrong_app(client: TestClient, verifier) -> None:
    r = post_txn(client, str(uuid.uuid4()), signed_txn("4300", bundle_id="com.example.other"))
    assert r.status_code == 422 and r.json()["detail"] == "wrong_app"


@pytest.mark.parametrize(
    "claims",
    [
        {"productId": "com.example.coins"},
        {"productId": "com.buffingchi.games.premium.yacht"},  # a free game
        {"type": "Consumable"},
    ],
    ids=["foreign", "free-game", "consumable"],
)
def test_unknown_product_is_422(client: TestClient, verifier, claims) -> None:
    r = post_txn(client, str(uuid.uuid4()), signed_txn("4400", **claims))
    assert r.status_code == 422 and r.json()["detail"] == "unknown_product"


async def test_sandbox_refused_when_only_production_allowed(
    client: TestClient, use_verifier
) -> None:
    use_verifier(make_verifier(envs=frozenset({"production"})))
    r = post_txn(client, str(uuid.uuid4()), signed_txn("4500", environment="Sandbox"))
    assert r.status_code == 422 and r.json()["detail"] == "environment_not_allowed"
    r = post_txn(client, str(uuid.uuid4()), signed_txn("4501", environment="Production"))
    assert r.status_code == 200 and r.json()["status"] == "owned"
    assert (await purchase_row("4501")).environment == "production"


@pytest.mark.parametrize("env", ["Xcode", "LocalTesting", None])
def test_unsigned_test_environments_are_never_accepted(client, verifier, env) -> None:
    # The library skips signature checks for Xcode/LocalTesting; we never build those verifiers.
    claims = {} if env is None else {"environment": env}
    jws = tamper(signed_txn("4600"), **claims) if env else signed_txn("4600", environment=None)
    r = post_txn(client, str(uuid.uuid4()), jws)
    assert r.status_code == 422 and r.json()["detail"] == "environment_not_allowed"


def test_payload_lying_about_environment_is_422(client: TestClient, verifier) -> None:
    # Signed as Sandbox, header of the payload edited to claim Production.
    jws = tamper(signed_txn("4700"), environment="Production")
    assert post_txn(client, str(uuid.uuid4()), jws).status_code == 422


async def test_revoked_transaction_says_revoked_and_grants_nothing(
    client: TestClient, verifier
) -> None:
    sid = str(uuid.uuid4())
    jws = signed_txn("4800", revocationDate=now_ms(), revocationReason=1)
    r = post_txn(client, sid, jws)
    assert r.status_code == 200
    assert r.json()["status"] == "revoked" and r.json()["finish"] is True
    assert jwt_games(client, sid) == []
    row = await purchase_row("4800")
    assert row.state == "revoked" and row.revocation_reason == "refund_app_issue"


async def test_family_revoke_and_family_shared_mapping(verifier: AppStoreVerifier) -> None:
    v = await verifier.verify(
        AppleEvidence(
            signed_txn(
                "4900",
                inAppOwnershipType="FAMILY_SHARED",
                revocationDate=now_ms(),
                revocationType="FAMILY_REVOKE",
            )
        )
    )
    assert v.ownership_type == "family_shared" and v.revocation_reason == "family_revoke"
    v = await verifier.verify(
        AppleEvidence(signed_txn("4901", revocationDate=now_ms(), revocationReason=0))
    )
    assert v.revocation_reason == "refund_other"
    v = await verifier.verify(AppleEvidence(signed_txn("4902", revocationDate=now_ms())))
    assert v.revocation_reason == "revoked"


async def test_apple_never_reports_pending(verifier: AppStoreVerifier) -> None:
    """Ask to Buy produces no JWS until approval (IAP.md §5); an approved one is owned."""
    v = await verifier.verify(AppleEvidence(signed_txn("4950", transactionReason="PURCHASE")))
    assert v.state == "owned"


async def test_missing_transaction_ids_fail_verification(verifier: AppStoreVerifier) -> None:
    _, txn = await verifier.decode_transaction(signed_txn("4960"))
    txn.originalTransactionId = None
    with pytest.raises(PurchaseError) as exc:
        verifier.to_verified("sandbox", txn)
    assert exc.value.detail == "verification_failed"


async def test_structurally_invalid_payload_fails(verifier: AppStoreVerifier) -> None:
    with pytest.raises(PurchaseError) as exc:
        await verifier.decode_transaction("a.b")
    assert exc.value.status_code == 400
    with pytest.raises(PurchaseError):
        await verifier.decode_transaction("a.!!!.c")
    bad = base64.urlsafe_b64encode(b"[1]").decode().rstrip("=")
    with pytest.raises(PurchaseError):
        await verifier.decode_transaction(f"a.{bad}.c")
    # Well-signed, but a field the library cannot structure.
    with pytest.raises(PurchaseError) as exc:
        await verifier.decode_transaction(signed_txn("4970", purchaseDate="soon"))
    assert exc.value.detail == "verification_failed"


# ---------------------------------------------------------------------------
# Get Transaction Info (optional App Store Server API)
# ---------------------------------------------------------------------------


def test_api_answer_is_authoritative(client: TestClient, use_verifier) -> None:
    api = FakeApiClient()
    use_verifier(make_verifier(api={"sandbox": api}))
    # The device's JWS says owned; Apple's server now says refunded.
    api.transactions["50009"] = signed_txn("5000", revocationDate=now_ms())
    sid = str(uuid.uuid4())
    r = post_txn(client, sid, signed_txn("5000"))
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    assert jwt_games(client, sid) == []


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (APIException(404, 4040010, "Transaction id not found."), 422),
        (APIException(400, 4000006, "Invalid transaction id."), 422),
        (APIException(404, 4040006, "Retryable."), 503),
        (APIException(401), 503),
        (APIException(500, 5000000, "err"), 503),
        (ConnectionError("down"), 503),
    ],
)
def test_api_errors_map_to_contract_codes(client, use_verifier, error, status) -> None:
    api = FakeApiClient(error=error)
    use_verifier(make_verifier(api={"sandbox": api}))
    assert post_txn(client, str(uuid.uuid4()), signed_txn("5100")).status_code == status


def test_api_answer_for_another_transaction_or_missing_is_refused(client, use_verifier) -> None:
    api = FakeApiClient()
    use_verifier(make_verifier(api={"sandbox": api}))
    api.transactions["52009"] = signed_txn("9999")
    assert post_txn(client, str(uuid.uuid4()), signed_txn("5200")).status_code == 422
    # No signedTransactionInfo in the answer.
    assert post_txn(client, str(uuid.uuid4()), signed_txn("5201")).status_code == 503


def test_retryable_verification_failure_is_503(client, verifier, monkeypatch) -> None:
    from appstoreserverlibrary.signed_data_verifier import (
        SignedDataVerifier,
        VerificationException,
        VerificationStatus,
    )

    def boom(self, jws):
        raise VerificationException(VerificationStatus.RETRYABLE_VERIFICATION_FAILURE)

    monkeypatch.setattr(SignedDataVerifier, "verify_and_decode_signed_transaction", boom)
    assert post_txn(client, str(uuid.uuid4()), signed_txn("5300")).status_code == 503


# ---------------------------------------------------------------------------
# POST /purchases/apple/notifications
# ---------------------------------------------------------------------------


def _grant(client: TestClient, key: str) -> str:
    sid = str(uuid.uuid4())
    assert post_txn(client, sid, signed_txn(key)).json()["status"] == "owned"
    return sid


async def test_refund_then_refund_reversed(client: TestClient, verifier) -> None:
    sid = _grant(client, "6000")
    refund = signed_note(
        "REFUND",
        signed_txn("6000", revocationDate=now_ms(), revocationReason=0),
        signed_date=now_ms(timedelta(minutes=1)),
    )
    r = post_note(client, refund)
    assert r.status_code == 200 and r.json() == {"status": "applied"}
    assert jwt_games(client, sid) == []
    row = await purchase_row("6000")
    assert row.state == "revoked" and row.revocation_reason == "refund_other"

    reversed_ = signed_note(
        "REFUND_REVERSED", signed_txn("6000"), signed_date=now_ms(timedelta(minutes=2))
    )
    assert post_note(client, reversed_).json() == {"status": "applied"}
    assert jwt_games(client, sid) == ["hearts"]


async def test_reversal_on_owned_purchase_then_older_refund_keeps_access(
    client: TestClient, verifier
) -> None:
    """Codex P1 on #2871: a same-state notification still advances the watermark."""
    sid = _grant(client, "6100")
    refund_t1 = signed_note(
        "REFUND",
        signed_txn("6100", revocationDate=now_ms()),
        signed_date=now_ms(timedelta(minutes=1)),
    )
    reversal_t2 = signed_note(
        "REFUND_REVERSED", signed_txn("6100"), signed_date=now_ms(timedelta(minutes=2))
    )
    # Out of order: the reversal (T2) arrives while the purchase is still owned,
    # then the refund it reversed (T1 < T2) arrives.
    assert post_note(client, reversal_t2).json() == {"status": "unchanged"}
    row = await purchase_row("6100")
    watermark = row.state_changed_at.replace(tzinfo=timezone.utc)
    assert abs(watermark.timestamp() * 1000 - now_ms(timedelta(minutes=2))) < 5_000
    assert post_note(client, refund_t1).json() == {"status": "unchanged"}  # stale
    assert (await purchase_row("6100")).state == "owned"
    assert jwt_games(client, sid) == ["hearts"]
    assert post_note(client, reversal_t2).json() == {"status": "unchanged"}  # duplicate
    # A genuinely newer refund still applies.
    refund_t3 = signed_note(
        "REFUND",
        signed_txn("6100", revocationDate=now_ms()),
        signed_date=now_ms(timedelta(minutes=3)),
    )
    assert post_note(client, refund_t3).json() == {"status": "applied"}
    assert jwt_games(client, sid) == []


async def test_newer_refund_on_revoked_purchase_then_older_reversal_stays_revoked(
    client: TestClient, verifier
) -> None:
    sid = _grant(client, "6150")
    refund_t1 = signed_note(
        "REFUND",
        signed_txn("6150", revocationDate=now_ms()),
        signed_date=now_ms(timedelta(minutes=1)),
    )
    reversal_t2 = signed_note(
        "REFUND_REVERSED", signed_txn("6150"), signed_date=now_ms(timedelta(minutes=2))
    )
    refund_t3 = signed_note(
        "REFUND",
        signed_txn("6150", revocationDate=now_ms()),
        signed_date=now_ms(timedelta(minutes=3)),
    )
    assert post_note(client, refund_t1).json() == {"status": "applied"}
    assert post_note(client, refund_t3).json() == {"status": "unchanged"}  # same state, newer
    assert post_note(client, reversal_t2).json() == {"status": "unchanged"}  # stale
    assert (await purchase_row("6150")).state == "revoked"
    assert jwt_games(client, sid) == []


async def test_one_time_charge_for_known_purchase_advances_watermark(
    client: TestClient, verifier
) -> None:
    """record_store_purchase (the unlinked path) follows the same watermark rule."""
    sid = _grant(client, "6170")
    charge_t2 = signed_note(
        "ONE_TIME_CHARGE", signed_txn("6170"), signed_date=now_ms(timedelta(minutes=2))
    )
    refund_t1 = signed_note(
        "REFUND",
        signed_txn("6170", revocationDate=now_ms()),
        signed_date=now_ms(timedelta(minutes=1)),
    )
    assert post_note(client, charge_t2).json() == {"status": "applied"}  # recorded
    assert post_note(client, refund_t1).json() == {"status": "unchanged"}  # stale
    assert jwt_games(client, sid) == ["hearts"]


async def test_duplicate_notification_is_a_noop(client: TestClient, verifier) -> None:
    sid = _grant(client, "6200")
    note = signed_note(
        "REVOKE", signed_txn("6200", revocationDate=now_ms(), revocationType="FAMILY_REVOKE")
    )
    assert post_note(client, note).json() == {"status": "applied"}
    assert post_note(client, note).json() == {"status": "unchanged"}
    assert jwt_games(client, sid) == []
    uuid_ = jwt.decode(note, options={"verify_signature": False})["notificationUUID"]
    assert (await count(PurchaseEvent, PurchaseEvent.dedupe_key == uuid_)) == 1


async def test_invalid_webhook_signature_is_4xx_and_logs_no_payload(
    client: TestClient, verifier, caplog: pytest.LogCaptureFixture
) -> None:
    _grant(client, "6300")
    forged = tamper(signed_note("REFUND", signed_txn("6300", revocationDate=now_ms())), version="3")
    r = post_note(client, forged)
    assert r.status_code == 422 and r.json()["detail"] == "verification_failed"
    assert (await purchase_row("6300")).state == "owned"
    assert forged not in caplog.text and "6300" not in caplog.text
    # Untrusted CA.
    other = make_ca(name="Attacker")
    r = post_note(client, other.sign(notification("REFUND", other.sign(transaction("6300")))))
    assert r.status_code == 422
    # A notification for another app.
    r = post_note(client, signed_note("REFUND", signed_txn("6300"), bundle_id="com.example.other"))
    assert r.status_code == 422 and r.json()["detail"] == "wrong_app"


def test_notification_with_forged_embedded_transaction_is_422(client, verifier) -> None:
    _grant(client, "6400")
    inner = tamper(signed_txn("6400"), revocationDate=now_ms())
    assert post_note(client, signed_note("REFUND", inner)).status_code == 422


def test_production_notification_needs_matching_app_apple_id(client, verifier) -> None:
    note = signed_note("TEST", None, environment="Production", app_apple_id=APP_APPLE_ID + 1)
    assert post_note(client, note).status_code == 422
    ok = signed_note("TEST", None, environment="Production")
    assert post_note(client, ok).json() == {"status": "test"}


@pytest.mark.parametrize(
    "ntype", ["CONSUMPTION_REQUEST", "REFUND_DECLINED", "DID_RENEW", "EXPIRED", "PRICE_INCREASE"]
)
def test_irrelevant_notifications_are_acknowledged(client, verifier, ntype) -> None:
    sid = _grant(client, "6500")
    r = post_note(client, signed_note(ntype, signed_txn("6500", revocationDate=now_ms())))
    assert r.status_code == 200 and r.json() == {"status": "ignored"}
    assert jwt_games(client, sid) == ["hearts"]


def test_notification_for_foreign_product_or_without_transaction_is_ignored(
    client, verifier
) -> None:
    r = post_note(client, signed_note("REFUND", signed_txn("6600", productId="com.example.x")))
    assert r.json() == {"status": "ignored"}
    r = post_note(client, signed_note("REFUND", signed_txn("6601", type="Consumable")))
    assert r.json() == {"status": "ignored"}
    r = post_note(client, signed_note("REFUND", None))
    assert r.json() == {"status": "ignored"}


def test_notification_environment_not_allowed_is_422(client, use_verifier) -> None:
    use_verifier(make_verifier(envs=frozenset({"production"})))
    r = post_note(client, signed_note("TEST", None))
    assert r.status_code == 422 and r.json()["detail"] == "environment_not_allowed"


def test_well_signed_but_unstructurable_notification_is_422(client, verifier) -> None:
    for body in (
        {**notification("TEST", None), "signedDate": "yesterday"},  # fails in the verifier
        notification("TEST", None, app_apple_id="abc"),  # type: ignore[arg-type] — model error
    ):
        r = post_note(client, default_ca().sign(body))
        assert r.status_code == 422 and r.json()["detail"] == "verification_failed"


def test_malformed_webhook_body_is_400(client, verifier) -> None:
    assert client.post("/purchases/apple/notifications", json={}).status_code == 400
    assert post_note(client, "not-a-jws").status_code == 400
    r = client.post("/purchases/apple/notifications", json={"signedPayload": "a" * 30_001})
    assert r.status_code == 400


def test_oversized_webhook_body_is_413(client, verifier) -> None:
    body = json.dumps({"signedPayload": "a" * 40_000})
    r = client.post(
        "/purchases/apple/notifications",
        content=body,
        headers={"Content-Type": "application/json", "Content-Length": str(len(body))},
    )
    assert r.status_code == 413


def test_webhook_is_rate_limited_per_ip(client, verifier) -> None:
    limit = int(APPLE_NOTIFICATION_IP_RATE_LIMIT.split("/")[0])
    note = signed_note("TEST", None)
    for _ in range(limit):
        assert post_note(client, note).status_code == 200
    assert post_note(client, note).status_code == 429


async def test_one_time_charge_records_without_linking(client, verifier) -> None:
    note = signed_note("ONE_TIME_CHARGE", signed_txn("6700"))
    assert post_note(client, note).json() == {"status": "applied"}
    row = await purchase_row("6700")
    assert row.state == "owned"
    assert (await count(PurchaseLink, PurchaseLink.purchase_id == row.id)) == 0
    assert (await count(GameEntitlement)) == 0
    assert post_note(client, note).json() == {"status": "unchanged"}
    # The client's later post links it as usual.
    sid = str(uuid.uuid4())
    assert post_txn(client, sid, signed_txn("6700")).json()["status"] == "owned"


async def test_refund_before_any_client_post_blocks_an_older_jws(client, verifier) -> None:
    old_jws = signed_txn("6800", signed_date=now_ms(timedelta(minutes=-10)))
    note = signed_note("REFUND", signed_txn("6800", revocationDate=now_ms()), signed_date=now_ms())
    assert post_note(client, note).json() == {"status": "applied"}
    assert (await purchase_row("6800")).state == "revoked"
    sid = str(uuid.uuid4())
    r = post_txn(client, sid, old_jws)
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    assert jwt_games(client, sid) == []


async def test_record_store_purchase_guards() -> None:
    from purchases import service
    from purchases.verifiers import VerifiedPurchase

    base = VerifiedPurchase(
        platform="apple",
        product_id=HEARTS,
        store_key="6900",
        transaction_id="69009",
        environment="sandbox",
        ownership_type="purchased",
        state="owned",
        purchased_at=None,
        account_token=None,
    )
    factory = get_session_factory()
    async with factory() as db:
        assert await service.record_store_purchase(db, base, dedupe_key="n-6900")
    async with factory() as db:
        assert not await service.record_store_purchase(db, base, dedupe_key="n-6900")
    from dataclasses import replace

    async with factory() as db:  # another product under the same store key
        assert not await service.record_store_purchase(
            db, replace(base, product_id=CASCADE), dedupe_key="n-6901"
        )
    async with factory() as db:  # free / unknown product
        assert not await service.record_store_purchase(
            db, replace(base, store_key="6902", product_id="com.example.x")
        )
    async with factory() as db:  # environment not allowed
        assert not await service.record_store_purchase(
            db, replace(base, store_key="6903", environment="test")
        )
    async with factory() as db:  # a state change on a known row recomputes
        assert await service.record_store_purchase(
            db, replace(base, state="revoked"), event_at=datetime.now(timezone.utc)
        )
    assert (await purchase_row("6900")).state == "revoked"


async def test_record_store_purchase_dedupe_race(monkeypatch) -> None:
    """A parallel delivery committing the same notification id first is a no-op."""
    from purchases import service
    from purchases.verifiers import VerifiedPurchase

    v = VerifiedPurchase(
        platform="apple",
        product_id=HEARTS,
        store_key="6950",
        transaction_id=None,
        environment="sandbox",
        ownership_type="purchased",
        state="owned",
        purchased_at=None,
        account_token=None,
    )
    calls = {"n": 0}
    real = service._dedupe_seen

    async def seen(db, key):
        calls["n"] += 1
        return calls["n"] > 1 or await real(db, key)

    monkeypatch.setattr(service, "_dedupe_seen", seen)
    async with get_session_factory()() as db:
        assert not await service.record_store_purchase(db, v, dedupe_key="race")
    assert await purchase_row("6950") is None

    async def never(db, key):
        return False

    monkeypatch.setattr(service, "_dedupe_seen", never)
    async with get_session_factory()() as db:
        assert await service.record_store_purchase(db, v, dedupe_key="dup")
    # Unique dedupe_key violation on commit rolls back to a no-op.
    async with get_session_factory()() as db:
        assert not await service.record_store_purchase(
            db, VerifiedPurchase(**{**v.__dict__, "store_key": "6951"}), dedupe_key="dup"
        )


# ---------------------------------------------------------------------------
# Notification-history replay
# ---------------------------------------------------------------------------


def _page(payloads: list[str | None], token: str | None, more: bool) -> SimpleNamespace:
    return SimpleNamespace(
        notificationHistory=[SimpleNamespace(signedPayload=p) for p in payloads],
        paginationToken=token,
        hasMore=more,
    )


async def test_replay_applies_missed_notifications(client: TestClient) -> None:
    api = FakeApiClient()
    v = make_verifier(api={"sandbox": api})
    apple._verifier = v
    try:
        api.transactions["70009"] = signed_txn("7000")  # Get Transaction Info
        sid = _grant(client, "7000")
        refund = signed_note(
            "REFUND",
            signed_txn("7000", revocationDate=now_ms()),
            signed_date=now_ms(timedelta(seconds=5)),
        )
        forged = tamper(signed_note("REFUND", signed_txn("7000")), version="9")
        api.pages = [
            _page([signed_note("TEST", None), None], "1", True),
            _page([refund, forged, refund], None, False),
        ]
        result = await replay_notification_history(v, get_session_factory())
        assert result is not None
        assert (result.fetched, result.applied, result.failed) == (4, 1, 1)
        assert jwt_games(client, sid) == []
        # Replaying again changes nothing (dedupe).
        again = await replay_notification_history(v, get_session_factory())
        assert again.applied == 0
    finally:
        apple.reset_apple_verifier()


async def test_replay_is_dormant_without_api_and_survives_api_errors() -> None:
    assert await replay_notification_history(None, get_session_factory()) is None
    assert await replay_notification_history(make_verifier(), get_session_factory()) is None
    api = FakeApiClient(error=APIException(500))
    result = await replay_notification_history(
        make_verifier(api={"sandbox": api, "production": api}), get_session_factory()
    )
    assert result.skipped_environments == 2 and result.fetched == 0


async def test_replay_loop_reports_failures_and_keeps_going(monkeypatch) -> None:
    """Deterministic: a fake sleep drives exactly three cycles, then cancels the loop."""
    calls = {"n": 0}
    sleeps: list[float] = []

    async def failing(*a, **kw):
        calls["n"] += 1
        raise RuntimeError("boom")

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        if len(sleeps) == 3:
            raise asyncio.CancelledError

    monkeypatch.setattr(apple_notifications, "replay_notification_history", failing)
    captured: list[BaseException] = []
    monkeypatch.setattr(
        apple_notifications.sentry_sdk, "capture_exception", lambda exc: captured.append(exc)
    )
    with pytest.raises(asyncio.CancelledError):
        await run_replay_loop(lambda: None, get_session_factory, interval_s=123.0, sleep=fake_sleep)
    assert calls["n"] == 3  # every failure was retried on the next cycle
    assert sleeps == [123.0, 123.0, 123.0]
    assert len(captured) == 3 and all(isinstance(e, RuntimeError) for e in captured)


async def test_lifespan_starts_replay_only_when_api_configured(monkeypatch) -> None:
    import main

    apple.reset_apple_verifier()
    assert main._start_apple_notification_replay() is None  # dormant
    started = asyncio.Event()

    async def fake_loop(get_verifier, get_factory):
        started.set()
        await asyncio.sleep(3600)

    monkeypatch.setattr(apple_notifications, "run_replay_loop", fake_loop)
    apple._verifier = make_verifier(api={"sandbox": FakeApiClient()})
    try:
        task = main._start_apple_notification_replay()
        assert task is not None
        await asyncio.wait_for(started.wait(), 30)
        await main._stop_apple_notification_replay(task)
        assert task.cancelled()
        await main._stop_apple_notification_replay(None)
        apple._verifier = make_verifier()  # no API → no task
        assert main._start_apple_notification_replay() is None
    finally:
        apple.reset_apple_verifier()


async def test_stop_replay_is_bounded(monkeypatch) -> None:
    import main

    monkeypatch.setattr(main, "RETENTION_STOP_TIMEOUT_SECONDS", 0.01)

    release = asyncio.Event()

    async def stubborn():
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            await release.wait()  # absorbs the first cancel

    task = asyncio.create_task(stubborn())
    await asyncio.sleep(0)
    await main._stop_apple_notification_replay(task)
    assert not task.done()
    release.set()
    await task

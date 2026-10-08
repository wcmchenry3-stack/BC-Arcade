"""Apple configuration and ``POST /purchases/apple`` verification (#2786).

Covers ``purchases/apple_store.py`` (bundled root, configuration and
misconfiguration reporting, JWS chain and claim checks, Get Transaction Info,
online OCSP checks) and ``purchases/apple.py``. Split out of
``test_apple_iap.py`` (#2955) along the store / notifications seam of #2998;
the harness lives in ``tests/_apple_iap_harness.py``.
"""

from __future__ import annotations

import base64
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from appstoreserverlibrary.api_client import APIException
from fastapi.testclient import TestClient

from purchases import _common, apple, apple_store
from purchases.apple_store import AppleConfig, AppStoreVerifier, load_config
from purchases.verifiers import AppleEvidence, NotConfiguredAppleVerifier, PurchaseError
from tests._apple_iap_harness import (
    BOTH,
    CASCADE,
    FakeApiClient,
    make_verifier,
    post_note,
    post_txn,
    purchase_row,
    signed_note,
    signed_txn,
    tamper,
)
from tests._helpers import StoreEnv, jwt_games
from tests.apple_jws import APP_APPLE_ID, BUNDLE_ID, default_ca, make_ca, now_ms, transaction

# Shared fixtures (apple_use_verifier, apple_verifier) come from the harness module.
pytest_plugins = ["tests._apple_iap_harness"]


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
def apple_env() -> Iterator[pytest.MonkeyPatch]:
    env = StoreEnv()  # setenv / delenv also rebuild the lazy store Settings
    for var in _APPLE_VARS:
        env.delenv(var, raising=False)
    apple.reset_apple_verifier()
    yield env
    apple.reset_apple_verifier()
    env.undo()


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
    client: TestClient, apple_verifier: AppStoreVerifier
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
    changed = row.state_changed_at.replace(tzinfo=UTC)
    assert abs(changed.timestamp() * 1000 - signed) < 2


async def test_bad_signature_is_422(client: TestClient, apple_verifier: AppStoreVerifier) -> None:
    forged = tamper(signed_txn("4100"), productId=CASCADE)
    r = post_txn(client, str(uuid.uuid4()), forged)
    assert r.status_code == 422 and r.json()["detail"] == "verification_failed"
    assert (await purchase_row("4100")) is None


def test_chain_from_an_untrusted_root_is_422(client: TestClient, apple_verifier) -> None:
    other = make_ca(name="Attacker")
    r = post_txn(client, str(uuid.uuid4()), other.sign(transaction("4200")))
    assert r.status_code == 422 and r.json()["detail"] == "verification_failed"


def test_trusted_intermediate_with_foreign_leaf_is_422(client: TestClient, apple_verifier) -> None:
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
def test_bad_x5c_header_is_422(client: TestClient, apple_verifier, x5c) -> None:
    ca = default_ca()
    headers = {} if x5c is None else {"x5c": x5c}
    jws = jwt.encode(transaction("4220"), ca.leaf_key, algorithm="ES256", headers=headers)
    assert post_txn(client, str(uuid.uuid4()), jws).status_code == 422


def test_leaf_without_apple_marker_oid_is_422(client: TestClient, apple_use_verifier) -> None:
    ca = make_ca(leaf_marker=False, name="NoMarker")
    apple_use_verifier(make_verifier(roots=[ca.root_der]))
    assert post_txn(client, str(uuid.uuid4()), ca.sign(transaction("4230"))).status_code == 422


def test_leaf_expired_at_signed_date_is_422(client: TestClient, apple_use_verifier) -> None:
    ca = make_ca(leaf_not_after=datetime.now(UTC) - timedelta(hours=1), name="Old")
    apple_use_verifier(make_verifier(roots=[ca.root_der]))
    assert post_txn(client, str(uuid.uuid4()), ca.sign(transaction("4240"))).status_code == 422


def test_non_es256_algorithm_is_422(client: TestClient, apple_verifier) -> None:
    # alg confusion: an HMAC "signature" keyed with public data must not verify.
    ca = default_ca()
    jws = jwt.encode(transaction("4250"), "k" * 32, algorithm="HS256", headers={"x5c": ca.x5c})
    assert post_txn(client, str(uuid.uuid4()), jws).status_code == 422
    unsigned = jwt.encode(transaction("4251"), None, algorithm="none", headers={"x5c": ca.x5c})
    assert post_txn(client, str(uuid.uuid4()), unsigned).status_code == 422


def test_wrong_bundle_id_is_wrong_app(client: TestClient, apple_verifier) -> None:
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
def test_unknown_product_is_422(client: TestClient, apple_verifier, claims) -> None:
    r = post_txn(client, str(uuid.uuid4()), signed_txn("4400", **claims))
    assert r.status_code == 422 and r.json()["detail"] == "unknown_product"


async def test_sandbox_refused_when_only_production_allowed(
    client: TestClient, apple_use_verifier
) -> None:
    apple_use_verifier(make_verifier(envs=frozenset({"production"})))
    r = post_txn(client, str(uuid.uuid4()), signed_txn("4500", environment="Sandbox"))
    assert r.status_code == 422 and r.json()["detail"] == "environment_not_allowed"
    r = post_txn(client, str(uuid.uuid4()), signed_txn("4501", environment="Production"))
    assert r.status_code == 200 and r.json()["status"] == "owned"
    assert (await purchase_row("4501")).environment == "production"


@pytest.mark.parametrize("env", ["Xcode", "LocalTesting", None])
def test_unsigned_test_environments_are_never_accepted(client, apple_verifier, env) -> None:
    # The library skips signature checks for Xcode/LocalTesting; we never build those verifiers.
    claims = {} if env is None else {"environment": env}
    jws = tamper(signed_txn("4600"), **claims) if env else signed_txn("4600", environment=None)
    r = post_txn(client, str(uuid.uuid4()), jws)
    assert r.status_code == 422 and r.json()["detail"] == "environment_not_allowed"


def test_payload_lying_about_environment_is_422(client: TestClient, apple_verifier) -> None:
    # Signed as Sandbox, header of the payload edited to claim Production.
    jws = tamper(signed_txn("4700"), environment="Production")
    assert post_txn(client, str(uuid.uuid4()), jws).status_code == 422


async def test_revoked_transaction_says_revoked_and_grants_nothing(
    client: TestClient, apple_verifier
) -> None:
    sid = str(uuid.uuid4())
    jws = signed_txn("4800", revocationDate=now_ms(), revocationReason=1)
    r = post_txn(client, sid, jws)
    assert r.status_code == 200
    assert r.json()["status"] == "revoked" and r.json()["finish"] is True
    assert jwt_games(client, sid) == []
    row = await purchase_row("4800")
    assert row.state == "revoked" and row.revocation_reason == "refund_app_issue"


async def test_family_revoke_and_family_shared_mapping(apple_verifier: AppStoreVerifier) -> None:
    v = await apple_verifier.verify(
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
    v = await apple_verifier.verify(
        AppleEvidence(signed_txn("4901", revocationDate=now_ms(), revocationReason=0))
    )
    assert v.revocation_reason == "refund_other"
    v = await apple_verifier.verify(AppleEvidence(signed_txn("4902", revocationDate=now_ms())))
    assert v.revocation_reason == "revoked"


async def test_apple_never_reports_pending(apple_verifier: AppStoreVerifier) -> None:
    """Ask to Buy produces no JWS until approval (IAP.md §5); an approved one is owned."""
    v = await apple_verifier.verify(AppleEvidence(signed_txn("4950", transactionReason="PURCHASE")))
    assert v.state == "owned"


async def test_missing_transaction_ids_fail_verification(apple_verifier: AppStoreVerifier) -> None:
    _, txn = await apple_verifier.decode_transaction(signed_txn("4960"))
    txn.originalTransactionId = None
    with pytest.raises(PurchaseError) as exc:
        apple_verifier.to_verified("sandbox", txn)
    assert exc.value.detail == "verification_failed"


async def test_structurally_invalid_payload_fails(apple_verifier: AppStoreVerifier) -> None:
    with pytest.raises(PurchaseError) as exc:
        await apple_verifier.decode_transaction("a.b")
    assert exc.value.status_code == 400
    with pytest.raises(PurchaseError):
        await apple_verifier.decode_transaction("a.!!!.c")
    bad = base64.urlsafe_b64encode(b"[1]").decode().rstrip("=")
    with pytest.raises(PurchaseError):
        await apple_verifier.decode_transaction(f"a.{bad}.c")
    # Well-signed, but a field the library cannot structure.
    with pytest.raises(PurchaseError) as exc:
        await apple_verifier.decode_transaction(signed_txn("4970", purchaseDate="soon"))
    assert exc.value.detail == "verification_failed"


# ---------------------------------------------------------------------------
# Get Transaction Info (optional App Store Server API)
# ---------------------------------------------------------------------------


def test_api_answer_is_authoritative(client: TestClient, apple_use_verifier) -> None:
    api = FakeApiClient()
    apple_use_verifier(make_verifier(api={"sandbox": api}))
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
def test_api_errors_map_to_contract_codes(client, apple_use_verifier, error, status) -> None:
    api = FakeApiClient(error=error)
    apple_use_verifier(make_verifier(api={"sandbox": api}))
    assert post_txn(client, str(uuid.uuid4()), signed_txn("5100")).status_code == status


def test_api_answer_for_another_transaction_or_missing_is_refused(
    client, apple_use_verifier
) -> None:
    api = FakeApiClient()
    apple_use_verifier(make_verifier(api={"sandbox": api}))
    api.transactions["52009"] = signed_txn("9999")
    assert post_txn(client, str(uuid.uuid4()), signed_txn("5200")).status_code == 422
    # No signedTransactionInfo in the answer.
    assert post_txn(client, str(uuid.uuid4()), signed_txn("5201")).status_code == 503


def test_retryable_verification_failure_is_503(client, apple_verifier, monkeypatch) -> None:
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
# Online (OCSP) checks — the production default
# ---------------------------------------------------------------------------


def _online_verifier(ca) -> AppStoreVerifier:
    cfg = AppleConfig(
        bundle_id=BUNDLE_ID,
        app_apple_id=APP_APPLE_ID,
        environments=BOTH,  # type: ignore[arg-type]
        online_checks=True,
        api=None,
    )
    return AppStoreVerifier(cfg, root_certificates=[ca.root_der])


@pytest.fixture(scope="module")
def ocsp_ca():
    return make_ca(name="OCSP", ocsp_url="http://ocsp.test.invalid/ocsp")


@pytest.mark.parametrize(
    ("status", "http", "detail"),
    [
        ("good", 200, None),
        ("revoked", 422, "verification_failed"),
        ("http_error", 503, "store_unavailable"),
        ("unreachable", 503, "store_unavailable"),
    ],
)
def test_online_checks_consult_ocsp(
    client, apple_use_verifier, monkeypatch, ocsp_ca, status, http, detail
) -> None:
    from appstoreserverlibrary import signed_data_verifier

    from tests.apple_jws import ocsp_responder

    responder = ocsp_responder(ocsp_ca, status=status)
    monkeypatch.setattr(signed_data_verifier.requests, "post", responder)
    apple_use_verifier(_online_verifier(ocsp_ca))
    r = post_txn(client, str(uuid.uuid4()), ocsp_ca.sign(transaction(f"ocsp-{status}")))
    assert r.status_code == http, r.text
    if detail:
        assert r.json()["detail"] == detail
    else:
        assert r.json()["status"] == "owned"
        leaf, inter = ocsp_ca.chain[0][0], ocsp_ca.chain[1][0]
        # Both certificates were checked: intermediate first, then the leaf.
        assert responder.seen == [inter.serial_number, leaf.serial_number]


def test_online_checks_ignore_a_backdated_signed_date(
    client, apple_use_verifier, monkeypatch
) -> None:
    """With online checks on, validity is checked now, not at the JWS's signedDate."""
    from appstoreserverlibrary import signed_data_verifier

    from tests.apple_jws import ocsp_responder

    ca = make_ca(
        name="Expired",
        ocsp_url="http://ocsp.test.invalid/ocsp",
        leaf_not_after=datetime.now(UTC) - timedelta(hours=1),
    )
    monkeypatch.setattr(signed_data_verifier.requests, "post", ocsp_responder(ca))
    apple_use_verifier(_online_verifier(ca))
    backdated = ca.sign(transaction("ocsp-old", signed_date=now_ms(timedelta(days=-1, hours=1))))
    assert post_txn(client, str(uuid.uuid4()), backdated).status_code == 422


# ---------------------------------------------------------------------------
# Review follow-ups: misconfiguration reporting, production online checks, replay
# ---------------------------------------------------------------------------


@pytest.fixture()
def sentry_messages(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    messages: list[str] = []
    monkeypatch.setattr(
        _common.sentry_sdk, "capture_message", lambda msg, level=None: messages.append(msg)
    )
    return messages


def _configure(env: pytest.MonkeyPatch, **extra: str) -> None:
    env.setenv("APPLE_BUNDLE_ID", BUNDLE_ID)
    env.setenv("APPLE_APP_ID", str(APP_APPLE_ID))
    for key, value in extra.items():
        env.setenv(key, value)
    apple.reset_apple_verifier()  # a client fixture may have cached the dormant answer


def test_online_checks_off_is_refused_in_production(apple_env, sentry_messages) -> None:
    _configure(apple_env, APPLE_IAP_ONLINE_CHECKS="off", ENVIRONMENT="production")
    assert load_config() is None
    assert sentry_messages == ["apple_iap_misconfigured: online_checks_off_in_production"]
    apple_env.setenv("ENVIRONMENT", "development")
    cfg = load_config()
    assert cfg is not None and cfg.online_checks is False
    apple_env.delenv("APPLE_IAP_ONLINE_CHECKS")
    apple_env.setenv("ENVIRONMENT", "production")
    cfg = load_config()
    assert cfg is not None and cfg.online_checks is True


def test_set_but_broken_config_reports_reason_only(
    apple_env, sentry_messages, client: TestClient
) -> None:
    secret = "-----BEGIN PRIVATE KEY-----\nnot-really-a-key\n-----END PRIVATE KEY-----"
    _configure(
        apple_env,
        APPLE_IAP_ISSUER_ID="issuer",
        APPLE_IAP_KEY_ID="KEY123",
        APPLE_IAP_PRIVATE_KEY=secret,
    )
    assert apple.configured_verifier() is None
    assert sentry_messages == ["apple_iap_misconfigured: init"]
    assert all("not-really" not in m and "KEY123" not in m for m in sentry_messages)
    r = post_txn(client, str(uuid.uuid4()), signed_txn("7900"))
    assert r.status_code == 503 and r.json()["detail"] == "store_unavailable"


@pytest.mark.parametrize(
    ("extra", "reason"),
    [
        ({"APPLE_IAP_KEY_ID": "KEY123"}, "api_key"),
        ({"APPLE_APP_ID": "12a"}, "app_id"),
        ({"APPLE_IAP_ENVIRONMENTS": "Xcode"}, "environments"),
    ],
)
def test_half_set_config_is_reported(apple_env, sentry_messages, extra, reason) -> None:
    _configure(apple_env, **extra)
    assert apple.configured_verifier() is None
    assert sentry_messages == [f"apple_iap_misconfigured: {reason}"]


def test_missing_root_certificate_is_reported(
    apple_env, sentry_messages, monkeypatch, tmp_path
) -> None:
    _configure(apple_env)
    monkeypatch.setattr(apple_store, "APPLE_ROOT_CA_G3_FILE", tmp_path / "missing.cer")
    assert apple.configured_verifier() is None
    assert sentry_messages == ["apple_iap_misconfigured: root_certificate"]


def test_unset_bundle_id_is_quietly_dormant(apple_env, sentry_messages) -> None:
    assert apple.configured_verifier() is None
    assert sentry_messages == []

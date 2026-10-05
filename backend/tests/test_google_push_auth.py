"""Google RTDN push authentication: OIDC bearer, JWKS cache and key rotation (#2787).

Follows the planned ``purchases/google_push_auth.py`` (#2998): ``GoogleJwks``
and ``PushAuthenticator`` in ``purchases/google_notifications.py`` today.
Split out of ``test_google_iap.py`` (#2955); the harness lives in
``tests/_google_iap_harness.py``.
"""

from __future__ import annotations

import jwt
import pytest

from purchases import google_notifications
from purchases.google_notifications import GoogleJwks
from purchases.verifiers import PurchaseError
from tests._google_iap_harness import (
    grant,
    post_rtdn,
    row,
    rtdn_raw,
)
from tests._helpers import jwt_games
from tests.google_play_fakes import (
    AUDIENCE,
    PUSH_SA,
    FakeJwks,
    alg_none_token,
    developer_notification,
    hs256_with_public_key_token,
    jwk_for,
    oidc_token,
)

# Shared fixtures (google_gp) come from the harness module.
pytest_plugins = ["tests._google_iap_harness"]


# ---------------------------------------------------------------------------
# RTDN push authentication
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "authorization",
    [
        None,
        "",
        "Basic dXNlcjpwYXNz",
        "Bearer ",
        "Bearer not-a-jwt",
        "Bearer " + "a" * 5000,
    ],
)
def test_rtdn_without_valid_bearer_is_401(client, google_gp, authorization) -> None:
    headers = {} if authorization is None else {"Authorization": authorization}
    # The body is not even parsed: an invalid body still gets 401, not 400.
    r = rtdn_raw(client, headers, b"not json")
    assert r.status_code == 401 and r.json()["detail"] == "unauthorized"
    assert r.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(
    "make",
    [
        lambda: alg_none_token(),
        lambda: hs256_with_public_key_token(),
        lambda: oidc_token(aud="https://someone-else.example/push"),
        lambda: oidc_token(iss="https://evil.example"),
        lambda: oidc_token(exp=1_000_000_000, iat=999_999_000),
        lambda: oidc_token(exp=None),
        lambda: oidc_token(iat=None),
        lambda: oidc_token(key_name="attacker"),  # right kid, wrong key
        lambda: oidc_token(kid="unknown-kid"),
        lambda: jwt.encode(
            {"iss": "https://accounts.google.com"},
            "secret",
            algorithm="HS256",
            headers={"kid": "x"},
        ),
    ],
    ids=[
        "alg_none",
        "hs256_alg_confusion",
        "wrong_audience",
        "wrong_issuer",
        "expired",
        "no_exp",
        "no_iat",
        "wrong_key",
        "unknown_kid",
        "hs256",
    ],
)
async def test_rtdn_forged_tokens_are_401_and_apply_nothing(client, google_gp, make) -> None:
    session, token = grant(client, google_gp)
    note = developer_notification(voided={"purchaseToken": token, "productType": 2})
    r = post_rtdn(client, note, bearer=make())
    assert r.status_code == 401
    assert (await row(token)).state == "owned"
    assert jwt_games(client, session) == ["hearts"]


def test_rtdn_es256_header_is_401(client, google_gp) -> None:
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    bad = jwt.encode({"aud": AUDIENCE}, key, algorithm="ES256", headers={"kid": "test-kid-1"})
    assert post_rtdn(client, developer_notification(test=True), bearer=bad).status_code == 401
    # RS256 by a Google key, but no kid to pick it by.
    from tests.google_play_fakes import oidc_claims, private_pem

    no_kid = jwt.encode(oidc_claims(), private_pem("google-oidc"), algorithm="RS256")
    assert post_rtdn(client, developer_notification(test=True), bearer=no_kid).status_code == 401


@pytest.mark.parametrize(
    "claims", [{"email": "someone@evil.example"}, {"email_verified": False}, {"email": None}]
)
def test_rtdn_token_from_other_service_account_is_403(client, google_gp, claims) -> None:
    r = post_rtdn(client, developer_notification(test=True), bearer=oidc_token(**claims))
    assert r.status_code == 403 and r.json()["detail"] == "forbidden"


def test_rtdn_accepts_legacy_issuer_and_case_insensitive_email(client, google_gp) -> None:
    bearer = oidc_token(iss="accounts.google.com", email=PUSH_SA.upper())
    r = post_rtdn(client, developer_notification(test=True), bearer=bearer)
    assert r.status_code == 200 and r.json() == {"status": "test"}


def test_rtdn_jwks_unreachable_is_503(client, google_gp) -> None:
    google_gp.jwks.fail = True
    r = post_rtdn(client, developer_notification(test=True))
    assert r.status_code == 503


async def test_jwks_network_error_fails_closed() -> None:
    import httpx

    def boom(request):
        raise httpx.ConnectError("down", request=request)

    jwks = GoogleJwks(httpx.MockTransport(boom))
    with pytest.raises(PurchaseError) as exc:
        await jwks.key("test-kid-1")
    assert exc.value.status_code == 503
    bad_json = GoogleJwks(httpx.MockTransport(lambda r: httpx.Response(200, text="<html>")))
    with pytest.raises(PurchaseError):
        await bad_json.key("test-kid-1")


async def test_jwks_cache_refresh_and_filtering() -> None:
    fake = FakeJwks(
        keys=[
            {"kty": "EC", "kid": "ec"},
            {**jwk_for("google-oidc", "hs"), "alg": "HS256"},
            {**jwk_for("google-oidc", "enc"), "use": "enc"},
            {**jwk_for("google-oidc"), "kid": None},
            {"kty": "RSA", "kid": "broken", "n": "!!", "e": "AQAB"},
            "not-a-dict",
            jwk_for("google-oidc"),
        ]
    )
    clock = [0.0]
    jwks = GoogleJwks(fake.transport(), clock=lambda: clock[0])
    assert await jwks.key("test-kid-1") is not None
    assert fake.calls == 1
    for kid in ("ec", "hs", "enc", "broken"):
        assert await jwks.key(kid) is None
    assert fake.calls == 1  # an unknown kid does not refetch within JWKS_MIN_REFRESH_S
    clock[0] += google_notifications.JWKS_MIN_REFRESH_S
    assert await jwks.key("rotated") is None
    assert fake.calls == 2  # ... but does after it
    clock[0] += google_notifications.JWKS_TTL_S
    await jwks.key("test-kid-1")
    assert fake.calls == 3  # expired cache refetches


async def test_jwks_outage_backs_off_and_serves_stale_keys_for_a_grace_period() -> None:
    """Review S3: a failed fetch is retried at most every 60 s, and the last good
    keys keep verifying for up to 24 h past their TTL while Google is unreachable."""
    fake = FakeJwks()
    clock = [0.0]
    jwks = GoogleJwks(fake.transport(), clock=lambda: clock[0])
    assert await jwks.key("test-kid-1") is not None
    fake.fail = True
    clock[0] += google_notifications.JWKS_TTL_S  # expired
    assert await jwks.key("test-kid-1") is not None  # refresh failed; stale key served
    assert fake.calls == 2
    for _ in range(50):  # junk kids and repeats during the outage: no refetch
        assert await jwks.key("junk") is None
        assert await jwks.key("test-kid-1") is not None
    assert fake.calls == 2
    clock[0] += google_notifications.JWKS_RETRY_BACKOFF_S
    await jwks.key("test-kid-1")
    assert fake.calls == 3  # retried once the backoff passed
    # Past TTL + grace with Google still down: fail closed.
    clock[0] = google_notifications.JWKS_TTL_S + google_notifications.JWKS_STALE_GRACE_S
    with pytest.raises(PurchaseError) as exc:
        await jwks.key("test-kid-1")
    assert exc.value.status_code == 503
    # Inside the backoff with no usable keys: still 503, without a fetch.
    calls = fake.calls
    with pytest.raises(PurchaseError):
        await jwks.key("test-kid-1")
    assert fake.calls == calls
    # Google comes back: recovers after the backoff.
    fake.fail = False
    clock[0] += google_notifications.JWKS_RETRY_BACKOFF_S
    assert await jwks.key("test-kid-1") is not None


async def test_rtdn_key_rotation_is_picked_up(client, google_gp) -> None:
    google_gp.jwks.keys = [jwk_for("google-oidc"), jwk_for("rotated", "kid-2")]
    # First use loads the JWKS; a token signed by the new key verifies.
    bearer = oidc_token(key_name="rotated", kid="kid-2")
    assert post_rtdn(client, developer_notification(test=True), bearer=bearer).status_code == 200

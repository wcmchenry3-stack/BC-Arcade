"""Real Google Play verification, the RTDN webhook, the voided poll and acknowledgement (#2787).

Google is mocked at the HTTP transport layer (``tests/google_play_fakes.py``):
the real google-auth token exchange (signed with a throwaway service-account
key), the real Play Developer API client and the real OIDC verification run
against fakes. No network, no real time: sleeps and clocks are injected.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from db.base import get_session_factory
from db.models import GameEntitlement, Purchase, PurchaseEvent, PurchaseLink
from entitlements import service as entitlements_service
from purchases import google, google_notifications, google_play
from purchases import service as purchase_service
from purchases.google_notifications import (
    GoogleJwks,
    GoogleRuntime,
    acknowledge_sweep,
    build_runtime,
    poll_voided_purchases,
    run_google_jobs,
    run_google_jobs_loop,
)
from purchases.google_play import PENDING_EVENT_AT, load_config, to_verified
from purchases.router import GOOGLE_NOTIFICATION_IP_RATE_LIMIT
from purchases.verifiers import GoogleEvidence, NotConfiguredGoogleVerifier, PurchaseError
from tests.google_play_fakes import (
    ACCESS_TOKEN,
    AUDIENCE,
    CASCADE,
    HEARTS,
    PACKAGE,
    PUSH_SA,
    FakeJwks,
    FakePlay,
    FakeTokenEndpoint,
    alg_none_token,
    developer_notification,
    hs256_with_public_key_token,
    jwk_for,
    make_config,
    ms,
    oidc_token,
    play_purchase,
    push_body,
    service_account_info,
    voided_page,
    voided_record,
)


def NOW() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------


@dataclass
class Harness:
    runtime: GoogleRuntime
    play: FakePlay
    tokens: FakeTokenEndpoint
    jwks: FakeJwks
    sleeps: list[float] = field(default_factory=list)
    clock: list[float] = field(default_factory=lambda: [1_000.0])

    @property
    def verifier(self):
        return self.runtime.verifier


def make_harness(envs: frozenset[str] = frozenset({"production", "test"})) -> Harness:
    play, tokens, jwks = FakePlay(), FakeTokenEndpoint(), FakeJwks()
    sleeps: list[float] = []
    clock = [1_000.0]

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    runtime = build_runtime(
        make_config(envs),
        play_transport=play.transport(),
        token_transport=tokens.transport(),
        jwks_transport=jwks.transport(),
        sleep=fake_sleep,
        clock=lambda: clock[0],
    )
    return Harness(runtime, play, tokens, jwks, sleeps, clock)


@pytest.fixture()
def client() -> Iterator[TestClient]:
    from main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def install() -> Iterator:
    def _install(h: Harness) -> Harness:
        google._runtime = h.runtime
        return h

    yield _install
    google.reset_google_runtime()


@pytest.fixture()
def gp(install) -> Harness:
    return install(make_harness())


def tok() -> str:
    return "gp-" + uuid.uuid4().hex + uuid.uuid4().hex


def sid() -> str:
    return str(uuid.uuid4())


def hdr(session: str) -> dict[str, str]:
    return {"X-Session-ID": session, "Content-Type": "application/json"}


def post_google(client, session, token, source="sync", product=HEARTS):
    return client.post(
        "/purchases/google",
        json={"product_id": product, "purchase_token": token, "source": source},
        headers=hdr(session),
    )


def post_rtdn(client, note, *, bearer: str | None = None, message_id: str | None = None):
    return client.post(
        "/purchases/google/notifications",
        json=push_body(note, message_id),
        headers={"Authorization": f"Bearer {bearer or oidc_token()}"},
    )


def jwt_games(client, session) -> list[str]:
    r = client.get("/entitlements", headers=hdr(session))
    assert r.status_code == 200
    pub = entitlements_service.get_public_key_pem()
    return jwt.decode(r.json()["token"], pub, algorithms=["RS256"])["entitled_games"]


async def row(token: str) -> Purchase | None:
    async with get_session_factory()() as db:
        return (
            await db.execute(select(Purchase).where(Purchase.store_key == token))
        ).scalar_one_or_none()


async def count(model, *where) -> int:
    async with get_session_factory()() as db:
        return (
            await db.execute(select(func.count()).select_from(model).where(*where))
        ).scalar_one()


def utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def grant(client, h: Harness, token: str | None = None, **kw) -> tuple[str, str]:
    token = token or tok()
    h.play.purchases[token] = play_purchase(**kw)
    session = sid()
    r = post_google(client, session, token)
    assert r.status_code == 200, r.text
    return session, token


# ---------------------------------------------------------------------------
# Configuration (dormant by default)
# ---------------------------------------------------------------------------

_GOOGLE_VARS = (
    "GOOGLE_PLAY_PACKAGE_NAME",
    "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
    "GOOGLE_PLAY_ENVIRONMENTS",
    "GOOGLE_RTDN_AUDIENCE",
    "GOOGLE_RTDN_PUSH_SA",
)


@pytest.fixture()
def google_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[pytest.MonkeyPatch]:
    for var in _GOOGLE_VARS:
        monkeypatch.delenv(var, raising=False)
    google.reset_google_runtime()
    yield monkeypatch
    google.reset_google_runtime()


@pytest.fixture()
def sentry_messages(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    messages: list[str] = []
    monkeypatch.setattr(
        google_play.sentry_sdk, "capture_message", lambda msg, level=None: messages.append(msg)
    )
    return messages


def _full_env(env: pytest.MonkeyPatch, **overrides: str) -> None:
    values = {
        "GOOGLE_PLAY_PACKAGE_NAME": PACKAGE,
        "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON": json.dumps(service_account_info()),
        "GOOGLE_RTDN_AUDIENCE": AUDIENCE,
        "GOOGLE_RTDN_PUSH_SA": PUSH_SA,
    }
    values.update(overrides)
    for key, value in values.items():
        if value:
            env.setenv(key, value)
        else:
            env.delenv(key, raising=False)
    google.reset_google_runtime()


def test_unset_package_is_quietly_dormant(google_env, sentry_messages) -> None:
    assert load_config() is None
    assert google.configured_runtime() is None
    assert isinstance(google.get_google_verifier(), NotConfiguredGoogleVerifier)
    assert sentry_messages == []


def test_full_config_builds_runtime(google_env, sentry_messages) -> None:
    _full_env(google_env, GOOGLE_PLAY_ENVIRONMENTS="production")
    cfg = load_config()
    assert cfg is not None and cfg.environments == {"production"}
    assert "private_key" not in repr(cfg)  # the key never reaches a repr or a log
    runtime = google.configured_runtime()
    assert runtime is not None and google.get_google_verifier() is runtime.verifier
    assert google.configured_runtime() is runtime  # cached
    assert sentry_messages == []


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"GOOGLE_PLAY_SERVICE_ACCOUNT_JSON": ""}, "service_account_missing"),
        ({"GOOGLE_PLAY_SERVICE_ACCOUNT_JSON": "{not json"}, "service_account"),
        ({"GOOGLE_PLAY_SERVICE_ACCOUNT_JSON": '["x"]'}, "service_account"),
        (
            {"GOOGLE_PLAY_SERVICE_ACCOUNT_JSON": json.dumps(service_account_info(type="user"))},
            "service_account",
        ),
        (
            {"GOOGLE_PLAY_SERVICE_ACCOUNT_JSON": json.dumps(service_account_info(private_key=""))},
            "service_account",
        ),
        (
            {
                "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON": json.dumps(
                    service_account_info(token_uri="https://evil.example/token")
                )
            },
            "service_account",
        ),
        ({"GOOGLE_RTDN_AUDIENCE": ""}, "rtdn_audience"),
        ({"GOOGLE_RTDN_PUSH_SA": ""}, "rtdn_push_sa"),
        ({"GOOGLE_RTDN_PUSH_SA": "not-an-email"}, "rtdn_push_sa"),
        ({"GOOGLE_PLAY_PACKAGE_NAME": "not a package"}, "package_name"),
        ({"GOOGLE_PLAY_ENVIRONMENTS": "sandbox"}, "environments"),
    ],
)
def test_half_set_config_stays_dormant_and_reports_reason_only(
    google_env, sentry_messages, overrides, reason
) -> None:
    _full_env(google_env, **overrides)
    assert google.configured_runtime() is None
    assert sentry_messages == [f"google_play_misconfigured: {reason}"]
    # Never a value: no key material, no email, no JSON.
    assert "PRIVATE" not in sentry_messages[0] and "@" not in sentry_messages[0]


def test_unreadable_private_key_stays_dormant(google_env, sentry_messages) -> None:
    _full_env(
        google_env,
        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON=json.dumps(service_account_info(private_key="garbage")),
    )
    assert google.configured_runtime() is None
    assert sentry_messages == ["google_play_misconfigured: init"]


def test_dormant_keeps_both_google_routes_503(google_env, client: TestClient) -> None:
    r = post_google(client, sid(), tok())
    assert r.status_code == 503 and r.json()["detail"] == "store_unavailable"
    r = post_rtdn(client, developer_notification(test=True))
    assert r.status_code == 503 and r.json()["detail"] == "store_unavailable"
    # Half-set is dormant too.
    google_env.setenv("GOOGLE_PLAY_PACKAGE_NAME", PACKAGE)
    google.reset_google_runtime()
    assert post_google(client, sid(), tok()).status_code == 503
    assert post_rtdn(client, developer_notification(test=True)).status_code == 503


# ---------------------------------------------------------------------------
# POST /purchases/google with real verification
# ---------------------------------------------------------------------------


async def test_valid_owned_purchase_grants_acknowledges_and_uses_store_time(
    client: TestClient, gp: Harness
) -> None:
    session, token = sid(), tok()
    completed = NOW() - timedelta(minutes=3)
    gp.play.purchases[token] = play_purchase(
        account=google.expected_account_token(session), completed=completed
    )
    r = post_google(client, session, token, source="purchase")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["status"], body["game_slug"], body["finish"]) == ("owned", "hearts", True)
    assert jwt_games(client, session) == ["hearts"]
    # Acknowledged server-side after persistence, and recorded.
    assert gp.play.ack_calls == [(HEARTS, token)]
    purchase = await row(token)
    assert purchase.acknowledged_at is not None
    assert (purchase.environment, purchase.store_transaction_id) == (
        "production",
        "GPA.1234-5678-9012-34567",
    )
    assert purchase.account_token == google.expected_account_token(session)
    # event_at / purchased_at come from Play's purchaseCompletionTime.
    assert abs(utc(purchase.state_changed_at) - completed) < timedelta(milliseconds=2)
    assert abs(utc(purchase.purchased_at) - completed) < timedelta(milliseconds=2)
    # google-auth minted one token (cached), for the androidpublisher scope only.
    assert gp.tokens.calls == 1
    assert gp.tokens.assertions[0]["scope"] == "https://www.googleapis.com/auth/androidpublisher"
    assert gp.play.auth_headers == {f"Bearer {ACCESS_TOKEN}"}
    # Re-post: idempotent, no second acknowledgement.
    assert post_google(client, session, token).status_code == 200
    assert gp.play.ack_calls == [(HEARTS, token)]
    assert gp.tokens.calls == 1


async def test_already_acknowledged_purchase_is_not_reacknowledged(
    client: TestClient, gp: Harness
) -> None:
    _, token = grant(client, gp, acknowledged=True)
    assert gp.play.ack_calls == []
    assert (await row(token)).acknowledged_at is not None


async def test_pending_records_without_grant_then_completes(
    client: TestClient, gp: Harness
) -> None:
    session, token = sid(), tok()
    gp.play.purchases[token] = play_purchase(state="PENDING")
    r = post_google(client, session, token)
    assert r.status_code == 200
    assert (r.json()["status"], r.json()["finish"]) == ("pending", False)
    assert jwt_games(client, session) == []
    assert gp.play.ack_calls == []
    purchase = await row(token)
    assert purchase.state == "pending"
    assert utc(purchase.state_changed_at) == PENDING_EVENT_AT
    assert await count(PurchaseLink, PurchaseLink.purchase_id == purchase.id) == 0
    # Completed a moment ago: applies whatever our clock said at the pending post.
    gp.play.purchases[token] = play_purchase(completed=NOW() - timedelta(seconds=1))
    r = post_google(client, session, token)
    assert r.json()["status"] == "owned"
    assert jwt_games(client, session) == ["hearts"]
    assert gp.play.ack_calls == [(HEARTS, token)]


async def test_cancelled_before_completion_is_422_and_recorded_cancelled(
    client: TestClient, gp: Harness
) -> None:
    token = tok()
    gp.play.purchases[token] = play_purchase(state="CANCELLED", never_completed=True)
    r = post_google(client, sid(), token)
    assert r.status_code == 422 and r.json()["detail"] == "verification_failed"
    assert (await row(token)).state == "cancelled"


async def test_completed_then_cancelled_is_revoked_and_removes_access(
    client: TestClient, gp: Harness
) -> None:
    session, token = grant(client, gp)
    gp.play.purchases[token] = play_purchase(state="CANCELLED")
    r = post_google(client, session, token)
    assert r.status_code == 200
    assert (r.json()["status"], r.json()["finish"]) == ("revoked", True)
    assert jwt_games(client, session) == []
    purchase = await row(token)
    assert (purchase.state, purchase.revocation_reason) == ("revoked", "voided")


def test_token_for_another_package_or_unknown_is_422(client: TestClient, gp: Harness) -> None:
    # The package is bound into the request path; Play answers 404 for a token
    # that is not this app's (the fake has no purchase under that token).
    r = post_google(client, sid(), tok())
    assert r.status_code == 422 and r.json()["detail"] == "verification_failed"
    assert all(PACKAGE in p for p in [gp.play.PREFIX])


@pytest.mark.parametrize(
    ("play", "detail"),
    [
        (play_purchase(product="com.other.app.gems"), "unknown_product"),
        (play_purchase(rent=True), "unknown_product"),
        (play_purchase(product=CASCADE), "verification_failed"),  # not what the client named
        (play_purchase(items=[]), "verification_failed"),
        (play_purchase(quantity=2), "verification_failed"),
        (play_purchase(consumed=True), "verification_failed"),
        (play_purchase(state="PURCHASE_STATE_UNSPECIFIED"), "verification_failed"),
    ],
)
def test_bad_purchases_are_refused(client: TestClient, gp: Harness, play, detail) -> None:
    token = tok()
    gp.play.purchases[token] = play
    r = post_google(client, sid(), token)
    assert r.status_code == 422 and r.json()["detail"] == detail
    assert gp.play.ack_calls == []  # never acknowledged, never consumed


def test_free_or_unknown_catalog_product_is_unknown_product(
    client: TestClient, gp: Harness
) -> None:
    token = tok()
    free = "com.buffingchi.games.premium.sudoku"  # follows the convention, not is_premium
    gp.play.purchases[token] = play_purchase(product=free)
    r = post_google(client, sid(), token, product=free)
    assert r.status_code == 422 and r.json()["detail"] == "unknown_product"
    # A product off the convention never reaches Play.
    calls = len(gp.play.get_calls)
    r = post_google(client, sid(), tok(), product="com.buffingchi.games.coins")
    assert r.status_code == 422 and r.json()["detail"] == "unknown_product"
    assert len(gp.play.get_calls) == calls


async def test_verifier_rejects_off_catalog_product_before_store_call(gp: Harness) -> None:
    with pytest.raises(PurchaseError) as exc:
        await gp.verifier.verify(GoogleEvidence("com.other.product", tok()))
    assert exc.value.detail == "unknown_product" and gp.play.get_calls == []


async def test_ownership_is_enforced_only_for_source_purchase(
    client: TestClient, gp: Harness
) -> None:
    session, token = sid(), tok()
    gp.play.purchases[token] = play_purchase(account=google.expected_account_token(sid()))
    r = post_google(client, session, token, source="purchase")
    assert r.status_code == 403 and r.json()["detail"] == "ownership_mismatch"
    missing = tok()
    gp.play.purchases[missing] = play_purchase(account=None)
    assert post_google(client, session, missing, source="purchase").status_code == 403
    # The same verified purchase restores to another install (the capped transfer rule).
    assert post_google(client, session, token, source="restore").status_code == 200
    assert jwt_games(client, session) == ["hearts"]
    # Upper-case hex from the store still matches.
    upper = tok()
    gp.play.purchases[upper] = play_purchase(account=google.expected_account_token(session).upper())
    assert post_google(client, session, upper, source="purchase").status_code == 200


async def test_environment_allow_list(client: TestClient, install) -> None:
    h = install(make_harness(frozenset({"production"})))
    token = tok()
    h.play.purchases[token] = play_purchase(test=True)
    r = post_google(client, sid(), token)
    assert r.status_code == 422 and r.json()["detail"] == "environment_not_allowed"
    assert await row(token) is None
    # Licence-tester purchases are "test" when allowed.
    h2 = install(make_harness())
    h2.play.purchases[token] = play_purchase(test=True)
    assert post_google(client, sid(), token).status_code == 200
    assert (await row(token)).environment == "test"


async def test_service_rechecks_environment_allow_list(
    client: TestClient, gp: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = tok()
    gp.play.purchases[token] = play_purchase(test=True)
    monkeypatch.setenv("GOOGLE_PLAY_ENVIRONMENTS", "production")
    r = post_google(client, sid(), token)
    assert r.status_code == 422 and r.json()["detail"] == "environment_not_allowed"


@pytest.mark.parametrize("error", [401, 403, 429, 500, 503, "network", "not-json", "not-object"])
def test_play_api_errors_are_503(client: TestClient, gp: Harness, error, caplog) -> None:
    token = tok()
    gp.play.purchases[token] = play_purchase()
    gp.play.get_errors.append(error)
    with caplog.at_level(logging.WARNING, logger="audit"):
        r = post_google(client, sid(), token)
    assert r.status_code == 503 and r.json()["detail"] == "store_unavailable"
    if error in (401, 403):
        assert "google_play_auth_failed" in caplog.text
    assert token not in caplog.text


def test_token_endpoint_failure_is_503(client: TestClient, gp: Harness, caplog) -> None:
    gp.tokens.fail = True
    token = tok()
    gp.play.purchases[token] = play_purchase()
    with caplog.at_level(logging.WARNING, logger="audit"):
        r = post_google(client, sid(), token)
    assert r.status_code == 503
    assert "google_play_token_failed" in caplog.text
    assert gp.play.get_calls == []


def test_http_auth_request_maps_network_errors() -> None:
    import google.auth.exceptions
    import httpx

    def boom(request):
        raise httpx.ConnectError("down", request=request)

    request = google_play.HttpxAuthRequest(httpx.Client(transport=httpx.MockTransport(boom)))
    with pytest.raises(google.auth.exceptions.TransportError):
        request("https://oauth2.googleapis.com/token", method="POST", body=b"x")
    ok = google_play.HttpxAuthRequest(
        httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, text="{}")))
    )
    response = ok("https://oauth2.googleapis.com/token")
    assert (response.status, response.data, response.headers["content-length"]) == (200, b"{}", "2")


def test_to_verified_normalization_edges() -> None:
    envs = frozenset({"production", "test"})
    v = to_verified("t", play_purchase(order=None, account=None), environments=envs)
    assert v.transaction_id is None and v.account_token is None and v.acknowledged is False
    v = to_verified("t", play_purchase(state="PENDING"), environments=envs)
    assert (v.state, v.event_at, v.purchased_at) == ("pending", PENDING_EVENT_AT, None)
    v = to_verified("t", play_purchase(quantity=None), environments=envs)
    assert v.state == "owned"
    bad_offer = play_purchase(items=[{"productId": HEARTS, "productOfferDetails": ["x"]}])
    with pytest.raises(PurchaseError):
        to_verified("t", bad_offer, environments=envs)
    with pytest.raises(PurchaseError):
        to_verified("t", play_purchase(items=["x"]), environments=envs)
    assert google_play.parse_rfc3339("2026-09-30T12:00:00") is None  # no zone
    assert google_play.parse_rfc3339("nonsense") is None
    assert google_play.parse_millis("abc") is None
    assert google_play.parse_millis(True) is None
    assert google_play.parse_millis("0") is None
    assert google_play.parse_millis(str(10**30)) is None


# ---------------------------------------------------------------------------
# Acknowledgement
# ---------------------------------------------------------------------------


async def test_ack_retries_transient_errors_then_succeeds(client: TestClient, gp: Harness) -> None:
    gp.play.ack_errors += [500, "network"]
    _, token = grant(client, gp)
    assert len(gp.play.ack_calls) == 3
    assert gp.sleeps == list(google_play.ACK_BACKOFF_S)
    assert (await row(token)).acknowledged_at is not None


async def test_ack_failure_keeps_grant_for_the_sweep(client: TestClient, gp: Harness) -> None:
    gp.play.ack_errors += [503, 503, 503]
    session, token = grant(client, gp)
    assert jwt_games(client, session) == ["hearts"]
    assert (await row(token)).acknowledged_at is None
    # The sweep picks it up.
    result = await acknowledge_sweep(gp.verifier, get_session_factory())
    assert result.acknowledged >= 1
    assert (await row(token)).acknowledged_at is not None


async def test_ack_is_idempotent_when_play_says_already_acknowledged(gp: Harness) -> None:
    token = tok()
    gp.play.purchases[token] = play_purchase(acknowledged=True)
    await gp.verifier.acknowledge(GoogleEvidence(HEARTS, token))  # 400 → re-read → acknowledged
    gp.play.purchases[token] = play_purchase(state="CANCELLED")
    with pytest.raises(PurchaseError) as exc:
        await gp.verifier.acknowledge(GoogleEvidence(HEARTS, token))
    assert exc.value.detail == "verification_failed"


async def test_ack_sweep_scope(client: TestClient, gp: Harness) -> None:
    fresh = grant(client, gp)[1]
    old = grant(client, gp, completed=NOW() - timedelta(days=10))[1]
    gone = grant(client, gp)[1]
    async with get_session_factory()() as db:
        await db.execute(
            update(Purchase)
            .where(Purchase.store_key.in_([fresh, old, gone]))
            .values(acknowledged_at=None)
        )
        await db.execute(update(Purchase).where(Purchase.store_key == gone).values(state="revoked"))
        await db.commit()
    for t in (fresh, old):
        gp.play.purchases[t]["acknowledgementState"] = "ACKNOWLEDGEMENT_STATE_PENDING"
    gp.play.ack_calls.clear()
    result = await acknowledge_sweep(gp.verifier, get_session_factory())
    swept = {t for _, t in gp.play.ack_calls}
    assert fresh in swept and old not in swept and gone not in swept
    assert (await row(fresh)).acknowledged_at is not None
    assert result.failed == 0
    # Repeating finds nothing new for this purchase.
    gp.play.ack_calls.clear()
    await acknowledge_sweep(gp.verifier, get_session_factory())
    assert fresh not in {t for _, t in gp.play.ack_calls}


async def test_ack_sweep_counts_failures(client: TestClient, gp: Harness) -> None:
    token = grant(client, gp)[1]
    async with get_session_factory()() as db:
        await db.execute(
            update(Purchase).where(Purchase.store_key == token).values(acknowledged_at=None)
        )
        await db.commit()
    gp.play.purchases[token] = play_purchase(state="CANCELLED")  # Play refuses; not acknowledged
    result = await acknowledge_sweep(gp.verifier, get_session_factory())
    assert result.failed >= 1
    assert (await row(token)).acknowledged_at is None
    assert await acknowledge_sweep(None, get_session_factory()) is None


# ---------------------------------------------------------------------------
# RTDN push authentication
# ---------------------------------------------------------------------------


def _rtdn_raw(client, headers: dict, content: bytes = b"{}"):
    return client.post("/purchases/google/notifications", content=content, headers=headers)


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
def test_rtdn_without_valid_bearer_is_401(client, gp, authorization) -> None:
    headers = {} if authorization is None else {"Authorization": authorization}
    # The body is not even parsed: an invalid body still gets 401, not 400.
    r = _rtdn_raw(client, headers, b"not json")
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
async def test_rtdn_forged_tokens_are_401_and_apply_nothing(client, gp, make) -> None:
    session, token = grant(client, gp)
    note = developer_notification(voided={"purchaseToken": token, "productType": 2})
    r = post_rtdn(client, note, bearer=make())
    assert r.status_code == 401
    assert (await row(token)).state == "owned"
    assert jwt_games(client, session) == ["hearts"]


def test_rtdn_es256_header_is_401(client, gp) -> None:
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
def test_rtdn_token_from_other_service_account_is_403(client, gp, claims) -> None:
    r = post_rtdn(client, developer_notification(test=True), bearer=oidc_token(**claims))
    assert r.status_code == 403 and r.json()["detail"] == "forbidden"


def test_rtdn_accepts_legacy_issuer_and_case_insensitive_email(client, gp) -> None:
    bearer = oidc_token(iss="accounts.google.com", email=PUSH_SA.upper())
    r = post_rtdn(client, developer_notification(test=True), bearer=bearer)
    assert r.status_code == 200 and r.json() == {"status": "test"}


def test_rtdn_jwks_unreachable_is_503(client, gp) -> None:
    gp.jwks.fail = True
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


async def test_rtdn_key_rotation_is_picked_up(client, gp) -> None:
    gp.jwks.keys = [jwk_for("google-oidc"), jwk_for("rotated", "kid-2")]
    # First use loads the JWKS; a token signed by the new key verifies.
    bearer = oidc_token(key_name="rotated", kid="kid-2")
    assert post_rtdn(client, developer_notification(test=True), bearer=bearer).status_code == 200


# ---------------------------------------------------------------------------
# RTDN handling
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "note",
    [
        developer_notification(subscription=True),
        developer_notification(package="com.other.app", test=True),
        developer_notification(one_time=(3, "x")),
        developer_notification(one_time=(1, "")),
        developer_notification(voided={"purchaseToken": "x", "productType": 1}),
        developer_notification(voided={"purchaseToken": "x", "productType": 2, "refundType": 2}),
        developer_notification(),
    ],
    ids=[
        "subscription",
        "other_package",
        "unknown_type",
        "no_token",
        "voided_sub",
        "partial",
        "empty",
    ],
)
def test_authenticated_but_irrelevant_messages_are_200_ignored(client, gp, note) -> None:
    r = post_rtdn(client, note)
    assert r.status_code == 200 and r.json() == {"status": "ignored"}
    assert gp.play.get_calls == []


def test_test_notification(client, gp) -> None:
    r = post_rtdn(client, developer_notification(test=True))
    assert r.status_code == 200 and r.json() == {"status": "test"}


@pytest.mark.parametrize(
    "body",
    [
        b"not json",
        b"[]",
        json.dumps({"message": "x"}).encode(),
        json.dumps({"message": {"data": "e30="}}).encode(),  # no messageId
        json.dumps({"message": {"messageId": "1"}}).encode(),  # no data
        json.dumps({"message": {"messageId": "1", "data": "%%%"}}).encode(),
        json.dumps({"message": {"messageId": "1", "data": "WyJ4Il0="}}).encode(),  # ["x"]
        json.dumps({"message": {"messageId": "1" * 200, "data": "e30="}}).encode(),
    ],
)
def test_malformed_push_after_auth_is_400(client, gp, body) -> None:
    r = _rtdn_raw(
        client,
        {"Authorization": f"Bearer {oidc_token()}", "Content-Type": "application/json"},
        body,
    )
    assert r.status_code == 400 and r.json()["detail"] == "invalid_request"


async def test_purchased_notification_records_unlinked_and_acknowledges(client, gp) -> None:
    token = tok()
    gp.play.purchases[token] = play_purchase()
    event = NOW() - timedelta(minutes=1)
    r = post_rtdn(client, developer_notification(one_time=(1, token), event_at=event))
    assert r.json() == {"status": "applied"}
    purchase = await row(token)
    assert purchase.state == "owned" and purchase.acknowledged_at is not None
    assert await count(PurchaseLink, PurchaseLink.purchase_id == purchase.id) == 0  # grants nothing
    assert gp.play.ack_calls == [(HEARTS, token)]
    # A client posting it later links normally.
    session = sid()
    assert post_google(client, session, token).status_code == 200
    assert jwt_games(client, session) == ["hearts"]


async def test_purchased_notification_ack_failure_leaves_it_for_the_sweep(client, gp) -> None:
    token = tok()
    gp.play.purchases[token] = play_purchase()
    gp.play.ack_errors += [500, 500, 500]
    r = post_rtdn(client, developer_notification(one_time=(1, token)))
    assert r.status_code == 200
    assert (await row(token)).acknowledged_at is None


async def test_notification_claims_are_not_trusted(client, gp) -> None:
    # PURCHASED, but Play says pending: record pending, no grant, no acknowledgement.
    token = tok()
    gp.play.purchases[token] = play_purchase(state="PENDING")
    assert post_rtdn(client, developer_notification(one_time=(1, token))).status_code == 200
    assert (await row(token)).state == "pending" and gp.play.ack_calls == []
    # CANCELED, but Play still says purchased: nothing changes.
    session, owned = grant(client, gp)
    r = post_rtdn(client, developer_notification(one_time=(2, owned)))
    assert r.json() == {"status": "unconfirmed"}
    assert (await row(owned)).state == "owned" and jwt_games(client, session) == ["hearts"]
    # VOIDED, but Play says purchased and the Voided Purchases API does not list it.
    gp.play.voided_pages = [voided_page([])]
    r = post_rtdn(client, developer_notification(voided={"purchaseToken": owned, "productType": 2}))
    assert r.json() == {"status": "unconfirmed"}
    assert jwt_games(client, session) == ["hearts"]
    # A token Play does not know is ignored.
    r = post_rtdn(client, developer_notification(one_time=(1, tok())))
    assert r.json() == {"status": "ignored"}


async def test_canceled_pending_purchase_is_marked_cancelled(client, gp) -> None:
    token = tok()
    gp.play.purchases[token] = play_purchase(state="PENDING")
    assert post_google(client, sid(), token).json()["status"] == "pending"
    gp.play.purchases[token] = play_purchase(state="CANCELLED", never_completed=True)
    r = post_rtdn(client, developer_notification(one_time=(2, token)))
    assert r.json() == {"status": "applied"}
    assert (await row(token)).state == "cancelled"
    # For a purchase no client posted, the cancellation is recorded.
    other = tok()
    gp.play.purchases[other] = play_purchase(state="CANCELLED", never_completed=True)
    assert (
        post_rtdn(client, developer_notification(one_time=(2, other))).json()["status"] == "applied"
    )
    assert (await row(other)).state == "cancelled"


async def test_voided_notification_revokes_every_linked_session(client, gp) -> None:
    session, token = grant(client, gp)
    other = sid()
    assert post_google(client, other, token, source="restore").status_code == 200
    gp.play.purchases[token] = play_purchase(state="CANCELLED")
    event = NOW()
    r = post_rtdn(
        client,
        developer_notification(voided={"purchaseToken": token, "productType": 2}, event_at=event),
    )
    assert r.json() == {"status": "applied"}
    assert jwt_games(client, session) == [] and jwt_games(client, other) == []
    purchase = await row(token)
    assert purchase.state == "revoked"
    assert abs(utc(purchase.state_changed_at) - event) < timedelta(milliseconds=2)
    # Links are kept (support can see who had it).
    assert await count(PurchaseLink, PurchaseLink.purchase_id == purchase.id) == 2


async def test_voided_notification_confirmed_by_voided_api_when_purchase_read_lags(
    client, gp
) -> None:
    session, token = grant(client, gp)
    gp.play.voided_pages = [
        voided_page([voided_record("someone-else", NOW())], "1"),
        voided_page([voided_record(token, NOW(), reason=7)]),
    ]
    r = post_rtdn(client, developer_notification(voided={"purchaseToken": token, "productType": 2}))
    assert r.json() == {"status": "applied"}
    assert jwt_games(client, session) == []
    assert (await row(token)).revocation_reason == "voided_chargeback"
    # The lookup window starts shortly before the event and never beyond 30 days.
    start = int(gp.play.voided_calls[0]["startTime"])
    assert int(ms(NOW() - timedelta(days=30))) < start <= int(ms(NOW()))


async def test_voided_notification_for_unknown_purchase_records_it_revoked(client, gp) -> None:
    token = tok()
    gp.play.purchases[token] = play_purchase(state="CANCELLED")
    r = post_rtdn(client, developer_notification(voided={"purchaseToken": token, "productType": 2}))
    assert r.json() == {"status": "applied"}
    assert (await row(token)).state == "revoked"
    # A token Play cannot read, not listed as voided either: nothing to apply.
    gone = tok()
    gp.play.voided_pages = [voided_page([voided_record(gone, NOW())])]
    r = post_rtdn(client, developer_notification(voided={"purchaseToken": gone, "productType": 2}))
    assert r.json() == {"status": "ignored"}
    assert await row(gone) is None


async def test_voided_for_known_purchase_that_play_no_longer_reads(client, gp) -> None:
    session, token = grant(client, gp)
    del gp.play.purchases[token]  # Play 404s the token now
    gp.play.voided_pages = [voided_page([voided_record(token, NOW(), reason=0)])]
    r = post_rtdn(client, developer_notification(voided={"purchaseToken": token, "productType": 2}))
    assert r.json() == {"status": "applied"}
    assert jwt_games(client, session) == []


def test_play_outage_during_rtdn_is_503_so_pubsub_retries(client, gp) -> None:
    token = tok()
    gp.play.purchases[token] = play_purchase()
    gp.play.get_errors.append(500)
    r = post_rtdn(client, developer_notification(one_time=(1, token)))
    assert r.status_code == 503
    # The retry (same messageId) then applies.


async def test_duplicate_message_id_is_a_noop(client, gp) -> None:
    _, token = grant(client, gp)
    gp.play.purchases[token] = play_purchase(state="CANCELLED")
    note = developer_notification(voided={"purchaseToken": token, "productType": 2})
    assert post_rtdn(client, note, message_id="4242").json() == {"status": "applied"}
    assert post_rtdn(client, note, message_id="4242").json() == {"status": "unchanged"}
    assert await count(PurchaseEvent, PurchaseEvent.dedupe_key == "pubsub:4242") == 1
    # A redelivered PURCHASED is a no-op too.
    fresh = tok()
    gp.play.purchases[fresh] = play_purchase()
    note = developer_notification(one_time=(1, fresh))
    assert post_rtdn(client, note, message_id="4343").json() == {"status": "applied"}
    assert post_rtdn(client, note, message_id="4343").json() == {"status": "unchanged"}


async def test_out_of_order_voided_then_older_purchased_and_repurchase(client, gp) -> None:
    session, token = grant(client, gp, completed=NOW() - timedelta(hours=2))
    t_purchased = NOW() - timedelta(hours=1)
    t_voided = NOW() - timedelta(minutes=1)
    gp.play.purchases[token] = play_purchase(
        state="CANCELLED", completed=NOW() - timedelta(hours=2)
    )
    note = developer_notification(
        voided={"purchaseToken": token, "productType": 2}, event_at=t_voided
    )
    assert post_rtdn(client, note).json() == {"status": "applied"}
    # The older PURCHASED notification arrives late, while Play's purchase read
    # still lags the refund and says PURCHASED: it must not restore access.
    gp.play.purchases[token] = play_purchase(completed=NOW() - timedelta(hours=2))
    late = developer_notification(one_time=(1, token), event_at=t_purchased)
    assert post_rtdn(client, late).json() == {"status": "unchanged"}
    assert (await row(token)).state == "revoked"
    # A client re-posting that lagging answer cannot restore it either.
    r = post_google(client, session, token)
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    assert jwt_games(client, session) == []
    # Buying again is a new purchase token: owned, granted.
    new_token = tok()
    gp.play.purchases[new_token] = play_purchase()
    assert post_google(client, session, new_token).json()["status"] == "owned"
    assert jwt_games(client, session) == ["hearts"]


async def test_same_state_store_event_advances_watermark(client, gp) -> None:
    session, token = grant(client, gp, completed=NOW() - timedelta(hours=3))
    gp.play.purchases[token] = play_purchase(
        state="CANCELLED", completed=NOW() - timedelta(hours=3)
    )
    t2, t3 = NOW() - timedelta(hours=2), NOW() - timedelta(minutes=10)
    for t in (t2, t3):
        note = developer_notification(voided={"purchaseToken": token, "productType": 2}, event_at=t)
        post_rtdn(client, note)
    assert abs(utc((await row(token)).state_changed_at) - t3) < timedelta(milliseconds=2)
    # A PURCHASED notification between T2 and T3 (Play read lagging) is stale.
    gp.play.purchases[token] = play_purchase(completed=NOW() - timedelta(hours=3))
    mid = developer_notification(one_time=(1, token), event_at=NOW() - timedelta(hours=1))
    assert post_rtdn(client, mid).json() == {"status": "unchanged"}
    assert (await row(token)).state == "revoked"
    assert jwt_games(client, session) == []


async def test_environment_mismatch_guard(client, gp) -> None:
    session, token = grant(client, gp, test=True)
    # Play now reports the token as a production purchase: act on nothing.
    gp.play.purchases[token] = play_purchase(state="CANCELLED")
    r = post_rtdn(client, developer_notification(voided={"purchaseToken": token, "productType": 2}))
    assert r.json() == {"status": "unchanged"}
    assert (await row(token)).state == "owned"
    assert await count(PurchaseEvent, PurchaseEvent.kind == "environment_mismatch") >= 1
    assert jwt_games(client, session) == ["hearts"]


async def test_notification_for_disallowed_environment_is_ignored(client, install) -> None:
    h = install(make_harness(frozenset({"production"})))
    token = tok()
    h.play.purchases[token] = play_purchase(test=True)
    assert post_rtdn(client, developer_notification(one_time=(1, token))).json() == {
        "status": "ignored"
    }
    assert await row(token) is None


async def test_no_logger_ever_sees_a_token(client, gp, caplog) -> None:
    """Review B1: capture ALL loggers (root, DEBUG) through a full grant, acknowledgement,
    RTDN, voided lookup, poll and sweep, and check no purchase token, order id,
    account token or bearer token appears anywhere."""
    session, token, other = sid(), tok(), tok()
    account = google.expected_account_token(session)
    gp.play.purchases[token] = play_purchase(account=account)
    gp.play.purchases[other] = play_purchase(order="GPA.SECRET-ORDER")
    bearer = oidc_token()
    with caplog.at_level(logging.DEBUG):
        assert post_google(client, session, token, source="purchase").status_code == 200
        assert gp.play.ack_calls == [(HEARTS, token)]
        post_rtdn(client, developer_notification(one_time=(1, other)), bearer=bearer)
        gp.play.voided_pages = [voided_page([voided_record(token, NOW())])]
        post_rtdn(client, developer_notification(voided={"purchaseToken": token, "productType": 2}))
        post_rtdn(client, developer_notification(test=True), bearer=oidc_token(aud="x"))
        gp.play.get_errors.append(500)
        post_google(client, sid(), tok())
        await poll_voided_purchases(gp.verifier, get_session_factory())
        await acknowledge_sweep(gp.verifier, get_session_factory())
    # Every logger at DEBUG, except the SQLite test driver, whose DEBUG lines
    # echo bound SQL parameters (store keys are columns); production runs
    # asyncpg with the root logger at INFO.
    records = [r for r in caplog.records if r.name != "aiosqlite"]
    text = "".join(r.getMessage() + str(r.args) for r in records)
    # (The account token is SHA-256(session), the same pseudonym the audit log
    # already carries as session_hash by design, IAP.md §4, so it is not listed.)
    for secret in (token, other, "GPA.SECRET-ORDER", bearer, ACCESS_TOKEN):
        assert secret not in text
    assert "google_notification" in text and "google_notification_rejected" in text
    # The HTTP client loggers that would have printed the URLs are held at WARNING.
    for name in ("httpx", "httpcore"):
        assert logging.getLogger(name).getEffectiveLevel() >= logging.WARNING


def test_rtdn_is_rate_limited_and_body_capped(client, gp) -> None:
    assert GOOGLE_NOTIFICATION_IP_RATE_LIMIT == "300/minute"
    r = _rtdn_raw(client, {"Authorization": f"Bearer {oidc_token()}"}, b"x" * (33 * 1024))
    assert r.status_code == 413


def test_sentry_scrubs_google_keys() -> None:
    import main

    for key in ("purchaseToken", "obfuscatedExternalAccountId", "orderId", "account_token"):
        assert key in main.SENTRY_SCRUBBED_KEYS


# ---------------------------------------------------------------------------
# Shared service rules, Google edition: link caps and Delete My Data
# ---------------------------------------------------------------------------


async def test_delete_my_data_keeps_google_purchase_records(client, gp) -> None:
    session, token = grant(client, gp)
    purchase = await row(token)
    events = await count(PurchaseEvent, PurchaseEvent.purchase_id == purchase.id)
    assert client.delete("/me", headers={"X-Session-ID": session}).status_code == 204
    assert await count(PurchaseLink, PurchaseLink.session_id == session) == 0
    assert await count(GameEntitlement, GameEntitlement.session_id == session) == 0
    kept = await row(token)
    assert (
        kept is not None and kept.state == "owned" and kept.account_token == purchase.account_token
    )
    assert await count(PurchaseEvent, PurchaseEvent.purchase_id == purchase.id) == events
    # Restore on a fresh install re-links from the store.
    fresh = sid()
    assert post_google(client, fresh, token, source="restore").status_code == 200
    assert jwt_games(client, fresh) == ["hearts"]


async def test_delete_my_data_churn_cannot_reset_google_link_caps(client, gp) -> None:
    from purchases.service import MAX_NEW_LINKS_PER_PURCHASE_PER_30D

    token = tok()
    gp.play.purchases[token] = play_purchase()

    def restore_then_erase(session: str) -> int:
        status = post_google(client, session, token, source="restore").status_code
        assert client.delete("/me", headers={"X-Session-ID": session}).status_code == 204
        return status

    first = [sid() for _ in range(MAX_NEW_LINKS_PER_PURCHASE_PER_30D)]
    assert [restore_then_erase(s) for s in first] == [200] * len(first)
    purchase = await row(token)
    assert await count(PurchaseLink, PurchaseLink.purchase_id == purchase.id) == 0
    r = post_google(client, sid(), token, source="restore")
    assert r.status_code == 409 and r.json()["detail"] == "link_limit"
    # The same install coming back is not a new session.
    assert post_google(client, first[0], token, source="restore").status_code == 200


# ---------------------------------------------------------------------------
# Voided-purchases poll
# ---------------------------------------------------------------------------


async def test_voided_poll_paginates_revokes_and_dedupes(client, gp) -> None:
    session, known = grant(client, gp)
    unknown = tok()  # voided before any client posted it
    gp.play.purchases[unknown] = play_purchase()  # the purchase read lags the void
    foreign = tok()  # not readable: not ours
    voided_at = NOW() - timedelta(minutes=1)  # after the purchase completed
    gp.play.voided_pages = [
        voided_page(
            [voided_record(known, voided_at, reason=1), "junk", {"purchaseToken": ""}], "1"
        ),
        voided_page(
            [voided_record(unknown, voided_at, reason=5), voided_record(foreign, voided_at)]
        ),
    ]
    now = NOW()
    result = await poll_voided_purchases(gp.verifier, get_session_factory(), now=now)
    assert (result.fetched, result.applied, result.failed) == (4, 2, 0)
    assert not result.truncated and not result.api_failed
    assert jwt_games(client, session) == []
    k = await row(known)
    assert (k.state, k.revocation_reason) == ("revoked", "voided_remorse")
    assert abs(utc(k.state_changed_at) - voided_at) < timedelta(milliseconds=2)
    u = await row(unknown)
    assert (u.state, u.revocation_reason) == ("revoked", "voided_fraud")
    assert await row(foreign) is None
    # The window: startTime = now - 48 h, endTime = now; the next page by token.
    first, second = gp.play.voided_calls[:2]
    assert first["startTime"] == str(int((now - timedelta(hours=48)).timestamp() * 1000))
    assert first["endTime"] == str(int(now.timestamp() * 1000)) and "token" not in first
    assert second["token"] == "1"
    # A later client post of the voided-unknown token, with the lagging read, grants nothing.
    r = post_google(client, sid(), unknown)
    assert r.json()["status"] == "revoked"
    # Running again changes nothing (one dedupe key per voided purchase).
    again = await poll_voided_purchases(gp.verifier, get_session_factory(), now=now)
    assert again.applied == 0


async def test_voided_poll_page_cap_api_errors_and_window_clamp(gp, caplog) -> None:
    gp.play.voided_pages = [voided_page([], str(i + 1)) for i in range(5)]
    with caplog.at_level(logging.WARNING, logger="audit"):
        result = await poll_voided_purchases(gp.verifier, get_session_factory(), max_pages=3)
    assert result.truncated and len(gp.play.voided_calls) == 3
    assert "google_voided_page_limit" in caplog.text
    gp.play.voided_errors.append(500)
    result = await poll_voided_purchases(gp.verifier, get_session_factory())
    assert result.api_failed
    gp.play.voided_pages = []
    now = NOW()
    await poll_voided_purchases(
        gp.verifier, get_session_factory(), window=timedelta(days=90), now=now
    )
    start = int(gp.play.voided_calls[-1]["startTime"])
    assert start > int((now - timedelta(days=30)).timestamp() * 1000)
    assert await poll_voided_purchases(None, get_session_factory()) is None


async def test_voided_poll_counts_play_outage_for_unknown_token(gp) -> None:
    gp.play.voided_pages = [voided_page([voided_record(tok(), NOW())])]
    gp.play.get_errors.append(503)
    result = await poll_voided_purchases(gp.verifier, get_session_factory())
    assert result.failed == 1


# ---------------------------------------------------------------------------
# Jobs loop, lifespan and manual script
# ---------------------------------------------------------------------------


async def test_run_google_jobs(gp) -> None:
    assert await run_google_jobs(None, get_session_factory()) is None
    voided, swept = await run_google_jobs(gp.verifier, get_session_factory(), now=NOW())
    assert voided.fetched == 0 and swept.failed == 0


async def test_jobs_loop_is_deterministic_and_survives_failures(monkeypatch) -> None:
    """A fake sleep and clock drive exactly three cycles; no real time passes."""
    seen: list[datetime] = []
    sleeps: list[float] = []

    async def failing(verifier, factory, *, now=None, **kw):
        seen.append(now)
        raise RuntimeError("boom")

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        if len(sleeps) == 3:
            raise asyncio.CancelledError

    fixed = [datetime(2026, 9, 30, 12, tzinfo=timezone.utc)]

    def clock() -> datetime:
        fixed[0] += timedelta(days=1)
        return fixed[0]

    monkeypatch.setattr(google_notifications, "run_google_jobs", failing)
    captured: list[BaseException] = []
    monkeypatch.setattr(
        google_notifications.sentry_sdk, "capture_exception", lambda exc: captured.append(exc)
    )
    with pytest.raises(asyncio.CancelledError):
        await run_google_jobs_loop(
            lambda: None, get_session_factory, interval_s=77.0, sleep=fake_sleep, clock=clock
        )
    assert sleeps == [77.0] * 3
    assert seen == [datetime(2026, 10, d, 12, tzinfo=timezone.utc) for d in (1, 2, 3)]
    assert len(captured) == 3


async def test_lifespan_starts_google_jobs_only_when_configured(monkeypatch) -> None:
    import main

    google.reset_google_runtime()
    monkeypatch.delenv("GOOGLE_PLAY_PACKAGE_NAME", raising=False)
    assert main._start_google_play_jobs() is None  # dormant
    started = asyncio.Event()

    async def fake_loop(get_verifier, get_factory):
        started.set()
        await asyncio.sleep(3600)

    monkeypatch.setattr(google_notifications, "run_google_jobs_loop", fake_loop)
    google._runtime = make_harness().runtime
    try:
        task = main._start_google_play_jobs()
        assert task is not None
        await asyncio.wait_for(started.wait(), 30)
        await main._stop_purchase_task(task, "google_jobs_stop_timeout")
        assert task.cancelled()
        monkeypatch.setattr(main, "is_configured", lambda: False)
        assert main._start_google_play_jobs() is None
    finally:
        google.reset_google_runtime()


async def test_manual_script(gp, monkeypatch, capsys) -> None:
    import importlib.util
    import pathlib

    path = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "google_play_jobs.py"
    spec = importlib.util.spec_from_file_location("google_play_jobs", path)
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    assert await script._main(48, False) == 0
    assert "ack sweep" in capsys.readouterr().out
    gp.play.voided_errors.append(500)
    assert await script._main(48, False) == 1
    assert await script._main(48, True) == 0
    monkeypatch.setattr(script.google, "configured_verifier", lambda: None)
    assert await script._main(48, False) == 2
    monkeypatch.setattr(script, "is_configured", lambda: False)
    assert await script._main(48, False) == 2


async def test_service_acknowledge_mark_is_idempotent(client, gp) -> None:
    _, token = grant(client, gp)
    purchase = await row(token)
    first = purchase.acknowledged_at
    async with get_session_factory()() as db:
        await purchase_service.mark_acknowledged(db, purchase.id)
    assert (await row(token)).acknowledged_at == first


# ---------------------------------------------------------------------------
# Sentry redaction of store IDs in URLs (review B1)
# ---------------------------------------------------------------------------

PLAY_URL = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.buffingchi.games/purchases"


def test_sentry_hooks_redact_store_ids() -> None:
    import main

    opts = main._sentry_options("https://key@o0.ingest.sentry.io/0")
    crumb = {
        "type": "http",
        "category": "httplib",
        "data": {
            "url": f"{PLAY_URL}/productsv2/tokens/SECRET-TOKEN",
            "method": "GET",
            "http.query": "startTime=1&token=SECRET-PAGE",
        },
    }
    out = opts["before_breadcrumb"](crumb, {})
    assert "SECRET" not in json.dumps(out)
    assert out["data"]["url"].endswith("/tokens/[redacted]")
    assert out["data"]["http.query"] == "startTime=1&token=[redacted]"
    transaction = {
        "type": "transaction",
        "transaction": "/purchases/google",
        "spans": [
            {"description": f"POST {PLAY_URL}/products/com.x/tokens/SECRET-ACK:acknowledge"},
            {
                "description": "GET https://api.storekit.itunes.apple.com/inApps/v1/transactions/2000000999",
                "data": {
                    "url": "https://api.storekit.itunes.apple.com/inApps/v1/transactions/2000000999"
                },
            },
            {
                "description": "POST https://api.storekit.itunes.apple.com/inApps/v1/notifications/history",
                "data": {"http.query": "paginationToken=SECRET-APPLE"},
            },
            {
                "description": "GET https://api.storekit.itunes.apple.com/inApps/v2/history/2000000999"
            },
        ],
        "breadcrumbs": {"values": [crumb]},
    }
    out = opts["before_send_transaction"](transaction, {})
    dumped = json.dumps(out)
    assert "SECRET" not in dumped and "2000000999" not in dumped
    assert out["spans"][0]["description"].endswith("/tokens/[redacted]:acknowledge")
    assert out["transaction"] == "/purchases/google"
    event = {
        "exception": {
            "values": [{"value": f"ConnectError for {PLAY_URL}/productsv2/tokens/SECRET-X"}]
        },
        "message": "plain message",
    }
    out = opts["before_send"](event, {})
    assert "SECRET" not in json.dumps(out) and out["message"] == "plain message"


def test_sentry_end_to_end_transaction_and_breadcrumbs_carry_no_token() -> None:
    """A real SDK client with the app's options and the auto-enabled httpx integration."""
    import httpx
    import sentry_sdk
    from sentry_sdk.transport import Transport

    import main

    sent: list = []

    class Capture(Transport):
        def capture_envelope(self, envelope) -> None:
            sent.append(envelope.serialize().decode("utf-8", "replace"))

    opts = main._sentry_options("https://key@o0.ingest.sentry.io/0")
    opts.update(traces_sample_rate=1.0, transport=Capture())
    sentry_sdk.init(**opts)
    try:
        with sentry_sdk.isolation_scope():
            http = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(404)))
            with sentry_sdk.start_transaction(name="rtdn", op="test"):
                http.get(f"{PLAY_URL}/productsv2/tokens/SECRET-E2E-TOKEN")
                http.get(f"{PLAY_URL}/voidedpurchases", params={"token": "SECRET-PAGE"})
                sentry_sdk.capture_message("after the store call")
        sentry_sdk.flush()
    finally:
        sentry_sdk.get_client().close()
        sentry_sdk.init()  # back to a non-recording client
    payload = "\n".join(sent)
    assert "productsv2/tokens/[redacted]" in payload  # the span / breadcrumb was there
    assert "SECRET" not in payload


# ---------------------------------------------------------------------------
# Review fixes: event ordering (B2, S1), account token (S2), budgets (N3), partial refunds (N4)
# ---------------------------------------------------------------------------


async def test_pending_rtdn_racing_completion_keeps_epoch_so_the_grant_applies(client, gp) -> None:
    """Review B2: PURCHASED arrives at Tc+2s while Play still says PENDING; the
    client's later post (completion Tc) must still grant and acknowledge."""
    session, token = sid(), tok()
    tc = NOW() - timedelta(seconds=30)
    gp.play.purchases[token] = play_purchase(state="PENDING")
    note = developer_notification(one_time=(1, token), event_at=tc + timedelta(seconds=2))
    assert post_rtdn(client, note).json() == {"status": "applied"}
    pending = await row(token)
    assert pending.state == "pending" and utc(pending.state_changed_at) == PENDING_EVENT_AT
    gp.play.purchases[token] = play_purchase(completed=tc)
    r = post_google(client, session, token)
    assert r.status_code == 200 and r.json()["status"] == "owned"
    assert jwt_games(client, session) == ["hearts"]
    assert (await row(token)).acknowledged_at is not None


async def test_replayed_far_future_purchased_cannot_block_a_later_void(client, gp) -> None:
    """Review S1: a captured push token replayed with eventTimeMillis in 2036."""
    tc = NOW() - timedelta(minutes=10)
    session, token = grant(client, gp, completed=tc)
    future = datetime(2036, 1, 1, tzinfo=timezone.utc)
    replay = developer_notification(one_time=(1, token), event_at=future)
    post_rtdn(client, replay)
    assert utc((await row(token)).state_changed_at) < NOW()  # ordered by completion time
    gp.play.purchases[token] = play_purchase(state="CANCELLED", completed=tc)
    void = developer_notification(voided={"purchaseToken": token, "productType": 2})
    assert post_rtdn(client, void).json() == {"status": "applied"}
    assert jwt_games(client, session) == []


async def test_far_future_event_time_is_clamped(client, gp) -> None:
    _, token = grant(client, gp)
    gp.play.purchases[token] = play_purchase(state="CANCELLED")
    future = datetime(2036, 1, 1, tzinfo=timezone.utc)
    note = developer_notification(
        voided={"purchaseToken": token, "productType": 2}, event_at=future
    )
    assert post_rtdn(client, note).json() == {"status": "applied"}
    changed = utc((await row(token)).state_changed_at)
    assert changed <= NOW() + google_notifications.EVENT_TIME_LEEWAY
    assert google_notifications.clamp_event_time(None, NOW()) is None


@pytest.mark.parametrize("account", ["é" * 64, "ü" + "a" * 63, "g" * 64, "a" * 63, "a" * 65, "😀"])
def test_malformed_account_token_is_403_never_500(client, gp, account) -> None:
    """Review S2 (Codex): non-hex / non-ASCII obfuscatedExternalAccountId."""
    token = tok()
    gp.play.purchases[token] = play_purchase(account=account)
    r = post_google(client, sid(), token, source="purchase")
    assert r.status_code == 403 and r.json()["detail"] == "ownership_mismatch"


def test_account_token_matches_rejects_non_hex_without_raising() -> None:
    session = sid()
    assert not google.account_token_matches(session, "é" * 64)
    assert not google.account_token_matches(session, 123)  # type: ignore[arg-type]
    assert google.account_token_matches(session, google.expected_account_token(session).upper())
    v = to_verified("t", play_purchase(account="é" * 64), environments=frozenset({"production"}))
    assert v.account_token is None


def test_owned_without_completion_time_gets_the_weakest_time() -> None:
    data = play_purchase()
    del data["purchaseCompletionTime"]
    v = to_verified("t", data, environments=frozenset({"production"}))
    assert (v.state, v.event_at) == ("owned", PENDING_EVENT_AT)


async def test_client_ack_is_bounded_and_left_to_the_sweep(client, gp, monkeypatch) -> None:
    """Review N3: a hanging acknowledgement cannot hold the client's request."""
    from purchases import router

    async def hang(evidence):
        await asyncio.sleep(3600)

    monkeypatch.setattr(router, "GOOGLE_ACK_BUDGET_S", 0.05)
    monkeypatch.setattr(gp.verifier, "acknowledge", hang)
    session, token = grant(client, gp)
    assert jwt_games(client, session) == ["hearts"]
    assert (await row(token)).acknowledged_at is None


async def test_rtdn_ack_is_bounded(client, gp, monkeypatch) -> None:
    async def hang(evidence):
        await asyncio.sleep(3600)

    monkeypatch.setattr(google_notifications, "RTDN_ACK_BUDGET_S", 0.05)
    monkeypatch.setattr(gp.verifier, "acknowledge", hang)
    token = tok()
    gp.play.purchases[token] = play_purchase()
    assert post_rtdn(client, developer_notification(one_time=(1, token))).status_code == 200
    assert (await row(token)).acknowledged_at is None


async def test_partial_refunds_are_ignored_on_both_paths(client, gp) -> None:
    """Review N4: a quantity-based partial refund voids nothing, via RTDN or the poll."""
    session, token = grant(client, gp)
    partial = {**voided_record(token, NOW()), "voidedQuantity": 1}
    gp.play.voided_pages = [voided_page([partial])]
    r = post_rtdn(client, developer_notification(voided={"purchaseToken": token, "productType": 2}))
    assert r.json() == {"status": "unconfirmed"}
    result = await poll_voided_purchases(gp.verifier, get_session_factory())
    assert (result.fetched, result.applied) == (1, 0)
    assert jwt_games(client, session) == ["hearts"]

"""Google Play configuration and ``POST /purchases/google`` verification (#2787).

Covers ``purchases/google_play.py`` (config, Play API client, ``to_verified``,
client-path acknowledgement) and ``purchases/google.py`` (account token), the
shared purchase-service rules seen through Google, and Sentry redaction of
Play URLs. Split out of ``test_google_iap.py`` (#2955); the harness lives in
``tests/_google_iap_harness.py``.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Iterator
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from db.models import GameEntitlement, PurchaseEvent, PurchaseLink
from purchases import _common, google, google_play
from purchases.google_play import PENDING_EVENT_AT, load_config, to_verified
from purchases.verifiers import GoogleEvidence, NotConfiguredGoogleVerifier, PurchaseError
from tests._google_iap_harness import (
    NOW,
    Harness,
    grant,
    make_harness,
    post_google,
    post_rtdn,
    row,
    sid,
    tok,
    utc,
)
from tests._helpers import count, jwt_games
from tests.google_play_fakes import (
    ACCESS_TOKEN,
    AUDIENCE,
    CASCADE,
    HEARTS,
    PACKAGE,
    PUSH_SA,
    developer_notification,
    play_purchase,
    service_account_info,
)

# Shared fixtures (google_gp, google_install) come from the harness module.
pytest_plugins = ["tests._google_iap_harness"]


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
        _common.sentry_sdk, "capture_message", lambda msg, level=None: messages.append(msg)
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
    client: TestClient, google_gp: Harness
) -> None:
    session, token = sid(), tok()
    completed = NOW() - timedelta(minutes=3)
    google_gp.play.purchases[token] = play_purchase(
        account=google.expected_account_token(session), completed=completed
    )
    r = post_google(client, session, token, source="purchase")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["status"], body["game_slug"], body["finish"]) == ("owned", "hearts", True)
    assert jwt_games(client, session) == ["hearts"]
    # Acknowledged server-side after persistence, and recorded.
    assert google_gp.play.ack_calls == [(HEARTS, token)]
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
    assert google_gp.tokens.calls == 1
    assert (
        google_gp.tokens.assertions[0]["scope"]
        == "https://www.googleapis.com/auth/androidpublisher"
    )
    assert google_gp.play.auth_headers == {f"Bearer {ACCESS_TOKEN}"}
    # Re-post: idempotent, no second acknowledgement.
    assert post_google(client, session, token).status_code == 200
    assert google_gp.play.ack_calls == [(HEARTS, token)]
    assert google_gp.tokens.calls == 1


async def test_already_acknowledged_purchase_is_not_reacknowledged(
    client: TestClient, google_gp: Harness
) -> None:
    _, token = grant(client, google_gp, acknowledged=True)
    assert google_gp.play.ack_calls == []
    assert (await row(token)).acknowledged_at is not None


async def test_pending_records_without_grant_then_completes(
    client: TestClient, google_gp: Harness
) -> None:
    session, token = sid(), tok()
    google_gp.play.purchases[token] = play_purchase(state="PENDING")
    r = post_google(client, session, token)
    assert r.status_code == 200
    assert (r.json()["status"], r.json()["finish"]) == ("pending", False)
    assert jwt_games(client, session) == []
    assert google_gp.play.ack_calls == []
    purchase = await row(token)
    assert purchase.state == "pending"
    assert utc(purchase.state_changed_at) == PENDING_EVENT_AT
    assert await count(PurchaseLink, PurchaseLink.purchase_id == purchase.id) == 0
    # Completed a moment ago: applies whatever our clock said at the pending post.
    google_gp.play.purchases[token] = play_purchase(completed=NOW() - timedelta(seconds=1))
    r = post_google(client, session, token)
    assert r.json()["status"] == "owned"
    assert jwt_games(client, session) == ["hearts"]
    assert google_gp.play.ack_calls == [(HEARTS, token)]


async def test_cancelled_before_completion_is_422_and_recorded_cancelled(
    client: TestClient, google_gp: Harness
) -> None:
    token = tok()
    google_gp.play.purchases[token] = play_purchase(state="CANCELLED", never_completed=True)
    r = post_google(client, sid(), token)
    assert r.status_code == 422 and r.json()["detail"] == "verification_failed"
    assert (await row(token)).state == "cancelled"


async def test_completed_then_cancelled_is_revoked_and_removes_access(
    client: TestClient, google_gp: Harness
) -> None:
    session, token = grant(client, google_gp)
    google_gp.play.purchases[token] = play_purchase(state="CANCELLED")
    r = post_google(client, session, token)
    assert r.status_code == 200
    assert (r.json()["status"], r.json()["finish"]) == ("revoked", True)
    assert jwt_games(client, session) == []
    purchase = await row(token)
    assert (purchase.state, purchase.revocation_reason) == ("revoked", "voided")


def test_token_for_another_package_or_unknown_is_422(
    client: TestClient, google_gp: Harness
) -> None:
    # The package is bound into the request path; Play answers 404 for a token
    # that is not this app's (the fake has no purchase under that token).
    r = post_google(client, sid(), tok())
    assert r.status_code == 422 and r.json()["detail"] == "verification_failed"
    assert all(PACKAGE in p for p in [google_gp.play.PREFIX])


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
def test_bad_purchases_are_refused(client: TestClient, google_gp: Harness, play, detail) -> None:
    token = tok()
    google_gp.play.purchases[token] = play
    r = post_google(client, sid(), token)
    assert r.status_code == 422 and r.json()["detail"] == detail
    assert google_gp.play.ack_calls == []  # never acknowledged, never consumed


def test_free_or_unknown_catalog_product_is_unknown_product(
    client: TestClient, google_gp: Harness
) -> None:
    token = tok()
    free = "com.buffingchi.games.premium.sudoku"  # follows the convention, not is_premium
    google_gp.play.purchases[token] = play_purchase(product=free)
    r = post_google(client, sid(), token, product=free)
    assert r.status_code == 422 and r.json()["detail"] == "unknown_product"
    # A product off the convention never reaches Play.
    calls = len(google_gp.play.get_calls)
    r = post_google(client, sid(), tok(), product="com.buffingchi.games.coins")
    assert r.status_code == 422 and r.json()["detail"] == "unknown_product"
    assert len(google_gp.play.get_calls) == calls


async def test_verifier_rejects_off_catalog_product_before_store_call(google_gp: Harness) -> None:
    with pytest.raises(PurchaseError) as exc:
        await google_gp.verifier.verify(GoogleEvidence("com.other.product", tok()))
    assert exc.value.detail == "unknown_product" and google_gp.play.get_calls == []


async def test_ownership_is_enforced_only_for_source_purchase(
    client: TestClient, google_gp: Harness
) -> None:
    session, token = sid(), tok()
    google_gp.play.purchases[token] = play_purchase(account=google.expected_account_token(sid()))
    r = post_google(client, session, token, source="purchase")
    assert r.status_code == 403 and r.json()["detail"] == "ownership_mismatch"
    missing = tok()
    google_gp.play.purchases[missing] = play_purchase(account=None)
    assert post_google(client, session, missing, source="purchase").status_code == 403
    # The same verified purchase restores to another install (the capped transfer rule).
    assert post_google(client, session, token, source="restore").status_code == 200
    assert jwt_games(client, session) == ["hearts"]
    # Upper-case hex from the store still matches.
    upper = tok()
    google_gp.play.purchases[upper] = play_purchase(
        account=google.expected_account_token(session).upper()
    )
    assert post_google(client, session, upper, source="purchase").status_code == 200


async def test_environment_allow_list(client: TestClient, google_install) -> None:
    h = google_install(make_harness(frozenset({"production"})))
    token = tok()
    h.play.purchases[token] = play_purchase(test=True)
    r = post_google(client, sid(), token)
    assert r.status_code == 422 and r.json()["detail"] == "environment_not_allowed"
    assert await row(token) is None
    # Licence-tester purchases are "test" when allowed.
    h2 = google_install(make_harness())
    h2.play.purchases[token] = play_purchase(test=True)
    assert post_google(client, sid(), token).status_code == 200
    assert (await row(token)).environment == "test"


async def test_service_rechecks_environment_allow_list(
    client: TestClient, google_gp: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = tok()
    google_gp.play.purchases[token] = play_purchase(test=True)
    monkeypatch.setenv("GOOGLE_PLAY_ENVIRONMENTS", "production")
    r = post_google(client, sid(), token)
    assert r.status_code == 422 and r.json()["detail"] == "environment_not_allowed"


@pytest.mark.parametrize("error", [401, 403, 429, 500, 503, "network", "not-json", "not-object"])
def test_play_api_errors_are_503(client: TestClient, google_gp: Harness, error, caplog) -> None:
    token = tok()
    google_gp.play.purchases[token] = play_purchase()
    google_gp.play.get_errors.append(error)
    with caplog.at_level(logging.WARNING, logger="audit"):
        r = post_google(client, sid(), token)
    assert r.status_code == 503 and r.json()["detail"] == "store_unavailable"
    if error in (401, 403):
        assert "google_play_auth_failed" in caplog.text
    assert token not in caplog.text


def test_token_endpoint_failure_is_503(client: TestClient, google_gp: Harness, caplog) -> None:
    google_gp.tokens.fail = True
    token = tok()
    google_gp.play.purchases[token] = play_purchase()
    with caplog.at_level(logging.WARNING, logger="audit"):
        r = post_google(client, sid(), token)
    assert r.status_code == 503
    assert "google_play_token_failed" in caplog.text
    assert google_gp.play.get_calls == []


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


async def test_ack_retries_transient_errors_then_succeeds(
    client: TestClient, google_gp: Harness
) -> None:
    google_gp.play.ack_errors += [500, "network"]
    _, token = grant(client, google_gp)
    assert len(google_gp.play.ack_calls) == 3
    assert google_gp.sleeps == list(google_play.ACK_BACKOFF_S)
    assert (await row(token)).acknowledged_at is not None


async def test_ack_is_idempotent_when_play_says_already_acknowledged(google_gp: Harness) -> None:
    token = tok()
    google_gp.play.purchases[token] = play_purchase(acknowledged=True)
    await google_gp.verifier.acknowledge(
        GoogleEvidence(HEARTS, token)
    )  # 400 → re-read → acknowledged
    google_gp.play.purchases[token] = play_purchase(state="CANCELLED")
    with pytest.raises(PurchaseError) as exc:
        await google_gp.verifier.acknowledge(GoogleEvidence(HEARTS, token))
    assert exc.value.detail == "verification_failed"


# ---------------------------------------------------------------------------
# Shared service rules, Google edition: link caps and Delete My Data
# ---------------------------------------------------------------------------


async def test_delete_my_data_keeps_google_purchase_records(client, google_gp) -> None:
    session, token = grant(client, google_gp)
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


async def test_delete_my_data_churn_cannot_reset_google_link_caps(client, google_gp) -> None:
    from purchases.service import MAX_NEW_LINKS_PER_PURCHASE_PER_30D

    token = tok()
    google_gp.play.purchases[token] = play_purchase()

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


@pytest.mark.parametrize("account", ["é" * 64, "ü" + "a" * 63, "g" * 64, "a" * 63, "a" * 65, "😀"])
def test_malformed_account_token_is_403_never_500(client, google_gp, account) -> None:
    """Review S2 (Codex): non-hex / non-ASCII obfuscatedExternalAccountId."""
    token = tok()
    google_gp.play.purchases[token] = play_purchase(account=account)
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


async def test_client_ack_is_bounded_and_left_to_the_sweep(client, google_gp, monkeypatch) -> None:
    """Review N3: a hanging acknowledgement cannot hold the client's request."""
    from purchases import router

    async def hang(evidence):
        await asyncio.sleep(3600)

    monkeypatch.setattr(router, "GOOGLE_ACK_BUDGET_S", 0.05)
    monkeypatch.setattr(google_gp.verifier, "acknowledge", hang)
    session, token = grant(client, google_gp)
    assert jwt_games(client, session) == ["hearts"]
    assert (await row(token)).acknowledged_at is None

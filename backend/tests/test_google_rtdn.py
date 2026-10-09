"""Google Real-Time Developer Notification handling (#2787).

Covers ``purchases/google_rtdn.py`` (#2998): push parsing, one-time /
voided handling, dedupe, event ordering and the RTDN ack budget. Split out of
``test_google_iap.py`` (#2955); the harness lives in
``tests/_google_iap_harness.py``.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime, timedelta

import pytest

from db.base import get_session_factory
from db.models import PurchaseEvent, PurchaseLink
from purchases import google, google_rtdn
from purchases.google_jobs import acknowledge_sweep, poll_voided_purchases
from purchases.google_play import PENDING_EVENT_AT
from rate_limits import GOOGLE_NOTIFICATION_IP_RATE_LIMIT
from tests._google_iap_harness import (
    NOW,
    grant,
    make_harness,
    post_google,
    post_rtdn,
    row,
    rtdn_raw,
    sid,
    tok,
    utc,
)
from tests._helpers import count, jwt_games
from tests.google_play_fakes import (
    ACCESS_TOKEN,
    HEARTS,
    developer_notification,
    ms,
    oidc_token,
    play_purchase,
    voided_page,
    voided_record,
)

# Shared fixtures (google_gp, google_install) come from the harness module.
pytest_plugins = ["tests._google_iap_harness"]


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
def test_authenticated_but_irrelevant_messages_are_200_ignored(client, google_gp, note) -> None:
    r = post_rtdn(client, note)
    assert r.status_code == 200 and r.json() == {"status": "ignored"}
    assert google_gp.play.get_calls == []


def test_test_notification(client, google_gp) -> None:
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
def test_malformed_push_after_auth_is_400(client, google_gp, body) -> None:
    r = rtdn_raw(
        client,
        {"Authorization": f"Bearer {oidc_token()}", "Content-Type": "application/json"},
        body,
    )
    assert r.status_code == 400 and r.json()["detail"] == "invalid_request"


async def test_purchased_notification_records_unlinked_and_acknowledges(client, google_gp) -> None:
    token = tok()
    google_gp.play.purchases[token] = play_purchase()
    event = NOW() - timedelta(minutes=1)
    r = post_rtdn(client, developer_notification(one_time=(1, token), event_at=event))
    assert r.json() == {"status": "applied"}
    purchase = await row(token)
    assert purchase.state == "owned" and purchase.acknowledged_at is not None
    assert await count(PurchaseLink, PurchaseLink.purchase_id == purchase.id) == 0  # grants nothing
    assert google_gp.play.ack_calls == [(HEARTS, token)]
    # A client posting it later links normally.
    session = sid()
    assert post_google(client, session, token).status_code == 200
    assert jwt_games(client, session) == ["hearts"]


async def test_purchased_notification_ack_failure_leaves_it_for_the_sweep(
    client, google_gp
) -> None:
    token = tok()
    google_gp.play.purchases[token] = play_purchase()
    google_gp.play.ack_errors += [500, 500, 500]
    r = post_rtdn(client, developer_notification(one_time=(1, token)))
    assert r.status_code == 200
    assert (await row(token)).acknowledged_at is None


async def test_notification_claims_are_not_trusted(client, google_gp) -> None:
    # PURCHASED, but Play says pending: record pending, no grant, no acknowledgement.
    token = tok()
    google_gp.play.purchases[token] = play_purchase(state="PENDING")
    assert post_rtdn(client, developer_notification(one_time=(1, token))).status_code == 200
    assert (await row(token)).state == "pending" and google_gp.play.ack_calls == []
    # CANCELED, but Play still says purchased: nothing changes.
    session, owned = grant(client, google_gp)
    r = post_rtdn(client, developer_notification(one_time=(2, owned)))
    assert r.json() == {"status": "unconfirmed"}
    assert (await row(owned)).state == "owned" and jwt_games(client, session) == ["hearts"]
    # VOIDED, but Play says purchased and the Voided Purchases API does not list it.
    google_gp.play.voided_pages = [voided_page([])]
    r = post_rtdn(client, developer_notification(voided={"purchaseToken": owned, "productType": 2}))
    assert r.json() == {"status": "unconfirmed"}
    assert jwt_games(client, session) == ["hearts"]
    # A token Play does not know is ignored.
    r = post_rtdn(client, developer_notification(one_time=(1, tok())))
    assert r.json() == {"status": "ignored"}


async def test_canceled_pending_purchase_is_marked_cancelled(client, google_gp) -> None:
    token = tok()
    google_gp.play.purchases[token] = play_purchase(state="PENDING")
    assert post_google(client, sid(), token).json()["status"] == "pending"
    google_gp.play.purchases[token] = play_purchase(state="CANCELLED", never_completed=True)
    r = post_rtdn(client, developer_notification(one_time=(2, token)))
    assert r.json() == {"status": "applied"}
    assert (await row(token)).state == "cancelled"
    # For a purchase no client posted, the cancellation is recorded.
    other = tok()
    google_gp.play.purchases[other] = play_purchase(state="CANCELLED", never_completed=True)
    assert (
        post_rtdn(client, developer_notification(one_time=(2, other))).json()["status"] == "applied"
    )
    assert (await row(other)).state == "cancelled"


async def test_voided_notification_revokes_every_linked_session(client, google_gp) -> None:
    session, token = grant(client, google_gp)
    other = sid()
    assert post_google(client, other, token, source="restore").status_code == 200
    google_gp.play.purchases[token] = play_purchase(state="CANCELLED")
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
    client, google_gp
) -> None:
    session, token = grant(client, google_gp)
    google_gp.play.voided_pages = [
        voided_page([voided_record("someone-else", NOW())], "1"),
        voided_page([voided_record(token, NOW(), reason=7)]),
    ]
    r = post_rtdn(client, developer_notification(voided={"purchaseToken": token, "productType": 2}))
    assert r.json() == {"status": "applied"}
    assert jwt_games(client, session) == []
    assert (await row(token)).revocation_reason == "voided_chargeback"
    # The lookup window starts shortly before the event and never beyond 30 days.
    start = int(google_gp.play.voided_calls[0]["startTime"])
    assert int(ms(NOW() - timedelta(days=30))) < start <= int(ms(NOW()))


async def test_voided_notification_for_unknown_purchase_records_it_revoked(
    client, google_gp
) -> None:
    token = tok()
    google_gp.play.purchases[token] = play_purchase(state="CANCELLED")
    r = post_rtdn(client, developer_notification(voided={"purchaseToken": token, "productType": 2}))
    assert r.json() == {"status": "applied"}
    assert (await row(token)).state == "revoked"
    # A token Play cannot read, not listed as voided either: nothing to apply.
    gone = tok()
    google_gp.play.voided_pages = [voided_page([voided_record(gone, NOW())])]
    r = post_rtdn(client, developer_notification(voided={"purchaseToken": gone, "productType": 2}))
    assert r.json() == {"status": "ignored"}
    assert await row(gone) is None


async def test_voided_for_known_purchase_that_play_no_longer_reads(client, google_gp) -> None:
    session, token = grant(client, google_gp)
    del google_gp.play.purchases[token]  # Play 404s the token now
    google_gp.play.voided_pages = [voided_page([voided_record(token, NOW(), reason=0)])]
    r = post_rtdn(client, developer_notification(voided={"purchaseToken": token, "productType": 2}))
    assert r.json() == {"status": "applied"}
    assert jwt_games(client, session) == []


async def test_play_outage_during_rtdn_is_503_so_pubsub_retries(client, google_gp) -> None:
    token, message_id = tok(), "msg-play-outage"
    google_gp.play.purchases[token] = play_purchase()
    google_gp.play.get_errors.append(500)
    note = developer_notification(one_time=(1, token))
    r = post_rtdn(client, note, message_id=message_id)
    assert r.status_code == 503

    # The retry (same messageId) then applies: a 503 must not mark the message as seen.
    r = post_rtdn(client, note, message_id=message_id)
    assert r.status_code == 200 and r.json() == {"status": "applied"}
    assert (await row(token)).state == "owned"


async def test_duplicate_message_id_is_a_noop(client, google_gp) -> None:
    _, token = grant(client, google_gp)
    google_gp.play.purchases[token] = play_purchase(state="CANCELLED")
    note = developer_notification(voided={"purchaseToken": token, "productType": 2})
    assert post_rtdn(client, note, message_id="4242").json() == {"status": "applied"}
    assert post_rtdn(client, note, message_id="4242").json() == {"status": "unchanged"}
    assert await count(PurchaseEvent, PurchaseEvent.dedupe_key == "pubsub:4242") == 1
    # A redelivered PURCHASED is a no-op too.
    fresh = tok()
    google_gp.play.purchases[fresh] = play_purchase()
    note = developer_notification(one_time=(1, fresh))
    assert post_rtdn(client, note, message_id="4343").json() == {"status": "applied"}
    assert post_rtdn(client, note, message_id="4343").json() == {"status": "unchanged"}


async def test_out_of_order_voided_then_older_purchased_and_repurchase(client, google_gp) -> None:
    session, token = grant(client, google_gp, completed=NOW() - timedelta(hours=2))
    t_purchased = NOW() - timedelta(hours=1)
    t_voided = NOW() - timedelta(minutes=1)
    google_gp.play.purchases[token] = play_purchase(
        state="CANCELLED", completed=NOW() - timedelta(hours=2)
    )
    note = developer_notification(
        voided={"purchaseToken": token, "productType": 2}, event_at=t_voided
    )
    assert post_rtdn(client, note).json() == {"status": "applied"}
    # The older PURCHASED notification arrives late, while Play's purchase read
    # still lags the refund and says PURCHASED: it must not restore access.
    google_gp.play.purchases[token] = play_purchase(completed=NOW() - timedelta(hours=2))
    late = developer_notification(one_time=(1, token), event_at=t_purchased)
    assert post_rtdn(client, late).json() == {"status": "unchanged"}
    assert (await row(token)).state == "revoked"
    # A client re-posting that lagging answer cannot restore it either.
    r = post_google(client, session, token)
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    assert jwt_games(client, session) == []
    # Buying again is a new purchase token: owned, granted.
    new_token = tok()
    google_gp.play.purchases[new_token] = play_purchase()
    assert post_google(client, session, new_token).json()["status"] == "owned"
    assert jwt_games(client, session) == ["hearts"]


async def test_same_state_store_event_advances_watermark(client, google_gp) -> None:
    session, token = grant(client, google_gp, completed=NOW() - timedelta(hours=3))
    google_gp.play.purchases[token] = play_purchase(
        state="CANCELLED", completed=NOW() - timedelta(hours=3)
    )
    t2, t3 = NOW() - timedelta(hours=2), NOW() - timedelta(minutes=10)
    for t in (t2, t3):
        note = developer_notification(voided={"purchaseToken": token, "productType": 2}, event_at=t)
        post_rtdn(client, note)
    assert abs(utc((await row(token)).state_changed_at) - t3) < timedelta(milliseconds=2)
    # A PURCHASED notification between T2 and T3 (Play read lagging) is stale.
    google_gp.play.purchases[token] = play_purchase(completed=NOW() - timedelta(hours=3))
    mid = developer_notification(one_time=(1, token), event_at=NOW() - timedelta(hours=1))
    assert post_rtdn(client, mid).json() == {"status": "unchanged"}
    assert (await row(token)).state == "revoked"
    assert jwt_games(client, session) == []


async def test_environment_mismatch_guard(client, google_gp) -> None:
    session, token = grant(client, google_gp, test=True)
    # Play now reports the token as a production purchase: act on nothing.
    google_gp.play.purchases[token] = play_purchase(state="CANCELLED")
    r = post_rtdn(client, developer_notification(voided={"purchaseToken": token, "productType": 2}))
    assert r.json() == {"status": "unchanged"}
    assert (await row(token)).state == "owned"
    assert await count(PurchaseEvent, PurchaseEvent.kind == "environment_mismatch") >= 1
    assert jwt_games(client, session) == ["hearts"]


async def test_notification_for_disallowed_environment_is_ignored(client, google_install) -> None:
    h = google_install(make_harness(frozenset({"production"})))
    token = tok()
    h.play.purchases[token] = play_purchase(test=True)
    assert post_rtdn(client, developer_notification(one_time=(1, token))).json() == {
        "status": "ignored"
    }
    assert await row(token) is None


async def test_no_logger_ever_sees_a_token(client, google_gp, caplog) -> None:
    """Review B1: capture ALL loggers (root, DEBUG) through a full grant, acknowledgement,
    RTDN, voided lookup, poll and sweep, and check no purchase token, order id,
    account token or bearer token appears anywhere."""
    session, token, other = sid(), tok(), tok()
    account = google.expected_account_token(session)
    google_gp.play.purchases[token] = play_purchase(account=account)
    google_gp.play.purchases[other] = play_purchase(order="GPA.SECRET-ORDER")
    bearer = oidc_token()
    with caplog.at_level(logging.DEBUG):
        assert post_google(client, session, token, source="purchase").status_code == 200
        assert google_gp.play.ack_calls == [(HEARTS, token)]
        post_rtdn(client, developer_notification(one_time=(1, other)), bearer=bearer)
        google_gp.play.voided_pages = [voided_page([voided_record(token, NOW())])]
        post_rtdn(client, developer_notification(voided={"purchaseToken": token, "productType": 2}))
        post_rtdn(client, developer_notification(test=True), bearer=oidc_token(aud="x"))
        google_gp.play.get_errors.append(500)
        post_google(client, sid(), tok())
        await poll_voided_purchases(google_gp.verifier, get_session_factory())
        await acknowledge_sweep(google_gp.verifier, get_session_factory())
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


def test_rtdn_is_rate_limited_and_body_capped(client, google_gp) -> None:
    assert GOOGLE_NOTIFICATION_IP_RATE_LIMIT == "300/minute"
    r = rtdn_raw(client, {"Authorization": f"Bearer {oidc_token()}"}, b"x" * (33 * 1024))
    assert r.status_code == 413


def test_sentry_scrubs_google_keys() -> None:
    import main

    for key in ("purchaseToken", "obfuscatedExternalAccountId", "orderId", "account_token"):
        assert key in main.SENTRY_SCRUBBED_KEYS


# ---------------------------------------------------------------------------
# Review fixes: event ordering (B2, S1), account token (S2), budgets (N3), partial refunds (N4)
# ---------------------------------------------------------------------------


async def test_pending_rtdn_racing_completion_keeps_epoch_so_the_grant_applies(
    client, google_gp
) -> None:
    """Review B2: PURCHASED arrives at Tc+2s while Play still says PENDING; the
    client's later post (completion Tc) must still grant and acknowledge."""
    session, token = sid(), tok()
    tc = NOW() - timedelta(seconds=30)
    google_gp.play.purchases[token] = play_purchase(state="PENDING")
    note = developer_notification(one_time=(1, token), event_at=tc + timedelta(seconds=2))
    assert post_rtdn(client, note).json() == {"status": "applied"}
    pending = await row(token)
    assert pending.state == "pending" and utc(pending.state_changed_at) == PENDING_EVENT_AT
    google_gp.play.purchases[token] = play_purchase(completed=tc)
    r = post_google(client, session, token)
    assert r.status_code == 200 and r.json()["status"] == "owned"
    assert jwt_games(client, session) == ["hearts"]
    assert (await row(token)).acknowledged_at is not None


async def test_replayed_far_future_purchased_cannot_block_a_later_void(client, google_gp) -> None:
    """Review S1: a captured push token replayed with eventTimeMillis in 2036."""
    tc = NOW() - timedelta(minutes=10)
    session, token = grant(client, google_gp, completed=tc)
    future = datetime(2036, 1, 1, tzinfo=UTC)
    replay = developer_notification(one_time=(1, token), event_at=future)
    post_rtdn(client, replay)
    assert utc((await row(token)).state_changed_at) < NOW()  # ordered by completion time
    google_gp.play.purchases[token] = play_purchase(state="CANCELLED", completed=tc)
    void = developer_notification(voided={"purchaseToken": token, "productType": 2})
    assert post_rtdn(client, void).json() == {"status": "applied"}
    assert jwt_games(client, session) == []


async def test_far_future_event_time_is_clamped(client, google_gp) -> None:
    _, token = grant(client, google_gp)
    google_gp.play.purchases[token] = play_purchase(state="CANCELLED")
    future = datetime(2036, 1, 1, tzinfo=UTC)
    note = developer_notification(
        voided={"purchaseToken": token, "productType": 2}, event_at=future
    )
    assert post_rtdn(client, note).json() == {"status": "applied"}
    changed = utc((await row(token)).state_changed_at)
    assert changed <= NOW() + google_rtdn.EVENT_TIME_LEEWAY
    assert google_rtdn.clamp_event_time(None, NOW()) is None


async def test_rtdn_ack_is_bounded(client, google_gp, monkeypatch) -> None:
    async def hang(evidence):
        await asyncio.sleep(3600)

    monkeypatch.setattr(google_rtdn, "RTDN_ACK_BUDGET_S", 0.05)
    monkeypatch.setattr(google_gp.verifier, "acknowledge", hang)
    token = tok()
    google_gp.play.purchases[token] = play_purchase()
    assert post_rtdn(client, developer_notification(one_time=(1, token))).status_code == 200
    assert (await row(token)).acknowledged_at is None


async def test_partial_refunds_are_ignored_on_both_paths(client, google_gp) -> None:
    """Review N4: a quantity-based partial refund voids nothing, via RTDN or the poll."""
    session, token = grant(client, google_gp)
    partial = {**voided_record(token, NOW()), "voidedQuantity": 1}
    google_gp.play.voided_pages = [voided_page([partial])]
    r = post_rtdn(client, developer_notification(voided={"purchaseToken": token, "productType": 2}))
    assert r.json() == {"status": "unconfirmed"}
    result = await poll_voided_purchases(google_gp.verifier, get_session_factory())
    assert (result.fetched, result.applied) == (1, 0)
    assert jwt_games(client, session) == ["hearts"]

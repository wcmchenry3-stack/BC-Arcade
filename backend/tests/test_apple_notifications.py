"""App Store Server Notifications V2 and the notification-history replay (#2786).

Covers ``purchases/apple_notifications.py``: ``POST /purchases/apple/notifications``
(refunds and reversals in and out of order, dedupe, environment guards, webhook
body limits and rate limit), ``record_store_purchase`` for notification-only
purchases, and the history replay and its loop. Split out of
``test_apple_iap.py`` (#2955) along the store / notifications seam of #2998;
the harness lives in ``tests/_apple_iap_harness.py``.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import jwt
import pytest
from appstoreserverlibrary.api_client import APIException
from fastapi.testclient import TestClient

from db.base import get_session_factory
from db.models import GameEntitlement, PurchaseEvent, PurchaseLink
from jobs import periodic
from observability import report
from purchases import apple, apple_notifications, apple_store
from purchases.apple_notifications import apple_replay_job, replay_notification_history
from purchases.apple_store import AppStoreVerifier
from rate_limits import APPLE_NOTIFICATION_IP_RATE_LIMIT
from tests._apple_iap_harness import (
    CASCADE,
    FakeApiClient,
    config,
    make_verifier,
    post_note,
    post_txn,
    purchase_row,
    signed_note,
    signed_txn,
    tamper,
)
from tests._helpers import count, jwt_games
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

# Shared fixtures (apple_use_verifier, apple_verifier) come from the harness module.
pytest_plugins = ["tests._apple_iap_harness"]


# ---------------------------------------------------------------------------
# POST /purchases/apple/notifications
# ---------------------------------------------------------------------------


def _grant(client: TestClient, key: str) -> str:
    sid = str(uuid.uuid4())
    assert post_txn(client, sid, signed_txn(key)).json()["status"] == "owned"
    return sid


async def test_refund_then_refund_reversed(client: TestClient, apple_verifier) -> None:
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
    client: TestClient, apple_verifier
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
    watermark = row.state_changed_at.replace(tzinfo=UTC)
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
    client: TestClient, apple_verifier
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
    client: TestClient, apple_verifier
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


async def test_duplicate_notification_is_a_noop(client: TestClient, apple_verifier) -> None:
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
    client: TestClient, apple_verifier, caplog: pytest.LogCaptureFixture
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


def test_notification_with_forged_embedded_transaction_is_422(client, apple_verifier) -> None:
    _grant(client, "6400")
    inner = tamper(signed_txn("6400"), revocationDate=now_ms())
    assert post_note(client, signed_note("REFUND", inner)).status_code == 422


def test_production_notification_needs_matching_app_apple_id(client, apple_verifier) -> None:
    note = signed_note("TEST", None, environment="Production", app_apple_id=APP_APPLE_ID + 1)
    assert post_note(client, note).status_code == 422
    ok = signed_note("TEST", None, environment="Production")
    assert post_note(client, ok).json() == {"status": "test"}


@pytest.mark.parametrize(
    "ntype", ["CONSUMPTION_REQUEST", "REFUND_DECLINED", "DID_RENEW", "EXPIRED", "PRICE_INCREASE"]
)
def test_irrelevant_notifications_are_acknowledged(client, apple_verifier, ntype) -> None:
    sid = _grant(client, "6500")
    r = post_note(client, signed_note(ntype, signed_txn("6500", revocationDate=now_ms())))
    assert r.status_code == 200 and r.json() == {"status": "ignored"}
    assert jwt_games(client, sid) == ["hearts"]


def test_notification_for_foreign_product_or_without_transaction_is_ignored(
    client, apple_verifier
) -> None:
    r = post_note(client, signed_note("REFUND", signed_txn("6600", productId="com.example.x")))
    assert r.json() == {"status": "ignored"}
    r = post_note(client, signed_note("REFUND", signed_txn("6601", type="Consumable")))
    assert r.json() == {"status": "ignored"}
    r = post_note(client, signed_note("REFUND", None))
    assert r.json() == {"status": "ignored"}


def test_notification_from_disallowed_environment_is_acknowledged(
    client, apple_use_verifier
) -> None:
    """Review N1: verified but not accepted here → 200 ignored, so Apple stops retrying."""
    apple_use_verifier(make_verifier(envs=frozenset({"production"})))
    r = post_note(client, signed_note("REFUND", signed_txn("6980", revocationDate=now_ms())))
    assert r.status_code == 200 and r.json() == {"status": "ignored"}
    # It must still verify: a forged Sandbox notification is refused.
    forged = tamper(signed_note("TEST", None), version="9")
    assert post_note(client, forged).status_code == 422


async def test_disallowed_environment_notification_records_nothing(
    client, apple_use_verifier
) -> None:
    apple_use_verifier(make_verifier(envs=frozenset({"production"})))
    note = signed_note("ONE_TIME_CHARGE", signed_txn("6981"))
    assert post_note(client, note).json() == {"status": "ignored"}
    assert await purchase_row("6981") is None


def test_notification_environment_we_cannot_verify_is_422(client, apple_use_verifier) -> None:
    # Sandbox-only deployment without APPLE_APP_ID: a Production notification cannot be verified.
    apple_use_verifier(
        AppStoreVerifier(
            config(frozenset({"sandbox"}), app_id=None), root_certificates=[default_ca().root_der]
        )
    )
    r = post_note(client, signed_note("TEST", None, environment="Production"))
    assert r.status_code == 422 and r.json()["detail"] == "environment_not_allowed"
    empty = default_ca().sign({"notificationType": "TEST", "notificationUUID": "x"})
    assert post_note(client, empty).status_code == 422
    assert post_note(client, signed_note("TEST", None, environment="Xcode")).status_code == 422


def test_notification_environment_is_found_where_the_library_looks() -> None:
    env = apple_store._notification_environment
    assert env({"data": {"environment": "Sandbox"}, "summary": {"environment": "X"}}) == "Sandbox"
    assert env({"summary": {"environment": "Production"}}) == "Production"
    assert env({"externalPurchaseToken": {"externalPurchaseId": "SANDBOX_1"}}) == "Sandbox"
    assert env({"externalPurchaseToken": {"externalPurchaseId": "abc"}}) == "Production"
    assert env({"appData": {"environment": "Sandbox"}}) == "Sandbox"
    assert env({"data": {}, "appData": {"environment": "Production"}}) == "Production"
    assert env({}) is None


@pytest.mark.parametrize(
    ("section", "expected"),
    [
        (
            {
                "appData": {
                    "bundleId": BUNDLE_ID,
                    "appAppleId": APP_APPLE_ID,
                    "environment": "Sandbox",
                }
            },
            200,
        ),
        (
            {
                "externalPurchaseToken": {
                    "externalPurchaseId": "SANDBOX_123",
                    "bundleId": BUNDLE_ID,
                    "appAppleId": APP_APPLE_ID,
                }
            },
            200,
        ),
        (
            {
                "externalPurchaseToken": {
                    "externalPurchaseId": "123",
                    "bundleId": BUNDLE_ID,
                    "appAppleId": APP_APPLE_ID,
                }
            },
            200,
        ),
    ],
    ids=["appData", "external-sandbox", "external-production"],
)
def test_notifications_without_data_or_summary_verify_and_ack(
    client, apple_verifier, section, expected
) -> None:
    body = {
        "notificationType": "RESCIND_CONSENT",
        "notificationUUID": str(uuid.uuid4()),
        "version": "2.0",
        "signedDate": now_ms(),
        **section,
    }
    r = post_note(client, default_ca().sign(body))
    assert r.status_code == expected and r.json() == {"status": "ignored"}


async def test_notification_from_other_environment_never_touches_purchase(
    client: TestClient, apple_verifier
) -> None:
    """Review N4: a Production notification must not act on a Sandbox purchase row."""
    sid = _grant(client, "6990")  # Sandbox purchase
    note = signed_note(
        "REFUND",
        signed_txn("6990", environment="Production", revocationDate=now_ms()),
        environment="Production",
        signed_date=now_ms(timedelta(minutes=1)),
    )
    assert post_note(client, note).json() == {"status": "unchanged"}
    assert (await purchase_row("6990")).state == "owned"
    assert jwt_games(client, sid) == ["hearts"]
    assert await count(PurchaseEvent, PurchaseEvent.kind == "environment_mismatch") == 1
    assert post_note(client, note).json() == {"status": "unchanged"}  # redelivery: dedupe
    assert await count(PurchaseEvent, PurchaseEvent.kind == "environment_mismatch") == 1


async def test_environment_mismatch_dedupe_race_is_a_noop(
    client, apple_verifier, monkeypatch
) -> None:
    from purchases import service

    _grant(client, "6991")
    real = service._dedupe_seen

    async def never(db, key):
        return False

    async with get_session_factory()() as db:
        assert not await service.apply_store_state(
            db,
            platform="apple",
            store_key="6991",
            state="revoked",
            dedupe_key="mm",
            environment="production",
        )
    monkeypatch.setattr(service, "_dedupe_seen", never)
    async with get_session_factory()() as db:  # same dedupe key again → unique violation
        assert not await service.apply_store_state(
            db,
            platform="apple",
            store_key="6991",
            state="revoked",
            dedupe_key="mm",
            environment="production",
        )
    monkeypatch.setattr(service, "_dedupe_seen", real)
    assert (await purchase_row("6991")).state == "owned"


# ---------------------------------------------------------------------------
# Webhook body, limits and notification-only purchases
# ---------------------------------------------------------------------------


def test_well_signed_but_unstructurable_notification_is_422(client, apple_verifier) -> None:
    for body in (
        {**notification("TEST", None), "signedDate": "yesterday"},  # fails in the verifier
        notification("TEST", None, app_apple_id="abc"),  # type: ignore[arg-type] — model error
    ):
        r = post_note(client, default_ca().sign(body))
        assert r.status_code == 422 and r.json()["detail"] == "verification_failed"


def test_malformed_webhook_body_is_400(client, apple_verifier) -> None:
    assert client.post("/purchases/apple/notifications", json={}).status_code == 400
    assert post_note(client, "not-a-jws").status_code == 400
    r = client.post("/purchases/apple/notifications", json={"signedPayload": "a" * 30_001})
    assert r.status_code == 400


def test_oversized_webhook_body_is_413(client, apple_verifier) -> None:
    body = json.dumps({"signedPayload": "a" * 40_000})
    r = client.post(
        "/purchases/apple/notifications",
        content=body,
        headers={"Content-Type": "application/json", "Content-Length": str(len(body))},
    )
    assert r.status_code == 413


def test_webhook_is_rate_limited_per_ip(client, apple_verifier) -> None:
    limit = int(APPLE_NOTIFICATION_IP_RATE_LIMIT.split("/")[0])
    note = signed_note("TEST", None)
    for _ in range(limit):
        assert post_note(client, note).status_code == 200
    assert post_note(client, note).status_code == 429


async def test_one_time_charge_records_without_linking(client, apple_verifier) -> None:
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


async def test_refund_before_any_client_post_blocks_an_older_jws(client, apple_verifier) -> None:
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
            db, replace(base, state="revoked"), event_at=datetime.now(UTC)
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
    monkeypatch.setattr(report.sentry_sdk, "capture_exception", lambda exc: captured.append(exc))
    with pytest.raises(asyncio.CancelledError):
        await apple_replay_job(lambda: None, get_session_factory, interval_s=123.0).loop(
            sleep=fake_sleep
        )
    assert calls["n"] == 3  # every failure was retried on the next cycle
    assert sleeps == [123.0, 123.0, 123.0]
    assert len(captured) == 3 and all(isinstance(e, RuntimeError) for e in captured)


async def test_lifespan_starts_replay_only_when_api_configured(monkeypatch) -> None:
    from jobs.lifespan import apple_replay_job as configured_job

    apple.reset_apple_verifier()
    assert configured_job() is None  # dormant
    apple._verifier = make_verifier(api={"sandbox": FakeApiClient()})
    try:
        job = configured_job()
        assert job is not None and job.name == "apple_replay" and not job.reraise_on_crash
        # A stand-in task: running the real loop would start a replay/sweep
        # against the fakes depending on scheduling; only the stop is checked.
        task = asyncio.create_task(asyncio.sleep(3600))
        await asyncio.sleep(0)
        await job.stop(task)
        assert task.cancelled()
        await job.stop(None)
        apple._verifier = make_verifier()  # no API → no job
        assert configured_job() is None
    finally:
        apple.reset_apple_verifier()


async def test_stop_replay_is_bounded(monkeypatch) -> None:
    monkeypatch.setattr(periodic, "STOP_TIMEOUT_S", 0.01)

    release = asyncio.Event()

    async def stubborn():
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            await release.wait()  # absorbs the first cancel

    task = asyncio.create_task(stubborn())
    await asyncio.sleep(0)
    await apple_replay_job(lambda: None, get_session_factory).stop(task)
    assert not task.done()
    release.set()
    await task


# ---------------------------------------------------------------------------
# Review follow-ups: misconfiguration reporting, production online checks, replay
# ---------------------------------------------------------------------------


async def test_replay_does_not_count_disallowed_environment_as_failed() -> None:
    api = FakeApiClient()
    v = make_verifier(envs=frozenset({"production"}), api={"production": api})
    api.pages = [_page([signed_note("REFUND", signed_txn("7950"))], None, False)]
    result = await replay_notification_history(v, get_session_factory())
    assert (result.fetched, result.failed, result.applied) == (1, 0, 0)


async def test_replay_warns_when_page_limit_is_hit(caplog: pytest.LogCaptureFixture) -> None:
    api = FakeApiClient()
    api.pages = [_page([], "1", True), _page([], "2", True), _page([], "3", True)]
    v = make_verifier(api={"sandbox": api})
    result = await replay_notification_history(v, get_session_factory(), max_pages=2)
    assert result.truncated_environments == 1 and api.history_calls == 2
    assert "apple_replay_page_limit" in caplog.text


# ---------------------------------------------------------------------------
# Body-size middleware on the unauthenticated webhook (review N6)
# ---------------------------------------------------------------------------


def _chunks(data: bytes, size: int = 1024):
    for i in range(0, len(data), size):
        yield data[i : i + size]


@pytest.mark.parametrize("value", ["abc", "-1", "1e3", " 12x"])
def test_non_numeric_content_length_is_400(client, apple_verifier, value) -> None:
    r = client.post(
        "/purchases/apple/notifications",
        content=b"{}",
        headers={"Content-Type": "application/json", "Content-Length": value},
    )
    assert r.status_code == 400


def test_chunked_body_over_cap_is_413(client, apple_verifier) -> None:
    body = json.dumps({"signedPayload": "a" * 40_000}).encode()
    r = client.post(
        "/purchases/apple/notifications",
        content=_chunks(body),
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 413


def test_chunked_body_within_cap_is_processed(client, apple_verifier) -> None:
    body = json.dumps({"signedPayload": signed_note("TEST", None)}).encode()
    r = client.post(
        "/purchases/apple/notifications",
        content=_chunks(body),
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 200 and r.json() == {"status": "test"}


async def test_body_middleware_stops_on_client_disconnect() -> None:
    from main import MaxBodySizeMiddleware

    called = False

    async def app(scope, receive, send):
        nonlocal called
        called = True

    messages = [
        {"type": "http.request", "body": b"{", "more_body": True},
        {"type": "http.disconnect"},
    ]

    async def receive():
        return messages.pop(0)

    async def send(message):
        raise AssertionError("nothing should be sent")

    scope = {"type": "http", "path": "/purchases/apple/notifications", "headers": []}
    await MaxBodySizeMiddleware(app)(scope, receive, send)
    assert not called
    # Non-HTTP scopes pass straight through.
    await MaxBodySizeMiddleware(app)({"type": "lifespan"}, receive, send)
    assert called

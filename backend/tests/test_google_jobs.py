"""Google background jobs: acknowledgement sweep, voided-purchases poll, jobs loop (#2787).

Follows the planned ``purchases/google_jobs.py`` (#2998): ``acknowledge_sweep``,
``poll_voided_purchases`` and ``run_google_jobs[_loop]`` in
``purchases/google_notifications.py`` today, plus the lifespan wiring and the
manual script. Split out of ``test_google_iap.py`` (#2955); the harness lives
in ``tests/_google_iap_harness.py``.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from db.base import get_session_factory
from db.models import Purchase
from observability import report
from purchases import google, google_notifications
from purchases import service as purchase_service
from purchases.google_notifications import (
    acknowledge_sweep,
    google_jobs_job,
    poll_voided_purchases,
    run_google_jobs,
)
from tests._google_iap_harness import (
    NOW,
    Harness,
    grant,
    make_harness,
    post_google,
    row,
    sid,
    tok,
    utc,
)
from tests._helpers import jwt_games
from tests.google_play_fakes import play_purchase, voided_page, voided_record

# Shared fixtures (google_gp) come from the harness module.
pytest_plugins = ["tests._google_iap_harness"]


# ---------------------------------------------------------------------------
# Acknowledgement
# ---------------------------------------------------------------------------


async def test_ack_failure_keeps_grant_for_the_sweep(
    client: TestClient, google_gp: Harness
) -> None:
    google_gp.play.ack_errors += [503, 503, 503]
    session, token = grant(client, google_gp)
    assert jwt_games(client, session) == ["hearts"]
    assert (await row(token)).acknowledged_at is None
    # The sweep picks it up.
    result = await acknowledge_sweep(google_gp.verifier, get_session_factory())
    assert result.acknowledged >= 1
    assert (await row(token)).acknowledged_at is not None


async def test_ack_sweep_scope(client: TestClient, google_gp: Harness) -> None:
    fresh = grant(client, google_gp)[1]
    old = grant(client, google_gp, completed=NOW() - timedelta(days=10))[1]
    gone = grant(client, google_gp)[1]
    async with get_session_factory()() as db:
        await db.execute(
            update(Purchase)
            .where(Purchase.store_key.in_([fresh, old, gone]))
            .values(acknowledged_at=None)
        )
        await db.execute(update(Purchase).where(Purchase.store_key == gone).values(state="revoked"))
        await db.commit()
    for t in (fresh, old):
        google_gp.play.purchases[t]["acknowledgementState"] = "ACKNOWLEDGEMENT_STATE_PENDING"
    google_gp.play.ack_calls.clear()
    result = await acknowledge_sweep(google_gp.verifier, get_session_factory())
    swept = {t for _, t in google_gp.play.ack_calls}
    assert fresh in swept and old not in swept and gone not in swept
    assert (await row(fresh)).acknowledged_at is not None
    assert result.failed == 0
    # Repeating finds nothing new for this purchase.
    google_gp.play.ack_calls.clear()
    await acknowledge_sweep(google_gp.verifier, get_session_factory())
    assert fresh not in {t for _, t in google_gp.play.ack_calls}


async def test_ack_sweep_counts_failures(client: TestClient, google_gp: Harness) -> None:
    token = grant(client, google_gp)[1]
    async with get_session_factory()() as db:
        await db.execute(
            update(Purchase).where(Purchase.store_key == token).values(acknowledged_at=None)
        )
        await db.commit()
    google_gp.play.purchases[token] = play_purchase(
        state="CANCELLED"
    )  # Play refuses; not acknowledged
    result = await acknowledge_sweep(google_gp.verifier, get_session_factory())
    assert result.failed >= 1
    assert (await row(token)).acknowledged_at is None
    assert await acknowledge_sweep(None, get_session_factory()) is None


# ---------------------------------------------------------------------------
# Voided-purchases poll
# ---------------------------------------------------------------------------


async def test_voided_poll_paginates_revokes_and_dedupes(client, google_gp) -> None:
    session, known = grant(client, google_gp)
    unknown = tok()  # voided before any client posted it
    google_gp.play.purchases[unknown] = play_purchase()  # the purchase read lags the void
    foreign = tok()  # not readable: not ours
    voided_at = NOW() - timedelta(minutes=1)  # after the purchase completed
    google_gp.play.voided_pages = [
        voided_page(
            [voided_record(known, voided_at, reason=1), "junk", {"purchaseToken": ""}], "1"
        ),
        voided_page(
            [voided_record(unknown, voided_at, reason=5), voided_record(foreign, voided_at)]
        ),
    ]
    now = NOW()
    result = await poll_voided_purchases(google_gp.verifier, get_session_factory(), now=now)
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
    first, second = google_gp.play.voided_calls[:2]
    assert first["startTime"] == str(int((now - timedelta(hours=48)).timestamp() * 1000))
    assert first["endTime"] == str(int(now.timestamp() * 1000)) and "token" not in first
    assert second["token"] == "1"
    # A later client post of the voided-unknown token, with the lagging read, grants nothing.
    r = post_google(client, sid(), unknown)
    assert r.json()["status"] == "revoked"
    # Running again changes nothing (one dedupe key per voided purchase).
    again = await poll_voided_purchases(google_gp.verifier, get_session_factory(), now=now)
    assert again.applied == 0


async def test_voided_poll_page_cap_api_errors_and_window_clamp(google_gp, caplog) -> None:
    google_gp.play.voided_pages = [voided_page([], str(i + 1)) for i in range(5)]
    with caplog.at_level(logging.WARNING, logger="audit"):
        result = await poll_voided_purchases(google_gp.verifier, get_session_factory(), max_pages=3)
    assert result.truncated and len(google_gp.play.voided_calls) == 3
    assert "google_voided_page_limit" in caplog.text
    google_gp.play.voided_errors.append(500)
    result = await poll_voided_purchases(google_gp.verifier, get_session_factory())
    assert result.api_failed
    google_gp.play.voided_pages = []
    now = NOW()
    await poll_voided_purchases(
        google_gp.verifier, get_session_factory(), window=timedelta(days=90), now=now
    )
    start = int(google_gp.play.voided_calls[-1]["startTime"])
    assert start > int((now - timedelta(days=30)).timestamp() * 1000)
    assert await poll_voided_purchases(None, get_session_factory()) is None


async def test_voided_poll_counts_play_outage_for_unknown_token(google_gp) -> None:
    google_gp.play.voided_pages = [voided_page([voided_record(tok(), NOW())])]
    google_gp.play.get_errors.append(503)
    result = await poll_voided_purchases(google_gp.verifier, get_session_factory())
    assert result.failed == 1


# ---------------------------------------------------------------------------
# Jobs loop, lifespan and manual script
# ---------------------------------------------------------------------------


async def test_run_google_jobs(google_gp) -> None:
    assert await run_google_jobs(None, get_session_factory()) is None
    voided, swept = await run_google_jobs(google_gp.verifier, get_session_factory(), now=NOW())
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

    fixed = [datetime(2026, 9, 30, 12, tzinfo=UTC)]

    def clock() -> datetime:
        fixed[0] += timedelta(days=1)
        return fixed[0]

    monkeypatch.setattr(google_notifications, "run_google_jobs", failing)
    captured: list[BaseException] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_exception", lambda exc: captured.append(exc))
    with pytest.raises(asyncio.CancelledError):
        await google_jobs_job(lambda: None, get_session_factory, interval_s=77.0, clock=clock).loop(
            sleep=fake_sleep
        )
    assert sleeps == [77.0] * 3
    assert seen == [datetime(2026, 10, d, 12, tzinfo=UTC) for d in (1, 2, 3)]
    assert len(captured) == 3


async def test_lifespan_starts_google_jobs_only_when_configured(monkeypatch) -> None:
    from jobs import lifespan as jobs_lifespan

    google.reset_google_runtime()
    monkeypatch.delenv("GOOGLE_PLAY_PACKAGE_NAME", raising=False)
    assert jobs_lifespan.google_jobs_job() is None  # dormant
    google._runtime = make_harness().runtime
    try:
        job = jobs_lifespan.google_jobs_job()
        assert job is not None and job.name == "google_jobs" and not job.reraise_on_crash
        # A stand-in task: running the real loop would start a replay/sweep
        # against the fakes depending on scheduling; only the stop is checked.
        task = asyncio.create_task(asyncio.sleep(3600))
        await asyncio.sleep(0)
        await job.stop(task)
        assert task.cancelled()
        monkeypatch.setattr(jobs_lifespan, "is_configured", lambda: False)
        assert jobs_lifespan.google_jobs_job() is None
    finally:
        google.reset_google_runtime()


async def test_manual_script(google_gp, monkeypatch, capsys) -> None:
    import importlib.util
    import pathlib

    path = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "google_play_jobs.py"
    spec = importlib.util.spec_from_file_location("google_play_jobs", path)
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    assert await script._main(48, False) == 0
    assert "ack sweep" in capsys.readouterr().out
    google_gp.play.voided_errors.append(500)
    assert await script._main(48, False) == 1
    assert await script._main(48, True) == 0
    monkeypatch.setattr(script.google, "configured_verifier", lambda: None)
    assert await script._main(48, False) == 2
    monkeypatch.setattr(script, "is_configured", lambda: False)
    assert await script._main(48, False) == 2


async def test_service_acknowledge_mark_is_idempotent(client, google_gp) -> None:
    _, token = grant(client, google_gp)
    purchase = await row(token)
    first = purchase.acknowledged_at
    async with get_session_factory()() as db:
        await purchase_service.mark_acknowledged(db, purchase.id)
    assert (await row(token)).acknowledged_at == first

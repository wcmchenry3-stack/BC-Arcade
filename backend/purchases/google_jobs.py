"""Google Play backstops: voided-purchases poll and acknowledgement sweep (#2787, IAP.md §7.6).

:func:`poll_voided_purchases` reads ``voidedpurchases.list`` for the last 48 h
and revokes matches (event time ``voidedTimeMillis``, dedupe per voided
purchase); :func:`acknowledge_sweep` acknowledges ``owned`` purchases that are
still unacknowledged inside Google's 3-day window. Both run at startup and
daily (:func:`google_jobs_job`, a :class:`~jobs.periodic.PeriodicJob` started
by ``jobs.lifespan``) and by hand (``scripts/google_play_jobs.py``).

Nothing here logs a purchase token or an order id.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.models import Purchase
from jobs.periodic import PeriodicJob

from . import service
from ._common import log_event
from .google_play import PlayVerifier, parse_millis
from .google_rtdn import is_partial_refund, read_store_purchase, valid_token, voided_reason
from .verifiers import GoogleEvidence, PurchaseError

_log = logging.getLogger("audit")

# ---------------------------------------------------------------------------
# Voided-purchases poll
# ---------------------------------------------------------------------------

VOIDED_WINDOW = timedelta(hours=48)
VOIDED_MAX_PAGES = 50  # up to 1000 records a page; a bound, not an expectation
JOBS_INTERVAL_S = 24 * 60 * 60
JOBS_TIMEOUT_S = 300.0


@dataclass
class VoidedPollResult:
    fetched: int = 0
    applied: int = 0
    failed: int = 0
    api_failed: bool = False
    truncated: bool = False


def _voided_dedupe_key(token: str, voided_ms: object) -> str:
    # One key per voided purchase; the token itself never goes into the table.
    digest = hashlib.sha256(f"{token}:{voided_ms}".encode()).hexdigest()
    return f"google_voided:{digest}"


async def _apply_voided_record(
    verifier: PlayVerifier, record: dict[str, Any], session_factory: Callable[[], AsyncSession]
) -> bool:
    token = valid_token(record.get("purchaseToken"))
    if token is None or is_partial_refund(record):
        return False
    voided_at = parse_millis(record.get("voidedTimeMillis"))
    dedupe_key = _voided_dedupe_key(token, record.get("voidedTimeMillis"))
    reason = voided_reason(record.get("voidedReason"))
    async with session_factory() as db:
        if await service.purchase_exists(db, "google", token):
            return await service.apply_store_state(
                db,
                platform="google",
                store_key=token,
                state="revoked",
                reason=reason,
                dedupe_key=dedupe_key,
                event_at=voided_at,
            )
    # Never posted by a client: record it revoked (unlinked), so a later post
    # of this token cannot grant even if the purchase read still lags the void.
    verified = await read_store_purchase(verifier, token)
    if verified is None:
        return False
    revoked = replace(
        verified, state="revoked", revoked_at=voided_at, revocation_reason=reason, event_at=None
    )
    async with session_factory() as db:
        return await service.record_store_purchase(
            db, revoked, dedupe_key=dedupe_key, event_at=voided_at
        )


async def poll_voided_purchases(
    verifier: PlayVerifier | None,
    session_factory: Callable[[], AsyncSession],
    *,
    window: timedelta = VOIDED_WINDOW,
    now: datetime | None = None,
    max_pages: int = VOIDED_MAX_PAGES,
) -> VoidedPollResult | None:
    """Revoke every purchase ``voidedpurchases.list`` reports for the last ``window``.

    None (nothing done) while Google is not configured. Follows token
    pagination up to ``max_pages``; hitting the cap logs
    ``google_voided_page_limit`` and the rest waits for the next run. An API
    error ends the run (the next one retries). Idempotent: one dedupe key per
    voided purchase, and a revoke of a revoked purchase changes nothing.
    """
    if verifier is None:
        return None
    end = now or datetime.now(UTC)
    # The API refuses a startTime older than 30 days.
    start = max(end - window, end - timedelta(days=30) + timedelta(minutes=5))
    result = VoidedPollResult()
    page_token: str | None = None
    for page_no in range(max_pages):
        try:
            page = await verifier.api.list_voided(
                start_ms=int(start.timestamp() * 1000),
                end_ms=int(end.timestamp() * 1000),
                page_token=page_token,
            )
        except PurchaseError:
            result.api_failed = True
            _log.warning(json.dumps({"event": "google_voided_api_failed"}))
            break
        for record in page.get("voidedPurchases") or []:
            if not isinstance(record, dict):
                continue
            result.fetched += 1
            try:
                if await _apply_voided_record(verifier, record, session_factory):
                    result.applied += 1
            except PurchaseError:
                result.failed += 1
        page_token = (page.get("tokenPagination") or {}).get("nextPageToken")
        if not page_token:
            break
        if page_no == max_pages - 1:
            result.truncated = True
            _log.warning(json.dumps({"event": "google_voided_page_limit", "pages": max_pages}))
    log_event(
        "google_voided_poll_done",
        fetched=result.fetched,
        applied=result.applied,
        failed=result.failed,
        api_failed=result.api_failed,
        truncated=result.truncated,
    )
    return result


# ---------------------------------------------------------------------------
# Acknowledgement sweep
# ---------------------------------------------------------------------------

# Google refunds an unacknowledged purchase after 3 days; a day of slack so a
# purchase near the edge still gets its try. Older rows are left alone.
ACK_SWEEP_MAX_AGE = timedelta(days=4)
ACK_SWEEP_LIMIT = 500


@dataclass
class AckSweepResult:
    candidates: int = 0
    acknowledged: int = 0
    failed: int = 0


async def acknowledge_sweep(
    verifier: PlayVerifier | None,
    session_factory: Callable[[], AsyncSession],
    *,
    now: datetime | None = None,
    max_age: timedelta = ACK_SWEEP_MAX_AGE,
    limit: int = ACK_SWEEP_LIMIT,
) -> AckSweepResult | None:
    """Acknowledge ``owned`` Google purchases whose ``acknowledged_at`` is still null.

    Covers a failed in-request acknowledgement, a refused link (403/409), and
    an RTDN whose acknowledgement failed. Only purchases completed (or first
    recorded) within ``max_age``. Idempotent: an already-acknowledged purchase
    counts as success. None while Google is not configured.
    """
    if verifier is None:
        return None
    cutoff = (now or datetime.now(UTC)) - max_age
    # When the 3-day clock started: completion, else when we first recorded it.
    started = func.coalesce(Purchase.purchased_at, Purchase.created_at)
    async with session_factory() as db:
        due = (
            await db.execute(
                select(Purchase.id, Purchase.product_id, Purchase.store_key)
                .where(
                    Purchase.platform == "google",
                    Purchase.state == "owned",
                    Purchase.acknowledged_at.is_(None),
                    started >= cutoff,
                )
                .order_by(started)
                .limit(limit)
            )
        ).all()
    result = AckSweepResult(candidates=len(due))
    for row in due:
        evidence = GoogleEvidence(product_id=row.product_id, purchase_token=row.store_key)
        try:
            await verifier.acknowledge(evidence)
        except PurchaseError:
            result.failed += 1
            continue
        async with session_factory() as db:
            await service.mark_acknowledged(db, row.id)
        result.acknowledged += 1
    log_event(
        "google_ack_sweep_done",
        candidates=result.candidates,
        acknowledged=result.acknowledged,
        failed=result.failed,
    )
    return result


# ---------------------------------------------------------------------------
# Daily jobs
# ---------------------------------------------------------------------------


async def run_google_jobs(
    verifier: PlayVerifier | None,
    session_factory: Callable[[], AsyncSession],
    *,
    now: datetime | None = None,
    window: timedelta = VOIDED_WINDOW,
) -> tuple[VoidedPollResult, AckSweepResult] | None:
    """The voided poll, then the acknowledgement sweep. None while Google is not configured."""
    if verifier is None:
        return None
    voided = await poll_voided_purchases(verifier, session_factory, window=window, now=now)
    swept = await acknowledge_sweep(verifier, session_factory, now=now)
    return voided, swept  # type: ignore[return-value]


def google_jobs_job(
    get_verifier: Callable[[], PlayVerifier | None],
    get_session_factory: Callable[[], async_sessionmaker[AsyncSession]],
    *,
    interval_s: float = JOBS_INTERVAL_S,
    timeout_s: float = JOBS_TIMEOUT_S,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> PeriodicJob:
    """Run the Google jobs now, then every ``interval_s`` (started by ``jobs.lifespan``).

    A failure is reported and retried next cycle, never raised; a crashed task
    is swallowed at shutdown (``reraise_on_crash=False``). ``clock`` is
    injectable so tests drive cycles without real time.
    """

    return PeriodicJob(
        name="google_jobs",
        run=lambda: run_google_jobs(get_verifier(), get_session_factory(), now=clock()),
        interval_s=interval_s,
        timeout_s=timeout_s,
        subsystem_tag="purchases.google_jobs",
        fingerprint="google-play-jobs-failed",
        on_failure=lambda _exc: _log.warning(json.dumps({"event": "google_jobs_failed"})),
        on_stop_timeout=lambda _w: _log.warning(json.dumps({"event": "google_jobs_stop_timeout"})),
    )

"""App Store Server Notifications V2 and the notification-history replay (#2786, IAP.md §6.5).

:func:`handle_signed_notification` is the one path for a ``signedPayload``,
whether it arrived at ``POST /purchases/apple/notifications`` or was fetched
by :func:`replay_notification_history`:

1. verify the JWS with the environment's ``SignedDataVerifier`` (same chain,
   bundle id and environment checks as a client transaction; a failure raises
   :class:`~purchases.verifiers.PurchaseError` — the webhook answers 4xx);
2. for ``REFUND`` / ``REVOKE`` (→ revoked), ``REFUND_REVERSED`` (→ owned) and
   ``ONE_TIME_CHARGE`` (→ recorded from the transaction, unlinked), verify the embedded
   ``signedTransactionInfo`` and apply it with the notification's
   ``signedDate`` as the event time and ``notificationUUID`` as the dedupe key;
3. everything else (``TEST``, ``CONSUMPTION_REQUEST``, ``REFUND_DECLINED``,
   subscription types that cannot apply to non-consumables, …) is
   acknowledged and ignored, so Apple does not retry it.

Nothing here logs a payload, a transaction id or a token: only the
notification type, the outcome and Apple's ``notificationUUID``.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

import sentry_sdk
from appstoreserverlibrary.models.NotificationHistoryRequest import NotificationHistoryRequest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from . import service
from .apple_store import AppStoreVerifier, revocation_reason
from .verifiers import PurchaseError

_log = logging.getLogger("audit")

Outcome = Literal["applied", "unchanged", "ignored", "test"]

# Notification type → the state it moves a known purchase to.
_STATE_FOR_TYPE: dict[str, Literal["owned", "revoked"]] = {
    "REFUND": "revoked",
    "REVOKE": "revoked",
    "REFUND_REVERSED": "owned",
    "ONE_TIME_CHARGE": "owned",
}

# Replay settings (IAP.md §6.5): a 48 h window, once a day.
REPLAY_WINDOW = timedelta(hours=48)
REPLAY_INTERVAL_S = 24 * 60 * 60
REPLAY_MAX_PAGES = 100  # 20 notifications a page; a bound, not an expectation
REPLAY_TIMEOUT_S = 300.0


def _ms(value: int | None) -> datetime | None:
    return None if value is None else datetime.fromtimestamp(value / 1000, tz=timezone.utc)


def _log_event(event: str, **fields: object) -> None:
    _log.info(json.dumps({"event": event, **fields}))


async def handle_signed_notification(
    verifier: AppStoreVerifier,
    signed_payload: str,
    session_factory: Callable[[], AsyncSession],
    *,
    via: str = "webhook",
) -> Outcome:
    """Verify and apply one ASSN v2 ``signedPayload``. Raises PurchaseError if it fails verification."""
    env, note = await verifier.decode_notification(signed_payload)
    ntype = note.rawNotificationType or ""
    uuid_ = note.notificationUUID
    if not verifier.allows(env):
        # Genuine, but from an environment this deployment does not accept
        # (e.g. Sandbox on a Production-only API): acknowledge so Apple stops.
        _log_event("apple_notification", type=ntype, outcome="ignored", via=via, id=uuid_, env=env)
        return "ignored"
    if ntype == "TEST":
        _log_event("apple_notification", type=ntype, outcome="test", via=via, id=uuid_)
        return "test"
    target = _STATE_FOR_TYPE.get(ntype)
    signed_txn = note.data.signedTransactionInfo if note.data else None
    if target is None or not signed_txn or not uuid_:
        _log_event("apple_notification", type=ntype, outcome="ignored", via=via, id=uuid_)
        return "ignored"

    # The embedded transaction is verified too, pinned to the notification's environment.
    _, txn = await verifier.decode_transaction(signed_txn, env)
    try:
        verified = verifier.to_verified(env, txn)
    except PurchaseError:
        # Not a non-consumable of ours (e.g. a future product type): acknowledge.
        _log_event("apple_notification", type=ntype, outcome="ignored", via=via, id=uuid_)
        return "ignored"
    if service.slug_for_product(verified.product_id) is None:
        _log_event("apple_notification", type=ntype, outcome="ignored", via=via, id=uuid_)
        return "ignored"

    event_at = _ms(note.signedDate)
    reason = revocation_reason(txn) if target == "revoked" else None
    async with session_factory() as db:
        if ntype != "ONE_TIME_CHARGE" and await service.purchase_exists(
            db, "apple", verified.store_key
        ):
            changed = await service.apply_store_state(
                db,
                platform="apple",
                store_key=verified.store_key,
                state=target,
                reason=reason,
                dedupe_key=uuid_,
                event_at=event_at,
                environment=env,
            )
        else:
            # A new purchase, or one no client has posted yet: record the
            # transaction's own state, unlinked (grants nothing), so a later
            # post of an older JWS cannot undo a refund.
            changed = await service.record_store_purchase(
                db, verified, dedupe_key=uuid_, event_at=event_at
            )
    outcome: Outcome = "applied" if changed else "unchanged"
    _log_event("apple_notification", type=ntype, outcome=outcome, via=via, id=uuid_)
    return outcome


@dataclass
class ReplayResult:
    fetched: int = 0
    applied: int = 0
    failed: int = 0
    skipped_environments: int = 0
    truncated_environments: int = 0


async def replay_notification_history(
    verifier: AppStoreVerifier | None,
    session_factory: Callable[[], AsyncSession],
    *,
    window: timedelta = REPLAY_WINDOW,
    now: datetime | None = None,
    max_pages: int = REPLAY_MAX_PAGES,
) -> ReplayResult | None:
    """Replay the last ``window`` of App Store notifications through the webhook handler.

    Uses **Get Notification History** for every allowed environment that has
    an API client. Returns None (and does nothing) when Apple verification or
    the App Store Server API is not configured. Duplicates are no-ops (the
    ``notificationUUID`` dedupe), so overlapping windows and concurrent runs
    are safe. A notification that fails verification is counted and skipped;
    an API error ends that environment's run (counted) and the next run retries.
    """
    if verifier is None or not verifier.has_api:
        return None
    end = now or datetime.now(timezone.utc)
    start = end - window
    result = ReplayResult()
    for env in verifier.api_environments():
        client = verifier.api_client(env)
        token: str | None = None
        for page_no in range(max_pages):
            request = NotificationHistoryRequest(
                startDate=int(start.timestamp() * 1000), endDate=int(end.timestamp() * 1000)
            )
            try:
                page = await client.get_notification_history(token, request)
            except Exception:  # APIException, network or timeout
                result.skipped_environments += 1
                _log.warning(json.dumps({"event": "apple_replay_api_failed", "env": env}))
                break
            for item in page.notificationHistory or []:
                if not item.signedPayload:
                    continue
                result.fetched += 1
                try:
                    outcome = await handle_signed_notification(
                        verifier, item.signedPayload, session_factory, via="replay"
                    )
                except PurchaseError:
                    result.failed += 1
                    continue
                if outcome == "applied":
                    result.applied += 1
            token = page.paginationToken
            if not page.hasMore or not token:
                break
            if page_no == max_pages - 1:
                # More history than one run reads; the rest waits for the next
                # run (or a manual run with a shorter window).
                result.truncated_environments += 1
                _log.warning(
                    json.dumps({"event": "apple_replay_page_limit", "env": env, "pages": max_pages})
                )
    _log_event(
        "apple_replay_done",
        fetched=result.fetched,
        applied=result.applied,
        failed=result.failed,
        skipped_environments=result.skipped_environments,
        truncated_environments=result.truncated_environments,
    )
    return result


async def run_replay_loop(
    get_verifier: Callable[[], AppStoreVerifier | None],
    get_session_factory: Callable[[], async_sessionmaker[AsyncSession]],
    *,
    interval_s: float = REPLAY_INTERVAL_S,
    timeout_s: float = REPLAY_TIMEOUT_S,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> None:
    """Replay now, then every ``interval_s``, until cancelled (started by ``main.lifespan``).

    Same shape as the Daily Word retention loop: a failure is reported and
    retried next cycle, never raised. ``sleep`` is injectable so tests can
    drive cycles without real time.
    """
    while True:
        try:
            await asyncio.wait_for(
                replay_notification_history(get_verifier(), get_session_factory()),
                timeout=timeout_s,
            )
        except Exception as exc:  # any failure waits for the next cycle
            _log.warning(json.dumps({"event": "apple_replay_failed"}))
            with sentry_sdk.new_scope() as scope:
                scope.set_tag("subsystem", "purchases.apple_replay")
                scope.fingerprint = ["apple-notification-replay-failed"]
                sentry_sdk.capture_exception(exc)
        await sleep(interval_s)

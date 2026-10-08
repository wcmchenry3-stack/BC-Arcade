"""Purchase, link and entitlement logic for verified store purchases (#840).

Implements docs/IAP.md §4 (ownership and capped links) and §8.1-8.2
(idempotency rules). The inputs are a store-verified
:class:`~purchases.verifiers.VerifiedPurchase` and the calling session; this
module never sees unverified evidence.

Invariants:

* ``purchases`` has one row per ``(platform, store_key)``; its ``state``
  follows the store's latest verified answer.
* ``purchase_links`` is the ownership record. A link beyond
  ``MAX_SESSIONS_PER_PURCHASE`` or ``MAX_NEW_LINKS_PER_PURCHASE_PER_30D`` is
  refused with ``409 link_limit``; nothing is ever evicted.
* ``game_entitlements`` is *derived* for purchased games by
  :func:`recompute_entitlement`, in the same transaction as every link or
  state change. Legacy rows (``source = 'legacy'``) are never touched.
* ``purchases.state_changed_at`` is the ordering watermark: the store time of
  the latest applied transition, or of a later **store-pushed** event
  (notification, webhook, cron) that confirmed the current state. A verified
  answer or notification that would change the state and is older than it is
  ignored, so out-of-order webhooks and stale client re-posts cannot undo a
  newer state. A same-state **client** answer never moves it: its time may be
  only when the request started verifying, and must not hide a real store
  event signed slightly earlier.
* ``owned`` never regresses to ``pending``.

Concurrency (Postgres): the purchase row is locked (``FOR UPDATE``) before any
link or state change; derived rows are written with one ``INSERT ... ON
CONFLICT DO UPDATE``, after locking the existing row, and several sessions are
always recomputed in ``(session_id, game_slug)`` order so two transactions
never lock the same rows in opposite orders.
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from db.dialect import dialect_insert
from db.models import GameEntitlement, GameType, Purchase, PurchaseEvent, PurchaseLink

from . import apple, google
from .verifiers import PurchaseError, VerifiedPurchase, allowed_environments

# Owner-tunable (docs/IAP.md §4, §17 Q4).
MAX_SESSIONS_PER_PURCHASE = 5
MAX_NEW_LINKS_PER_PURCHASE_PER_30D = 3
NEW_LINK_WINDOW = timedelta(days=30)

# Same prefix as frontend/src/entitlements/premiumProducts.json (IAP.md §2).
# The backend never reads the JSON; test_premium_products.py keeps them in step.
PRODUCT_ID_PREFIX = "com.buffingchi.games.premium."

Source = Literal["purchase", "restore", "sync"]

_audit_log = logging.getLogger("audit")


def _now() -> datetime:
    return datetime.now(UTC)


def _utc(dt: datetime) -> datetime:
    """``dt`` as an aware UTC datetime (SQLite hands back naive values)."""
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def _is_stale(purchase: Purchase, event_at: datetime) -> bool:
    """True when ``event_at`` is older than the purchase's last applied transition."""
    changed = purchase.state_changed_at
    return changed is not None and _utc(event_at) < _utc(changed)


def session_hash(session_id: str) -> str:
    """SHA-256 of the session id — what audit rows and log lines carry instead of it."""
    return hashlib.sha256(session_id.encode("utf-8")).hexdigest()


def slug_for_product(product_id: str) -> str | None:
    """The game slug a product ID names, or None if it does not follow the convention."""
    if not product_id.startswith(PRODUCT_ID_PREFIX):
        return None
    slug = product_id[len(PRODUCT_ID_PREFIX) :]
    return slug or None


def account_token_matches(platform: str, session_id: str, token: str | None) -> bool:
    if platform == "apple":
        return apple.account_token_matches(session_id, token)
    return google.account_token_matches(session_id, token)


@dataclass(frozen=True)
class PurchaseResult:
    status: Literal["owned", "pending", "revoked"]
    game_slug: str
    product_id: str
    purchase_id: uuid.UUID
    needs_acknowledgement: bool


# ---------------------------------------------------------------------------
# Derived entitlements
# ---------------------------------------------------------------------------


async def recompute_entitlement(db: AsyncSession, session_id: str, game_slug: str) -> None:
    """Make the session's ``game_entitlements`` row for ``game_slug`` match its links.

    A row exists exactly when some ``purchase_links`` row of this session joins
    an ``owned`` purchase of ``game_slug`` (IAP.md §8.1). A legacy row is left
    as it is. A purchase-derived row whose purchase was deleted (``purchase_id``
    set NULL by the foreign key) is re-pointed at another qualifying purchase
    or removed. Does not commit.

    Race-safe on Postgres: the existing row is locked first and the qualifying
    purchase is looked up *after* that lock, so a delete never acts on an
    answer a concurrent grant has since changed; the write is a single
    ``INSERT ... ON CONFLICT (session_id, game_slug) DO UPDATE``, so two
    concurrent grants cannot both insert.
    """
    where = (
        GameEntitlement.session_id == session_id,
        GameEntitlement.game_slug == game_slug,
    )
    existing = (
        await db.execute(select(GameEntitlement.source).where(*where).with_for_update())
    ).first()
    if existing is not None and existing.source == "legacy":
        return

    qualifying = (
        await db.execute(
            select(Purchase.id, PurchaseLink.source, PurchaseLink.last_verified_at)
            .join(PurchaseLink, PurchaseLink.purchase_id == Purchase.id)
            .where(
                PurchaseLink.session_id == session_id,
                Purchase.game_slug == game_slug,
                Purchase.state == "owned",
            )
            .order_by(PurchaseLink.created_at, Purchase.id)
            .limit(1)
        )
    ).first()

    if qualifying is None:
        if existing is not None:
            await db.execute(
                delete(GameEntitlement)
                .where(*where, GameEntitlement.source != "legacy")
                .execution_options(synchronize_session=False)
            )
        return

    purchase_id, source, last_verified_at = qualifying
    stmt = dialect_insert(db, GameEntitlement).values(
        id=uuid.uuid4(),
        session_id=session_id,
        game_slug=game_slug,
        purchase_id=purchase_id,
        source=source,
        last_verified_at=last_verified_at,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["session_id", "game_slug"],
        set_={
            "purchase_id": stmt.excluded.purchase_id,
            "source": stmt.excluded.source,
            "last_verified_at": stmt.excluded.last_verified_at,
        },
        # A legacy row that appeared concurrently still wins.
        where=GameEntitlement.source != "legacy",
    )
    await db.execute(stmt.execution_options(synchronize_session=False))


async def _recompute_all_links(db: AsyncSession, purchase: Purchase) -> None:
    """Recompute every linked session, in a fixed ``(session_id, game_slug)`` order.

    The order is what keeps two transactions that recompute overlapping
    sessions (a revoke and a link, two revokes of one session's purchases)
    from taking row locks in opposite orders and deadlocking.
    """
    await _recompute_sessions(
        db,
        (
            await db.execute(
                select(PurchaseLink.session_id).where(PurchaseLink.purchase_id == purchase.id)
            )
        )
        .scalars()
        .all(),
        purchase.game_slug,
    )


async def _recompute_sessions(db: AsyncSession, session_ids: Iterable[str], game_slug: str) -> None:
    for sid in sorted(set(session_ids)):
        await recompute_entitlement(db, sid, game_slug)


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


def _event(
    db: AsyncSession,
    purchase: Purchase | None,
    kind: str,
    *,
    session_id: str | None = None,
    dedupe_key: str | None = None,
    **detail: object,
) -> None:
    shash = session_hash(session_id) if session_id else None
    db.add(
        PurchaseEvent(
            purchase_id=purchase.id if purchase else None,
            kind=kind,
            dedupe_key=dedupe_key,
            session_hash=shash,
            detail=detail,
        )
    )
    # Raw session ids and store tokens are never logged (IAP.md §4).
    _audit_log.info(
        json.dumps(
            {
                "event": f"purchase_{kind}",
                "purchase_id": str(purchase.id) if purchase else None,
                "session_hash": shash,
                **{k: v for k, v in detail.items() if isinstance(v, str | int | bool | None)},
            }
        )
    )


# ---------------------------------------------------------------------------
# Upsert
# ---------------------------------------------------------------------------


async def _premium_slug_for(db: AsyncSession, product_id: str) -> str:
    slug = slug_for_product(product_id)
    if slug is None:
        raise PurchaseError(422, "unknown_product")
    # Straight from the DB, never the catalog cache (#2966): the store has already
    # charged the user, so a worker's stale snapshot must not reject a game that
    # was just made premium. This path is not hot.
    is_premium = (
        await db.execute(select(GameType.is_premium).where(GameType.name == slug))
    ).scalar_one_or_none()
    if not is_premium:
        raise PurchaseError(422, "unknown_product")
    return slug


def _advance_watermark(purchase: Purchase, event_at: datetime) -> bool:
    """Move ``state_changed_at`` forward to ``event_at`` (never back). True if it moved."""
    if purchase.state_changed_at is None or _utc(event_at) > _utc(purchase.state_changed_at):
        purchase.state_changed_at = event_at
        return True
    return False


def _set_state(
    purchase: Purchase, state: str, revoked_at: datetime | None, now: datetime, reason: str | None
) -> None:
    """Set ``state`` verified ``now``; the caller owns ``state_changed_at`` (the watermark).

    ``revoked`` stores ``revoked_at``/``reason``, ``owned`` clears them, others keep them."""
    purchase.state = state
    purchase.verified_at = now
    if state == "revoked":
        purchase.revoked_at = revoked_at
        purchase.revocation_reason = reason
    elif state == "owned":
        purchase.revoked_at = None
        purchase.revocation_reason = None


def _apply_verified(
    purchase: Purchase,
    v: VerifiedPurchase,
    now: datetime,
    event_at: datetime,
    *,
    store_event: bool = False,
) -> None:
    if purchase.state != v.state or purchase.state_changed_at is None:
        purchase.state_changed_at = event_at
    elif store_event:
        # A store-pushed event confirming the current state still advances the
        # ordering watermark, so an older opposite event cannot flip it later.
        _advance_watermark(purchase, event_at)
    # No revocation time or reason in the answer keeps the recorded ones (else: now).
    reason = v.revocation_reason or purchase.revocation_reason
    _set_state(purchase, v.state, v.revoked_at or purchase.revoked_at or now, now, reason)
    purchase.environment = v.environment
    purchase.ownership_type = v.ownership_type
    if v.transaction_id is not None:
        purchase.store_transaction_id = v.transaction_id
    if v.account_token is not None:
        purchase.account_token = v.account_token
    if v.purchased_at is not None:
        purchase.purchased_at = v.purchased_at
    if v.acknowledged and purchase.acknowledged_at is None:
        purchase.acknowledged_at = now


async def _lock_purchase(db: AsyncSession, platform: str, store_key: str) -> Purchase | None:
    # FOR UPDATE on Postgres serializes the link-cap count for one purchase;
    # SQLite ignores it (its writes are serialized anyway).
    return (
        await db.execute(
            select(Purchase)
            .where(Purchase.platform == platform, Purchase.store_key == store_key)
            .with_for_update()
        )
    ).scalar_one_or_none()


async def upsert_purchase(
    db: AsyncSession,
    verified: VerifiedPurchase,
    game_slug: str,
    *,
    observed_at: datetime | None = None,
    store_event: bool = False,
) -> tuple[Purchase, str | None]:
    """Insert or refresh the ``purchases`` row; return it and its previous state.

    ``store_event`` marks the answer as a store-pushed event (a verified
    notification) rather than a client post: then a same-state answer newer
    than ``state_changed_at`` also advances it (see "Event ordering" in
    docs/IAP.md §8.4).

    The previous state is None for a new row. The row is locked for the rest
    of the transaction. Does not commit.

    The answer's event time is ``verified.event_at``, else ``observed_at``
    (when the caller started verifying), else now. The stored state is left
    as it is — and an audit event says why — when the answer is older than
    the purchase's ``state_changed_at`` (``stale_ignored``) or would move an
    ``owned`` purchase back to ``pending`` (``regression_refused``).
    """
    now = _now()
    event_at = _utc(verified.event_at or observed_at or now)
    purchase = await _lock_purchase(db, verified.platform, verified.store_key)
    if purchase is None:
        purchase = Purchase(
            platform=verified.platform,
            store_key=verified.store_key,
            product_id=verified.product_id,
            game_slug=game_slug,
            state=verified.state,
            environment=verified.environment,
            ownership_type=verified.ownership_type,
            verified_at=now,
            state_changed_at=event_at,
        )
        _apply_verified(purchase, verified, now, event_at)
        db.add(purchase)
        try:
            await db.flush()
        except IntegrityError:
            # A concurrent request inserted the same (platform, store_key).
            # The insert is this transaction's first write, so a rollback
            # loses nothing; re-read the winner's row and refresh it.
            await db.rollback()
            purchase = await _lock_purchase(db, verified.platform, verified.store_key)
            if purchase is None:  # pragma: no cover — the winner's row just committed
                raise
        else:
            _event(db, purchase, "recorded", state=purchase.state, env=purchase.environment)
            return purchase, None
    if purchase.product_id != verified.product_id:
        # One store key never changes product; a mismatch means bad evidence.
        raise PurchaseError(422, "verification_failed")
    previous = purchase.state
    if previous != verified.state and _is_stale(purchase, event_at):
        # An answer read before a newer store event (a webhook's revoke, a
        # refund reversal) was applied must not undo it.
        _event(db, purchase, "stale_ignored", state=verified.state, current=previous)
    elif previous == "owned" and verified.state == "pending":
        # A completed purchase never goes back to pending; a store answering
        # so is inconsistent. Keep the grant and flag it.
        _audit_log.warning(
            json.dumps({"event": "purchase_regression_refused", "purchase_id": str(purchase.id)})
        )
        _event(db, purchase, "regression_refused", state=verified.state, current=previous)
    else:
        _apply_verified(purchase, verified, now, event_at, store_event=store_event)
    await db.flush()
    return purchase, previous


# ---------------------------------------------------------------------------
# Linking
# ---------------------------------------------------------------------------


async def _link_counts(
    db: AsyncSession, purchase: Purchase, session_id: str, now: datetime
) -> tuple[int, int, bool]:
    """(sessions ever linked, sessions newly linked in the window, is this session one of them).

    Counted from the retained ``linked`` audit events, by distinct session
    hash, as well as from live ``purchase_links`` rows. ``DELETE /me`` deletes
    links but keeps ``purchase_events``, so erasing and restoring on a fresh
    install cannot reset either cap (IAP.md §4, §8.5).
    """
    linked = (
        await db.execute(
            select(PurchaseEvent.session_hash, PurchaseEvent.created_at).where(
                PurchaseEvent.purchase_id == purchase.id,
                PurchaseEvent.kind == "linked",
                PurchaseEvent.session_hash.is_not(None),
            )
        )
    ).all()
    since = now - NEW_LINK_WINDOW
    ever = {h for h, _ in linked}
    fresh = {h for h, at in linked if _utc(at) >= since}
    live_total = (
        await db.execute(
            select(func.count())
            .select_from(PurchaseLink)
            .where(PurchaseLink.purchase_id == purchase.id)
        )
    ).scalar_one()
    live_recent = (
        await db.execute(
            select(func.count())
            .select_from(PurchaseLink)
            .where(PurchaseLink.purchase_id == purchase.id, PurchaseLink.created_at >= since)
        )
    ).scalar_one()
    returning = session_hash(session_id) in ever
    return max(len(ever), live_total), max(len(fresh), live_recent), returning


async def _link_session(
    db: AsyncSession,
    purchase: Purchase,
    *,
    session_id: str,
    source: Source,
    verified: VerifiedPurchase,
) -> None:
    """Link ``session_id`` to an owned purchase, or raise 403/409 after auditing why."""
    now = _now()
    link = (
        await db.execute(
            select(PurchaseLink).where(
                PurchaseLink.purchase_id == purchase.id,
                PurchaseLink.session_id == session_id,
            )
        )
    ).scalar_one_or_none()
    if link is not None:
        # Re-presenting from an already-linked session is never a new link.
        link.last_verified_at = now
        await db.flush()
        return

    refusal: str | None = None
    reason: str | None = None
    if source == "purchase" and not account_token_matches(
        purchase.platform, session_id, verified.account_token
    ):
        refusal = "ownership_mismatch"
    else:
        total, recent, returning = await _link_counts(db, purchase, session_id, now)
        # A returning install (linked before, unlinked by Delete My Data) adds
        # no new session to either cap.
        if returning:
            refusal = None
        elif total >= MAX_SESSIONS_PER_PURCHASE:
            refusal = "link_limit"
            reason = "session_cap"
        elif recent >= MAX_NEW_LINKS_PER_PURCHASE_PER_30D:
            refusal = "link_limit"
            reason = "new_links_30d"

    if refusal == "ownership_mismatch":
        _event(db, purchase, "link_rejected", session_id=session_id, source=source, reason=refusal)
        await db.commit()
        raise PurchaseError(403, refusal)
    if refusal == "link_limit":
        _event(db, purchase, "link_rejected", session_id=session_id, source=source, reason=reason)
        await db.commit()
        raise PurchaseError(409, refusal)

    db.add(
        PurchaseLink(
            purchase_id=purchase.id,
            session_id=session_id,
            source=source,
            last_verified_at=now,
            created_at=now,
        )
    )
    _event(db, purchase, "linked", session_id=session_id, source=source)
    await db.flush()


async def process_verified_purchase(
    db: AsyncSession,
    *,
    session_id: str,
    source: Source,
    verified: VerifiedPurchase,
    observed_at: datetime | None = None,
) -> PurchaseResult:
    """The whole of ``POST /purchases/{apple,google}`` after verification (IAP.md §8.2).

    Idempotent: a pure function of (verified store state, calling session).
    Commits. Raises :class:`PurchaseError` for 403/409/422 — a 403/409 still
    commits the purchase row and the refusal event first. ``observed_at`` is
    when the request started verifying (the answer's event time when the
    verifier gives none; see :func:`upsert_purchase`).

    An environment outside :func:`~purchases.verifiers.allowed_environments`
    is ``422 environment_not_allowed`` before anything is written, whatever
    the verifier returned.
    """
    if verified.environment not in allowed_environments(verified.platform):
        raise PurchaseError(422, "environment_not_allowed")
    game_slug = await _premium_slug_for(db, verified.product_id)
    purchase, previous = await upsert_purchase(db, verified, game_slug, observed_at=observed_at)
    if previous is not None and previous != purchase.state:
        _event(db, purchase, "state_changed", previous=previous, state=purchase.state)
        await _recompute_all_links(db, purchase)

    if purchase.state == "owned":
        await _link_session(db, purchase, session_id=session_id, source=source, verified=verified)
        await recompute_entitlement(db, session_id, game_slug)
        status: Literal["owned", "pending", "revoked"] = "owned"
    elif purchase.state == "revoked":
        await _recompute_all_links(db, purchase)
        status = "revoked"
    elif purchase.state == "pending":
        status = "pending"
    else:  # cancelled: nothing to grant, nothing to finish
        await db.commit()
        raise PurchaseError(422, "verification_failed")

    await db.commit()
    return PurchaseResult(
        status=status,
        game_slug=game_slug,
        product_id=purchase.product_id,
        purchase_id=purchase.id,
        needs_acknowledgement=(
            purchase.platform == "google"
            and purchase.state == "owned"
            and purchase.acknowledged_at is None
        ),
    )


async def mark_acknowledged(db: AsyncSession, purchase_id: uuid.UUID) -> None:
    purchase = await db.get(Purchase, purchase_id)
    if purchase is not None and purchase.acknowledged_at is None:
        purchase.acknowledged_at = _now()
        await db.commit()


# ---------------------------------------------------------------------------
# Store-driven state changes (webhooks / crons — #2786, #2787)
# ---------------------------------------------------------------------------


async def _dedupe_seen(db: AsyncSession, dedupe_key: str) -> bool:
    return (
        await db.execute(select(PurchaseEvent.id).where(PurchaseEvent.dedupe_key == dedupe_key))
    ).first() is not None


async def apply_store_state(
    db: AsyncSession,
    *,
    platform: str,
    store_key: str,
    state: Literal["owned", "revoked", "cancelled"],
    reason: str | None = None,
    dedupe_key: str | None = None,
    event_at: datetime | None = None,
    environment: str | None = None,
) -> bool:
    """Set a known purchase's state from a verified store notification, and recompute.

    ``environment`` (the notification's verified environment, e.g. ``sandbox``)
    must match the purchase's when given: store keys from different store
    environments never act on each other. A mismatch is audited
    (``environment_mismatch``) and changes nothing.

    For Apple ``REFUND`` / ``REVOKE`` (→ revoked), ``REFUND_REVERSED`` (→ owned),
    Google voided purchases (→ revoked) and ``ONE_TIME_PRODUCT_CANCELED``
    (→ cancelled). Links are kept, so a reversal restores access to every
    still-linked session at once.

    ``event_at`` is the store's time for the event — Apple ``signedDate``, Google
    ``eventTimeMillis`` / ``voidedTimeMillis`` — and defaults to now. A
    transition older than the purchase's ``state_changed_at`` is ignored (and
    audited as ``stale_ignored``), so notifications delivered out of order
    cannot undo a newer state. A notification for the state the purchase is
    already in still advances ``state_changed_at`` to ``event_at`` when newer
    (never backwards), so it orders later events too.

    ``dedupe_key`` (the notification id) makes a redelivery a no-op. It is
    checked again after the purchase row lock, and a unique-key race on commit
    (two deliveries of one notification in parallel) rolls back to the same
    no-op. Returns False when nothing changed (duplicate, unknown purchase,
    stale, or already in that state). Commits.
    """
    if dedupe_key is not None and await _dedupe_seen(db, dedupe_key):
        return False
    purchase = await _lock_purchase(db, platform, store_key)
    if purchase is None:
        return False
    # A parallel delivery may have committed while this one waited for the lock.
    if dedupe_key is not None and await _dedupe_seen(db, dedupe_key):
        await db.rollback()
        return False
    if environment is not None and purchase.environment != environment:
        _event(
            db,
            purchase,
            "environment_mismatch",
            dedupe_key=dedupe_key,
            env=environment,
            current=purchase.environment,
        )
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
        return False
    now = _now()
    at = _utc(event_at or now)
    previous = purchase.state
    changed = False
    try:
        if previous == state:
            # Same state, but a store event: it still advances the ordering
            # watermark (never backwards), so an older opposite notification
            # delivered afterwards is stale (REFUND_REVERSED at T2 on an
            # owned purchase, then REFUND at T1 < T2, must not revoke).
            if _advance_watermark(purchase, at):
                purchase.verified_at = now
            _event(db, purchase, "notification", dedupe_key=dedupe_key, state=state)
        elif _is_stale(purchase, at):
            _event(
                db,
                purchase,
                "stale_ignored",
                dedupe_key=dedupe_key,
                state=state,
                current=previous,
                reason=reason,
            )
        else:
            purchase.state_changed_at = at
            _set_state(purchase, state, at, now, reason)
            _event(
                db,
                purchase,
                "state_changed",
                dedupe_key=dedupe_key,
                previous=previous,
                state=state,
                reason=reason,
            )
            await db.flush()
            await _recompute_all_links(db, purchase)
            changed = True
        await db.commit()
    except IntegrityError:
        # The dedupe_key was committed by a parallel delivery after both checks.
        await db.rollback()
        return False
    return changed


async def purchase_exists(db: AsyncSession, platform: str, store_key: str) -> bool:
    return (
        await db.execute(
            select(Purchase.id).where(
                Purchase.platform == platform, Purchase.store_key == store_key
            )
        )
    ).first() is not None


async def record_store_purchase(
    db: AsyncSession,
    verified: VerifiedPurchase,
    *,
    dedupe_key: str | None = None,
    event_at: datetime | None = None,
) -> bool:
    """Record a purchase the store told us about before any client posted it.

    For a verified notification (Apple ``ONE_TIME_CHARGE``, or a ``REFUND`` /
    ``REVOKE`` for a purchase no session has presented yet). Upserts the
    ``purchases`` row from the verified transaction — **no session is linked**,
    so nothing is granted; a later client post links it (subject to §4) and a
    later post of an older JWS cannot undo a newer revoke (event ordering).
    If the row already exists the usual upsert rules apply and linked sessions
    are recomputed on a state change.

    ``dedupe_key`` makes a redelivery a no-op. Returns False for a duplicate,
    an environment outside the allow-list or a product that is not a premium
    game (nothing written). Commits.
    """
    if dedupe_key is not None and await _dedupe_seen(db, dedupe_key):
        return False
    if verified.environment not in allowed_environments(verified.platform):
        return False
    try:
        game_slug = await _premium_slug_for(db, verified.product_id)
    except PurchaseError:
        return False
    if event_at is not None:
        verified = replace(verified, event_at=event_at)
    try:
        purchase, previous = await upsert_purchase(db, verified, game_slug, store_event=True)
        if dedupe_key is not None and await _dedupe_seen(db, dedupe_key):
            await db.rollback()
            return False
        if previous is not None and previous != purchase.state:
            _event(db, purchase, "state_changed", previous=previous, state=purchase.state)
            await _recompute_all_links(db, purchase)
        _event(db, purchase, "notification", dedupe_key=dedupe_key, state=purchase.state)
        await db.commit()
    except PurchaseError:
        # Same store key, different product: bad evidence, nothing written.
        await db.rollback()
        return False
    except IntegrityError:
        await db.rollback()
        return False
    return True


async def delete_purchase(db: AsyncSession, purchase_id: uuid.UUID) -> bool:
    """Delete a purchase (support or sandbox clean-up) and recompute its sessions.

    Its links cascade away; derived ``game_entitlements`` rows keep existing
    with ``purchase_id`` set NULL by the foreign key and are then re-pointed at
    another qualifying purchase or removed. Delete purchases through this
    function: a raw SQL delete leaves those rows until the session's next
    recompute. Returns False for an unknown id. Commits.
    """
    purchase = (
        await db.execute(select(Purchase).where(Purchase.id == purchase_id).with_for_update())
    ).scalar_one_or_none()
    if purchase is None:
        return False
    game_slug = purchase.game_slug
    sessions = (
        (
            await db.execute(
                select(PurchaseLink.session_id).where(PurchaseLink.purchase_id == purchase_id)
            )
        )
        .scalars()
        .all()
    )
    _event(db, None, "deleted", purchase_ref=str(purchase_id), game_slug=game_slug)
    await db.execute(
        delete(PurchaseLink)
        .where(PurchaseLink.purchase_id == purchase_id)
        .execution_options(synchronize_session=False)
    )
    await db.delete(purchase)
    await db.flush()
    await _recompute_sessions(db, sessions, game_slug)
    await db.commit()
    return True


async def slug_has_purchases(db: AsyncSession, game_slug: str) -> bool:
    return (
        await db.execute(select(Purchase.id).where(Purchase.game_slug == game_slug).limit(1))
    ).first() is not None

"""Pluggable store-verification interface for ``POST /purchases/*`` (#840).

The purchase service never talks to Apple or Google itself. It is handed a
:class:`VerifiedPurchase` — the store's authoritative, normalized answer — by
an :class:`AppleVerifier` or :class:`GoogleVerifier`. That keeps the ownership,
link-cap and entitlement logic (this story) independent of the store clients:

* **#2786** (shipped) implements ``AppleVerifier`` as
  ``purchases.apple_store.AppStoreVerifier`` with ``app-store-server-library``
  (``SignedDataVerifier`` per allowed environment, then App Store Server API
  *Get Transaction Info* when configured; docs/IAP.md §6.2).
* **#2787** implements ``GoogleVerifier`` with the Play Developer API
  (``purchases.products.get`` / ``acknowledge``; docs/IAP.md §7.2-7.3).

While a store is not configured (Apple: no ``APPLE_BUNDLE_ID``; Google: until
#2787) the providers in ``purchases/apple.py`` / ``purchases/google.py``
return the ``NotConfigured*`` verifiers below, and every purchase call answers
``503 store_unavailable``: nothing is granted from unverified evidence.

A verifier **must** raise :class:`PurchaseError` with one of the documented
codes (IAP.md §8.2) instead of returning a partial result:

* ``422 verification_failed`` — bad signature, wrong state, not found;
* ``422 wrong_app`` — bundle id / package name mismatch;
* ``422 unknown_product`` — product not in the catalog or wrong store type;
* ``422 environment_not_allowed`` — environment not in the allowed set;
* ``503 store_unavailable`` — store API down, timed out, or not configured.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol, runtime_checkable

Platform = Literal["apple", "google"]
PurchaseState = Literal["pending", "owned", "revoked", "cancelled"]
Environment = Literal["production", "sandbox", "test"]
OwnershipType = Literal["purchased", "family_shared"]


class PurchaseError(Exception):
    """A purchase request failure, mapped to ``HTTPException(status, detail)``."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class AppleEvidence:
    """What the client posts for Apple: the StoreKit 2 ``jwsRepresentation``."""

    signed_transaction: str


@dataclass(frozen=True)
class GoogleEvidence:
    """What the client posts for Google Play."""

    product_id: str
    purchase_token: str


@dataclass(frozen=True)
class VerifiedPurchase:
    """The store's verified answer, normalized across platforms.

    Field sources:

    ========================  =============================  ==================================
    field                     Apple                          Google
    ========================  =============================  ==================================
    ``store_key``             ``originalTransactionId``      ``purchaseToken``
    ``transaction_id``        latest ``transactionId``       ``orderId``
    ``environment``           Production→production,         ``purchaseType == 0`` → test,
                              Sandbox→sandbox                otherwise production
    ``ownership_type``        ``inAppOwnershipType``         always ``purchased``
    ``state``                 owned / revoked                ``purchaseState`` 0→owned,
                              (``revocationDate`` set)       2→pending; voided→revoked
    ``account_token``         ``appAccountToken``            ``obfuscatedExternalAccountId``
    ``acknowledged``          n/a (False)                    ``acknowledgementState == 1``
    ========================  =============================  ==================================
    """

    platform: Platform
    product_id: str
    store_key: str
    transaction_id: str | None
    environment: Environment
    ownership_type: OwnershipType
    state: PurchaseState
    purchased_at: datetime | None
    account_token: str | None
    revoked_at: datetime | None = None
    revocation_reason: str | None = None
    acknowledged: bool = False
    # When the store says this state held: Apple ``signedDate`` of the
    # transaction/notification, Google ``eventTimeMillis`` (RTDN) or the time
    # the Play API was read. None → the service uses the time the request
    # started verifying. A transition older than the purchase's
    # ``state_changed_at`` is ignored (IAP.md §8.4, out-of-order store state).
    event_at: datetime | None = None


# Environments accepted by default when the env vars are unset — the production
# settings of IAP.md §6.4 and §7.2 (§17 Q5 accepts Sandbox / license testers).
_DEFAULT_ENVIRONMENTS: dict[str, str] = {
    "apple": "Production,Sandbox",
    "google": "production,test",
}
_ENVIRONMENT_VARS: dict[str, str] = {
    "apple": "APPLE_IAP_ENVIRONMENTS",
    "google": "GOOGLE_PLAY_ENVIRONMENTS",
}


def allowed_environments(platform: str) -> frozenset[str]:
    """The normalized environments this deployment accepts for ``platform``.

    Read from ``APPLE_IAP_ENVIRONMENTS`` / ``GOOGLE_PLAY_ENVIRONMENTS``
    (comma-separated, case-insensitive: ``Production,Sandbox`` /
    ``production,test``) on every call. The verifiers of #2786 / #2787 must
    apply the same list before any store call; the purchase service checks
    it again on the verified answer (defence in depth).
    """
    var = _ENVIRONMENT_VARS.get(platform)
    if var is None:
        return frozenset()
    raw = os.environ.get(var) or _DEFAULT_ENVIRONMENTS[platform]
    return frozenset(e.strip().lower() for e in raw.split(",") if e.strip())


@runtime_checkable
class AppleVerifier(Protocol):
    async def verify(self, evidence: AppleEvidence) -> VerifiedPurchase:
        """Verify the JWS (signature chain, bundle id, product, environment) and fetch the
        authoritative state. Raise :class:`PurchaseError` on any failure."""
        ...


@runtime_checkable
class GoogleVerifier(Protocol):
    async def verify(self, evidence: GoogleEvidence) -> VerifiedPurchase:
        """Look the purchase up with the Play Developer API (package, product, state,
        never consumed). Raise :class:`PurchaseError` on any failure."""
        ...

    async def acknowledge(self, evidence: GoogleEvidence) -> None:
        """Acknowledge the purchase (``purchases.products.acknowledge``). Called only after
        the purchase row is persisted as ``owned``. Must be safe to repeat."""
        ...


class NotConfiguredAppleVerifier:
    """Used while Apple verification is not configured: every call is ``503``."""

    async def verify(self, evidence: AppleEvidence) -> VerifiedPurchase:
        raise PurchaseError(503, "store_unavailable")


class NotConfiguredGoogleVerifier:
    """Default until #2787 ships real verification: every call is ``503``."""

    async def verify(self, evidence: GoogleEvidence) -> VerifiedPurchase:
        raise PurchaseError(503, "store_unavailable")

    async def acknowledge(self, evidence: GoogleEvidence) -> None:
        raise PurchaseError(503, "store_unavailable")

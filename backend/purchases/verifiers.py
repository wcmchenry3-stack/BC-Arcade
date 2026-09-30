"""Pluggable store-verification interface for ``POST /purchases/*`` (#840).

The purchase service never talks to Apple or Google itself. It is handed a
:class:`VerifiedPurchase` — the store's authoritative, normalized answer — by
an :class:`AppleVerifier` or :class:`GoogleVerifier`. That keeps the ownership,
link-cap and entitlement logic (this story) independent of the store clients:

* **#2786** implements ``AppleVerifier`` with ``app-store-server-library``
  (``SignedDataVerifier`` per allowed environment, then App Store Server API
  *Get Transaction Info*; docs/IAP.md §6.2).
* **#2787** implements ``GoogleVerifier`` with the Play Developer API
  (``purchases.products.get`` / ``acknowledge``; docs/IAP.md §7.2-7.3).

Until then the providers in ``purchases/apple.py`` / ``purchases/google.py``
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
    """Default until #2786 ships real verification: every call is ``503``."""

    async def verify(self, evidence: AppleEvidence) -> VerifiedPurchase:
        raise PurchaseError(503, "store_unavailable")


class NotConfiguredGoogleVerifier:
    """Default until #2787 ships real verification: every call is ``503``."""

    async def verify(self, evidence: GoogleEvidence) -> VerifiedPurchase:
        raise PurchaseError(503, "store_unavailable")

    async def acknowledge(self, evidence: GoogleEvidence) -> None:
        raise PurchaseError(503, "store_unavailable")

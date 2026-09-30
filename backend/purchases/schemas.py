"""Request/response bodies for ``POST /purchases/{apple,google}`` (docs/IAP.md §8.2)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from entitlements.schemas import EntitlementsResponse

# A StoreKit 2 JWS with its x5c chain is ~4-6 KB; leave headroom.
MAX_SIGNED_TRANSACTION_CHARS = 16_000
MAX_PURCHASE_TOKEN_CHARS = 1_024
MAX_PRODUCT_ID_CHARS = 128
# An ASSN v2 signedPayload embeds a signedTransactionInfo JWS, each with its
# own x5c chain: ~10-12 KB. Must stay under main.PURCHASE_BODY_BYTES (32 KB).
MAX_SIGNED_PAYLOAD_CHARS = 30_000

PurchaseSource = Literal["purchase", "restore", "sync"]


class ApplePurchaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signed_transaction: str = Field(min_length=1, max_length=MAX_SIGNED_TRANSACTION_CHARS)
    source: PurchaseSource


class GooglePurchaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: str = Field(min_length=1, max_length=MAX_PRODUCT_ID_CHARS)
    purchase_token: str = Field(min_length=1, max_length=MAX_PURCHASE_TOKEN_CHARS)
    source: PurchaseSource


class AppleNotificationRequest(BaseModel):
    """App Store Server Notifications V2 body. Unknown keys are ignored (Apple may add some)."""

    model_config = ConfigDict(extra="ignore")

    signedPayload: str = Field(min_length=1, max_length=MAX_SIGNED_PAYLOAD_CHARS)


class PurchaseResponse(BaseModel):
    status: Literal["owned", "pending", "revoked"]
    game_slug: str
    product_id: str
    # True when the client should finish / acknowledge the transaction.
    finish: bool
    # Same payload as GET /entitlements, issued after the write.
    entitlements: EntitlementsResponse

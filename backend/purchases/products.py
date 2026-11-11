"""Product ID ↔ game slug mapping for the premium store catalog (docs/IAP.md §2).

Pure helpers with no database or store access, shared by the purchase routes,
the Apple/Google verifiers, store notifications and ``purchases.service``.
"""

from __future__ import annotations

from entitlements.service import DISABLED_GAMES

# Same prefix as frontend/src/entitlements/premiumProducts.json (IAP.md §2).
# The backend never reads the JSON; test_premium_products.py keeps them in step.
PRODUCT_ID_PREFIX = "com.buffingchi.games.premium."


def slug_for_product(product_id: str) -> str | None:
    """The game slug a product ID names, or None if it does not follow the convention."""
    if not product_id.startswith(PRODUCT_ID_PREFIX):
        return None
    slug = product_id[len(PRODUCT_ID_PREFIX) :]
    return slug or None


def purchasable_slug_for_product(product_id: str) -> str | None:
    """Like :func:`slug_for_product`, but None for a disabled game's product too.

    A game in ``DISABLED_GAMES`` (#3001: Cascade until its rework) stays premium
    but is not sold, so a receipt for its product is refused like an unknown
    product (``422 unknown_product``) and grants nothing. Notifications still use
    :func:`slug_for_product`, so a refund or revocation of an existing purchase
    row keeps applying."""
    slug = slug_for_product(product_id)
    return None if slug is None or slug in DISABLED_GAMES else slug

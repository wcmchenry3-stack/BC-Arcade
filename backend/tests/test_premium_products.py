"""Premium store catalog drift guard (#2785, docs/IAP.md §2).

``frontend/src/entitlements/premiumProducts.json`` maps each premium game to
its store product ID. The backend purchase routes (#840) must only grant games
that are ``is_premium`` in ``game_types``, and every premium game must be
purchasable, so the JSON and the migrated catalog have to agree exactly.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

import pytest
from sqlalchemy import select

from db.base import get_session_factory
from db.models import GameType
from entitlements.service import ALL_PREMIUM_SLUGS

_CATALOG_FILE = (
    Path(__file__).parents[2] / "frontend" / "src" / "entitlements" / "premiumProducts.json"
)
_PREFIX = "com.buffingchi.games.premium."
# Valid on both stores: Play requires a lowercase letter/digit first and only
# [a-z0-9_.]; App Store Connect allows [A-Za-z0-9_.]. 40 is a conservative cap.
_PRODUCT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_.]{0,39}$")


def _catalog() -> dict:
    return json.loads(_CATALOG_FILE.read_text())


def test_product_ids_follow_convention() -> None:
    data = _catalog()
    assert data["productIdPrefix"] == _PREFIX
    for entry in data["products"]:
        assert entry["productId"] == _PREFIX + entry["gameSlug"]
        assert _PRODUCT_ID_RE.match(entry["productId"]), entry["productId"]


def test_product_ids_and_games_unique() -> None:
    products = _catalog()["products"]
    assert len({p["gameSlug"] for p in products}) == len(products)
    assert len({p["productId"] for p in products}) == len(products)


@pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set")
async def test_catalog_matches_game_types_is_premium() -> None:
    # Read game_types directly: /games/catalog filters on is_active, so an
    # inactive premium game would slip past a catalog-endpoint comparison.
    factory = get_session_factory()
    async with factory() as db:
        premium = set(
            (await db.execute(select(GameType.name).where(GameType.is_premium.is_(True)))).scalars()
        )
    assert {p["gameSlug"] for p in _catalog()["products"]} == premium


def test_catalog_matches_backend_premium_slugs() -> None:
    assert {p["gameSlug"] for p in _catalog()["products"]} == set(ALL_PREMIUM_SLUGS)

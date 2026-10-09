"""Game catalog reads and admin tier edits (#1049)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import GameType
from entitlements.service import ALL_PREMIUM_SLUGS
from games import catalog_cache
from games.sessions import GameServiceError
from purchases.service import slug_has_purchases


async def get_catalog(session: AsyncSession) -> list[GameType]:
    return list(
        (
            await session.execute(
                select(GameType).where(GameType.is_active.is_(True)).order_by(GameType.sort_order)
            )
        )
        .scalars()
        .all()
    )


async def patch_game_type(
    session: AsyncSession,
    *,
    game_type_id: int,
    is_premium: bool | None,
    category: str | None,
) -> GameType:
    gt = (
        await session.execute(select(GameType).where(GameType.id == game_type_id))
    ).scalar_one_or_none()
    if gt is None:
        raise GameServiceError(404, "Game type not found.")
    # docs/IAP.md §13: flipping a purchasable game to free would give it away;
    # flipping it back without the store product leaves it unbuyable. A game in
    # the product catalog, or with any recorded purchase, changes tier only by
    # a migration shipped with the catalog JSON (#840).
    if (
        is_premium is not None
        and is_premium != gt.is_premium
        and (gt.name in ALL_PREMIUM_SLUGS or await slug_has_purchases(session, gt.name))
    ):
        raise GameServiceError(409, "is_premium_migration_only")
    if is_premium is not None:
        gt.is_premium = is_premium
    if category is not None:
        gt.category = category
    await session.commit()
    # This worker reads the new tier at once; other workers within the cache TTL.
    catalog_cache.invalidate()
    await session.refresh(gt)
    return gt

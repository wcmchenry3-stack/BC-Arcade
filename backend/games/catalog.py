"""Game catalog reads (#1049)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import GameType


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

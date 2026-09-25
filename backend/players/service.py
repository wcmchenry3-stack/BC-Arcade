"""Read and write a player's display name (#2624, #2519 decision 17).

One ``players`` row per player id (the app's ``X-Session-ID``). Writes are
idempotent: setting the name a player already has writes nothing, and a
concurrent first write can't fail on the primary key (``INSERT ... ON
CONFLICT DO UPDATE``). The callers validate the name first (``DisplayName``).
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Player


async def get_display_name(db: AsyncSession, session_id: str) -> str | None:
    return (
        await db.execute(select(Player.display_name).where(Player.session_id == session_id))
    ).scalar_one_or_none()


async def set_display_name(db: AsyncSession, session_id: str, name: str) -> bool:
    """Make ``name`` the player's display name. Does not commit.

    Returns False, having written nothing, when it already is. The upsert's
    ``WHERE`` keeps a concurrent identical write from touching ``updated_at``.
    """
    if await get_display_name(db, session_id) == name:
        return False
    now = datetime.now(timezone.utc)
    dialect = db.bind.dialect.name if db.bind else "postgresql"
    if dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert as _insert
    else:
        from sqlalchemy.dialects.postgresql import insert as _insert
    stmt = (
        _insert(Player)
        .values(session_id=session_id, display_name=name, created_at=now, updated_at=now)
        .on_conflict_do_update(
            index_elements=[Player.session_id],
            set_={"display_name": name, "updated_at": now},
            where=Player.display_name != name,
        )
    )
    await db.execute(stmt)
    return True


async def clear_display_name(db: AsyncSession, session_id: str) -> None:
    """Remove the player's display name, if any. Does not commit."""
    await db.execute(delete(Player).where(Player.session_id == session_id))

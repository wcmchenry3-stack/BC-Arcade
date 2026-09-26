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

from db.dialect import dialect_insert
from db.models import Player
from players.schemas import clean_display_name


async def get_display_name(db: AsyncSession, session_id: str) -> str | None:
    return (
        await db.execute(select(Player.display_name).where(Player.session_id == session_id))
    ).scalar_one_or_none()


async def set_display_name(db: AsyncSession, session_id: str, name: str) -> bool:
    """Make ``name`` the player's display name. Does not commit.

    Returns False, having written nothing, when it already is. The upsert's
    ``WHERE`` keeps a concurrent identical write from touching ``updated_at``;
    the same clause makes the statement's affected-row count tell a real
    change from a no-op, so this needs no read before the write.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        dialect_insert(db, Player)
        .values(session_id=session_id, display_name=name, created_at=now, updated_at=now)
        .on_conflict_do_update(
            index_elements=[Player.session_id],
            set_={"display_name": name, "updated_at": now},
            where=Player.display_name != name,
        )
    )
    result = await db.execute(stmt)
    return result.rowcount > 0


async def clear_display_name(db: AsyncSession, session_id: str) -> None:
    """Remove the player's display name, if any. Does not commit."""
    await db.execute(delete(Player).where(Player.session_id == session_id))


async def remember_legacy_name(db: AsyncSession, session_id: str | None, raw: object) -> None:
    """Make a name an older build sent in ``POST /games`` metadata the
    player's display name (#2624 review). Does not commit.

    Builds from before #2624 never call ``PUT /players/me``; some send a
    ``player_name`` in the creation metadata instead. Without this, a player
    who never updates would never appear on the generic boards. (The name
    routes that also fed it, ``PATCH /games/{id}/name`` and the per-game ones,
    were removed in #2644.) Silently skipped without a valid player id or name.
    """
    if not session_id:
        return
    name = clean_display_name(raw, truncate=True)
    if name is None:
        return
    await set_display_name(db, session_id, name)

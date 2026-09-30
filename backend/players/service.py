"""A player's leaderboard participation and generated name (#2624, #2778).

One ``players`` row per player id (the app's ``X-Session-ID``): a row means
the player chose to join the public leaderboards, and holds the name the
server generated for them (``players.generated``). No row: not on any board.
Players never supply the text; see docs/LEADERBOARD-IDENTITIES.md.

Joining is idempotent (``INSERT ... ON CONFLICT DO NOTHING``): a player who is
already on the boards keeps their name, and a concurrent first join can't
fail on the primary key.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.dialect import dialect_insert
from db.models import Player
from players.generated import generate_display_name
from players.schemas import clean_display_name, is_default_legacy_name


async def get_display_name(db: AsyncSession, session_id: str) -> str | None:
    return (
        await db.execute(select(Player.display_name).where(Player.session_id == session_id))
    ).scalar_one_or_none()


async def join_leaderboards(db: AsyncSession, session_id: str) -> str:
    """Put the player on the leaderboards; returns their name. Does not commit.

    A player who has already joined keeps the name they have, so replays of
    the app's offline sync change nothing.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        dialect_insert(db, Player)
        .values(
            session_id=session_id,
            display_name=generate_display_name(),
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=[Player.session_id])
    )
    await db.execute(stmt)
    name = await get_display_name(db, session_id)
    if name is None:  # pragma: no cover - the row was just inserted or already there
        raise RuntimeError("player row missing after join")
    return name


async def reroll_display_name(db: AsyncSession, session_id: str) -> str | None:
    """Give a joined player a different generated name. Does not commit.

    Returns the new name, or None (writing nothing) when the player hasn't
    joined: a reroll never opts anyone in.
    """
    current = await get_display_name(db, session_id)
    if current is None:
        return None
    name = generate_display_name(exclude=current)
    await db.execute(
        update(Player)
        .where(Player.session_id == session_id)
        .values(display_name=name, updated_at=datetime.now(timezone.utc))
    )
    return name


async def clear_display_name(db: AsyncSession, session_id: str) -> None:
    """Take the player off every leaderboard (drops their name). Does not commit."""
    await db.execute(delete(Player).where(Player.session_id == session_id))


async def remember_legacy_opt_in(db: AsyncSession, session_id: str | None, raw: object) -> None:
    """A name an older build sent in ``POST /games`` metadata joins the player
    to the leaderboards under a generated name (#2624 review, #2778). Does not
    commit.

    Builds from before #2624 never call ``PUT /players/me``; some send a typed
    ``player_name`` in the creation metadata instead. Under the model those
    builds use, typing a name *was* the choice to appear on the boards, so the
    choice is kept, but the typed text never becomes public: the player gets
    (or keeps) a generated name. Silently skipped without a valid player id,
    without a non-blank name, or when the name is a default the build filled
    in (``You``, ``Player``, ...; ``schemas.LEGACY_DEFAULT_NAMES``), which was
    never a deliberate choice.
    """
    if not session_id:
        return
    name = clean_display_name(raw)
    if name is None or is_default_legacy_name(name):
        return
    await join_leaderboards(db, session_id)

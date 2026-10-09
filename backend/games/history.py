"""History reads for the games API: a player's game list and one game's detail (#365)."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.models import Game, GameEvent, GameType
from games.sessions import GameServiceError

_SPACE_OFFSET = re.compile(r" (\d{2}:\d{2})$")

# A decoded cursor: the last game of the previous page, as (started_at, id). ``id`` is None
# for the legacy timestamp-only form that app builds already in the field may still send.
Cursor = tuple[datetime, uuid.UUID | None]


def parse_cursor(raw: str) -> Cursor:
    """Parse a ``GET /games/me`` cursor: ``<iso-timestamp>~<game-uuid>`` or a bare timestamp.

    The timestamp may be ``Z``, an offset, or naive; a naive value is read as UTC, since
    asyncpg rejects naive datetimes for a timestamptz column (#3015). A trailing offset whose
    ``+`` a client left unencoded arrives as a space (``... 00:00``) and is repaired.
    Raises ``ValueError`` for anything unparseable, including offsets so extreme that the
    UTC conversion leaves datetime's range.
    """
    ts_part, sep, id_part = raw.partition("~")
    ts_part = _SPACE_OFFSET.sub(r"+\1", ts_part)
    try:
        game_id = uuid.UUID(id_part) if sep else None
        parsed = datetime.fromisoformat(ts_part)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC), game_id
        return parsed.astimezone(UTC), game_id
    except OverflowError as exc:  # e.g. 0001-01-01T00:00:00+23:59
        raise ValueError("cursor out of range") from exc


def format_cursor(started_at: datetime, game_id: uuid.UUID) -> str:
    """The opaque ``next_cursor``: ``<UTC iso with Z>~<game id>``, URL-safe (no ``+``)."""
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=UTC)
    stamp = started_at.astimezone(UTC).isoformat().replace("+00:00", "Z")
    return f"{stamp}~{game_id}"


@dataclass
class GameRow:
    id: uuid.UUID
    game_type: str
    started_at: datetime
    completed_at: datetime | None
    final_score: int | None
    outcome: str | None
    duration_ms: int | None
    metadata: dict[str, Any]
    players: list[dict[str, Any]]


@dataclass
class GamePage:
    items: list[GameRow]
    next_cursor: str | None


async def list_games_for_session(
    session: AsyncSession,
    *,
    session_id: str,
    limit: int,
    cursor: Cursor | None,
) -> GamePage:
    stmt = (
        select(Game, GameType.name)
        .join(GameType, Game.game_type_id == GameType.id)
        .where(Game.session_id == session_id)
        .order_by(Game.started_at.desc(), Game.id.desc())
        .limit(limit + 1)
    )
    if cursor is not None:
        ts, cursor_id = cursor
        # Strictly after the cursor game in (started_at DESC, id DESC) order; the id breaks
        # ties so games sharing a started_at are not skipped across a page boundary.
        after = Game.started_at < ts
        if cursor_id is not None:
            after = or_(after, and_(Game.started_at == ts, Game.id < cursor_id))
        stmt = stmt.where(after)

    rows = (await session.execute(stmt)).all()
    items = [
        GameRow(
            id=g.id,
            game_type=name,
            started_at=g.started_at,
            completed_at=g.completed_at,
            final_score=g.final_score,
            outcome=g.outcome,
            duration_ms=g.duration_ms,
            metadata=g.game_metadata,
            players=g.players or [],
        )
        for g, name in rows[:limit]
    ]
    # The cursor is the last game on this page; the next page starts strictly after it.
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1][0]
        next_cursor = format_cursor(last.started_at, last.id)
    return GamePage(items=items, next_cursor=next_cursor)


@dataclass
class GameDetail:
    row: GameRow
    events: list[dict[str, Any]] | None


async def get_game_detail(
    session: AsyncSession,
    *,
    game_id: uuid.UUID,
    session_id: str,
    include_events: bool,
) -> GameDetail:
    opts = [selectinload(Game.game_type)]
    if include_events:
        opts.append(selectinload(Game.events).selectinload(GameEvent.event_type))
    game = (
        await session.execute(select(Game).options(*opts).where(Game.id == game_id))
    ).scalar_one_or_none()
    if game is None:
        raise GameServiceError(404, "Game not found.")
    if game.session_id != session_id:
        raise GameServiceError(403, "Game belongs to a different session.")

    row = GameRow(
        id=game.id,
        game_type=game.game_type.name,
        started_at=game.started_at,
        completed_at=game.completed_at,
        final_score=game.final_score,
        outcome=game.outcome,
        duration_ms=game.duration_ms,
        metadata=game.game_metadata,
        players=game.players or [],
    )
    events: list[dict[str, Any]] | None = None
    if include_events:
        events = [
            {
                "event_index": e.event_index,
                "event_type": e.event_type.name,
                "occurred_at": e.occurred_at,
                "data": e.data,
            }
            for e in game.events
        ]
    return GameDetail(row=row, events=events)

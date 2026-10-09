"""History reads for the games API: a player's game list and one game's detail (#365)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.models import Game, GameEvent, GameType
from games.sessions import GameServiceError


def parse_cursor(raw: str) -> datetime:
    """Parse a ``GET /games/me`` cursor into an aware UTC datetime.

    Accepts ``Z``, ``+00:00`` (or any offset) and naive forms; a naive value is read as
    UTC, since asyncpg rejects naive datetimes for a timestamptz column (#3015). A ``+``
    that a client left unencoded arrives as a space, so a space is read as ``+``.
    Raises ``ValueError`` when the value is not a timestamp.
    """
    parsed = datetime.fromisoformat(raw.replace(" ", "+"))
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def format_cursor(started_at: datetime) -> str:
    """The opaque ``next_cursor`` for a game: UTC with a ``Z`` suffix (no ``+`` to mangle)."""
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=UTC)
    return started_at.astimezone(UTC).isoformat().replace("+00:00", "Z")


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
    cursor: datetime | None,
) -> GamePage:
    stmt = (
        select(Game, GameType.name)
        .join(GameType, Game.game_type_id == GameType.id)
        .where(Game.session_id == session_id)
        .order_by(Game.started_at.desc(), Game.id.desc())
        .limit(limit + 1)
    )
    if cursor is not None:
        stmt = stmt.where(Game.started_at < cursor)

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
    next_cursor = format_cursor(rows[limit][0].started_at) if len(rows) > limit else None
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

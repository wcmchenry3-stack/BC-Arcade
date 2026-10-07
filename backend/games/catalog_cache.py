"""Process-level cache of the static lookup tables (#2966).

``game_types`` and ``event_types`` change only through migrations and
``PATCH /games/catalog/{id}``, yet ``POST /games`` (entitlement check, game
type), ``POST /games/{id}/events`` (event-type map) and the leaderboard each
read them on every request. This module keeps one snapshot of both tables per
process. Purchase verification deliberately does not use it: the store has
already charged by then, so it reads ``is_premium`` from the DB. Snapshot:

- ``{name: GameTypeRow}`` for every game type (active or not: callers decide
  what an inactive type means for them, as they did against the table), and
- ``{game_type_id: {event_name: event_type_id}}`` for the non-deprecated
  event types.

Rows are frozen dataclasses — plain detached data, never ORM instances bound to
the session that loaded them — so a snapshot is safe to share across requests.

Freshness: a snapshot lives ``TTL_SECONDS`` (60 s). ``patch_game_type`` calls
:func:`invalidate` after its commit, so the worker that served the PATCH sees
the change on its next request; other uvicorn workers (and other instances)
keep their snapshot until it expires, so a PATCH takes up to 60 s to reach
every process. Migrations ship with a deploy, which restarts every process.

Concurrency: a refresh builds a new snapshot and swaps the module-level
reference in one assignment, so a reader sees either the old snapshot or the
new one, never a half-built one. Two requests that miss at the same time may
both load it (two extra SELECTs once a minute); that is cheaper than a lock. A
load that started before an :func:`invalidate` is not stored, so it cannot put
pre-PATCH data back for a full TTL.

No Redis or cross-process cache: out of scope for #2966.
"""

from __future__ import annotations

import time
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import EventType, GameType

TTL_SECONDS = 60.0


@dataclass(frozen=True, slots=True)
class GameTypeRow:
    """Detached copy of a ``game_types`` row (the columns any caller reads)."""

    id: int
    name: str
    display_name: str
    icon_emoji: str | None
    sort_order: int
    is_active: bool
    is_premium: bool
    category: str


@dataclass(frozen=True, slots=True)
class _Snapshot:
    game_types: Mapping[str, GameTypeRow]
    event_type_ids: Mapping[int, Mapping[str, int]]
    loaded_at: float


_EMPTY_EVENT_MAP: Mapping[str, int] = MappingProxyType({})

_snapshot: _Snapshot | None = None
# Bumped by invalidate(); a load only stores its result if no invalidation
# happened while it was running.
_generation = 0


def invalidate() -> None:
    """Drop this process's snapshot; the next lookup reloads it from the DB."""
    global _snapshot, _generation
    _generation += 1
    _snapshot = None


async def _load(db: AsyncSession) -> _Snapshot:
    # Plain columns, not ORM entities: nothing lands in the caller's identity map.
    rows = await db.execute(
        select(
            GameType.id,
            GameType.name,
            GameType.display_name,
            GameType.icon_emoji,
            GameType.sort_order,
            GameType.is_active,
            GameType.is_premium,
            GameType.category,
        )
    )
    game_types = {row.name: GameTypeRow(*row) for row in rows}
    events: dict[int, dict[str, int]] = {}
    event_rows = await db.execute(
        select(EventType.game_type_id, EventType.name, EventType.id).where(
            EventType.deprecated_at.is_(None)
        )
    )
    for game_type_id, name, event_type_id in event_rows:
        events.setdefault(game_type_id, {})[name] = event_type_id
    return _Snapshot(
        game_types=MappingProxyType(game_types),
        event_type_ids=MappingProxyType(
            {gid: MappingProxyType(names) for gid, names in events.items()}
        ),
        loaded_at=time.monotonic(),
    )


async def _current(db: AsyncSession) -> _Snapshot:
    global _snapshot
    snap = _snapshot
    if snap is not None and time.monotonic() - snap.loaded_at < TTL_SECONDS:
        return snap
    generation = _generation
    snap = await _load(db)
    if generation == _generation:
        _snapshot = snap
    return snap


async def get_game_type(db: AsyncSession, name: str) -> GameTypeRow | None:
    """The game type called *name*, active or not; None if there is none."""
    return (await _current(db)).game_types.get(name)


async def event_type_ids(db: AsyncSession, game_type_id: int) -> Mapping[str, int]:
    """``{event_name: event_type_id}`` for the game type's non-deprecated event types."""
    return (await _current(db)).event_type_ids.get(game_type_id, _EMPTY_EVENT_MAP)

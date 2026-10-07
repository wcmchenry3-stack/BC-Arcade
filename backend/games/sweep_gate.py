"""Run the stale-session sweep on ``/stats/me`` only when it can find something (#2966).

``sweep_stale_games`` (#2621) closes a session's games left open for over 24 h.
Running it on every ``/stats/me`` cost an UPDATE and a commit per call even
though it almost never matches a row. This gate remembers, per session and in
this process, the earliest time the sweep could next match anything, and skips
it until then.

When the gate runs the sweep it also reads the session's oldest still-open
``started_at`` (one indexed lookup on ``games_session_id_started_at_idx``). No
open game can turn stale before that start + 24 h, so until then the sweep would
be a no-op and is skipped. ``POST /games`` on this process lowers that time for
a game it creates (an offline queue can flush a game that is already a day
old), so games created through this process are swept exactly as before.

What can lag: a game created through *another* worker or instance after this
process last swept. That gap is capped by ``MAX_SKIP``: the sweep re-runs at
least once an hour per session regardless. Until it does, such a game is left
out of ``/stats/me`` like any in-progress game; once swept it counts in
``sessions`` / ``total_games`` (and so ``favorite_game``) as an abandoned
play. Nothing else moves: abandoned rows never earn XP, never count toward a
win streak, a best value, time played or the daily streak, and a swept row's
synthetic ``completed_at`` is not a ``last_played_at``. So the worst case is an
abandoned game counted up to an hour late; no figure is ever wrong in the
other direction.

A failed sweep records nothing, so the next read tries again. The table is a
bounded LRU (``MAX_SESSIONS``): a forgotten session simply sweeps on its next
read. ``/games/me`` still sweeps on every first page.
"""

from __future__ import annotations

import contextlib
import logging
from collections import OrderedDict
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Game
from games import service

logger = logging.getLogger(__name__)

MAX_SKIP = timedelta(hours=1)
MAX_SESSIONS = 10_000  # a few MB at most

# session id -> the earliest time the sweep could next close one of its games.
_next_due: OrderedDict[str, datetime] = OrderedDict()


def _utc(ts: datetime) -> datetime:
    """SQLite hands timestamps back naive; they are UTC."""
    return ts if ts.tzinfo is not None else ts.replace(tzinfo=UTC)


def clear() -> None:
    _next_due.clear()


def _remember(session_id: str, due: datetime) -> None:
    _next_due[session_id] = due
    _next_due.move_to_end(session_id)
    while len(_next_due) > MAX_SESSIONS:
        _next_due.popitem(last=False)


def note_open_game(session_id: str, started_at: datetime) -> None:
    """``POST /games`` returned a game (new, or an idempotent re-create): a backdated
    start may make the sweep due sooner. A completed game only makes it run early."""
    due = _next_due.get(session_id)
    if due is None:
        return  # not cached: the next read sweeps anyway
    stale_at = _utc(started_at) + service.STALE_GAME_AFTER
    if stale_at < due:
        _next_due[session_id] = stale_at


async def _oldest_open_start(db: AsyncSession, session_id: str) -> datetime | None:
    oldest = (
        await db.execute(
            select(func.min(Game.started_at)).where(
                Game.session_id == session_id, Game.completed_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    return _utc(oldest) if oldest is not None else None


async def sweep_if_due(db: AsyncSession, *, session_id: str, now: datetime | None = None) -> None:
    """``sweep_stale_games_safely`` unless the gate knows it would close nothing."""
    now = now or datetime.now(UTC)
    due = _next_due.get(session_id)
    if due is not None and now < due:
        _next_due.move_to_end(session_id)
        return
    if not await service.sweep_stale_games_safely(db, session_id=session_id):
        _next_due.pop(session_id, None)
        return
    try:
        oldest = await _oldest_open_start(db, session_id)
    except Exception as exc:  # noqa: BLE001 — like the sweep, never fail the read
        logger.error("stale-sweep gate lookup failed (%s)", type(exc).__name__)
        with contextlib.suppress(Exception):
            await db.rollback()
        _next_due.pop(session_id, None)
        return
    due = now + MAX_SKIP
    if oldest is not None:
        due = min(due, oldest + service.STALE_GAME_AFTER)
    _remember(session_id, due)

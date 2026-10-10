"""Stale-session sweep (#2621): closes games left open for over 24 h as abandoned.

Run on read, per player, from ``games.sweep_gate`` and ``GET /games/me``, so no
scheduler is needed. The sweep flag it writes (``metadata[SWEPT_KEY]``) lets a
real completion arriving later replace the swept row (``games.sessions``).
"""

from __future__ import annotations

import contextlib
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from db.jsonx import json_set_true, plus_hours
from db.models import Game
from games.filters import SWEPT_KEY
from settings import Settings
from vocab import GameOutcome

logger = logging.getLogger(__name__)

# A game still open this long after it started was left by killing the app.
# The sweep marks what it closes with metadata[SWEPT_KEY] = true (games.filters),
# which lets a real completion that arrives later replace it (complete_game).
# The age is ``STALE_GAME_AFTER_HOURS`` (settings.py), read lazily; the Python cut-off and
# the SQL ``completed_at`` below both derive from it, so they cannot drift (#2996).
_settings: Settings | None = None


def stale_game_hours() -> int:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings.stale_game_after_hours


def stale_game_after() -> timedelta:
    return timedelta(hours=stale_game_hours())


async def sweep_stale_games(
    session: AsyncSession, *, session_id: str, now: datetime | None = None
) -> int:
    """Close the session's games left open for over 24 h as abandoned (#2621).

    One UPDATE on ``games_session_id_started_at_idx``: sets ``outcome='abandoned'``,
    ``completed_at = started_at + 24 h`` and ``metadata.swept = true``, and leaves
    ``duration_ms`` NULL. Only open rows match, so it is idempotent and never
    touches a completed game. Returns the number of rows closed.

    Run on read, per player — at the start of ``/stats/me`` (via games.sweep_gate)
    and ``/games/me`` — so no scheduler is needed. Sessions that never call those
    again keep their open rows; leaderboards never read open rows, so that gap
    only affects analytics.
    """
    now = now or datetime.now(UTC)
    hours = stale_game_hours()
    hours_ago = timedelta(hours=hours)
    # Both values compile per dialect (db.jsonx): on SQLite the timestamp is
    # built in the ORM's text format so it orders against ORM-written rows.
    stmt = (
        update(Game)
        .where(
            Game.session_id == session_id,
            Game.completed_at.is_(None),
            Game.started_at < now - hours_ago,
        )
        .values(
            outcome=GameOutcome.ABANDONED.value,
            completed_at=plus_hours(Game.started_at, hours),
            game_metadata=json_set_true(Game.game_metadata, SWEPT_KEY),
        )
        .execution_options(synchronize_session=False)
    )
    result = await session.execute(stmt)
    await session.commit()
    return result.rowcount or 0


async def sweep_stale_games_safely(session: AsyncSession, *, session_id: str) -> bool:
    """Run the sweep without ever failing the read it precedes.

    A failure is logged at ERROR (Sentry's logging integration captures it) and
    rolled back so the read can go on; returns False then, else True. The log
    carries the exception class only: a DBAPI error's text includes the
    statement's bound parameters, session id among them, and the privacy policy
    keeps identifiers out of crash reports.
    """
    try:
        await sweep_stale_games(session, session_id=session_id)
    except Exception as exc:  # noqa: BLE001 — a sweep failure must never fail the read
        logger.error(
            "stale-session sweep failed (%s); serving the read unswept", type(exc).__name__
        )
        with contextlib.suppress(Exception):
            await session.rollback()
        return False
    return True

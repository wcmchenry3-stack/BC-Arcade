"""Stale-session sweep (#2621): closes games left open for over 24 h as abandoned.

Run on read, per player, from ``games.sweep_gate`` and ``GET /games/me``, so no
scheduler is needed. The sweep flag it writes (``metadata[SWEPT_KEY]``) lets a
real completion arriving later replace the swept row (``games.sessions``).
"""

from __future__ import annotations

import contextlib
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import Text, func, literal, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from db.dialect import dialect_name
from db.models import Game
from games.filters import SWEPT_KEY
from vocab import GameOutcome

logger = logging.getLogger(__name__)

# A game still open this long after it started was left by killing the app.
# The sweep marks what it closes with metadata[SWEPT_KEY] = true (games.filters),
# which lets a real completion that arrives later replace it (complete_game).
STALE_GAME_AFTER = timedelta(hours=24)


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
    dialect = dialect_name(session)
    if dialect == "sqlite":
        # SQLite stores DateTime as text, and the ORM writes it as
        # 'YYYY-MM-DD HH:MM:SS.ffffff'. Build exactly that, so text comparisons
        # against ORM-written timestamps order correctly: date math on the whole
        # seconds (SQLite's own %f has only milliseconds), then the original
        # microseconds, padded for a started_at stored without a fraction.
        fraction = func.substr(Game.started_at, 21, type_=Text) + "000000"
        completed_at = (
            func.strftime("%Y-%m-%d %H:%M:%S", Game.started_at, "+24 hours", type_=Text)
            + "."
            + func.substr(fraction, 1, 6, type_=Text)
        )
        metadata = func.json_set(Game.game_metadata, f"$.{SWEPT_KEY}", func.json("true"))
    else:
        completed_at = Game.started_at + STALE_GAME_AFTER
        metadata = Game.game_metadata.op("||")(literal({SWEPT_KEY: True}, JSONB))
    stmt = (
        update(Game)
        .where(
            Game.session_id == session_id,
            Game.completed_at.is_(None),
            Game.started_at < now - STALE_GAME_AFTER,
        )
        .values(
            outcome=GameOutcome.ABANDONED.value,
            completed_at=completed_at,
            game_metadata=metadata,
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

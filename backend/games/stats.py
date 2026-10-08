"""Per-session stats aggregation behind ``GET /stats/me`` (#365, #2620).

``get_stats_for_session`` runs one aggregate query plus a latest-row lookup (and
a win-streak scan when some game has a win or loss) and delegates per-game
shaping to each module's ``stats_shape()``. The SQL column helpers live in
``games.stats_columns``.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import sentry_sdk
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.dialect import dialect_name
from db.models import Game, GameType
from games.filters import not_abandoned, not_swept
from games.registry import get_module
from games.stats_columns import _LOSS, _WIN, _comparable_columns, _comparable_fields


@dataclass
class GameTypeStats:
    last_played_at: datetime | None
    # Completed-only count behind Arcade XP (#2472). Set straight from the
    # aggregate query, never through stats_shape(): a game module must not be
    # able to shape how much XP it grants.
    completed_played: int = 0
    # Comparable per-game fields (#2620). Like completed_played they come
    # straight from the queries, never through stats_shape(), so every game
    # reports them the same way. Meanings: GameTypeStatsResponse.
    sessions: int = 0
    won: int | None = None
    lost: int | None = None
    tied: int | None = None
    current_win_streak: int | None = None
    best_win_streak: int | None = None
    time_played_ms: int = 0
    best_value: int | float | None = None
    best_label_key: str | None = None
    # Game-specific figures from stats_shape()'s "extras" (Blackjack's chips).
    extras: dict[str, Any] = field(default_factory=dict)


@dataclass
class StatsSummary:
    total_games: int
    by_game: dict[str, GameTypeStats]
    favorite_game: str | None


def win_streaks(outcomes: Iterable[str]) -> tuple[int, int]:
    """``(current, best)`` runs of consecutive wins, oldest outcome first.

    A ``loss`` ends a run. Every other outcome — ``push``, ``abandoned``,
    ``completed``, ``kept_playing`` — neither extends nor breaks it.
    """
    current = best = 0
    for outcome in outcomes:
        if outcome == _WIN:
            current += 1
            best = max(best, current)
        elif outcome == _LOSS:
            current = 0
    return current, best


async def _win_streaks_by_game(
    session: AsyncSession, *, session_id: str
) -> dict[str, tuple[int, int]]:
    """One ordered scan of the session's ``win``/``loss`` rows, all games at once.

    Only those two outcomes can move a streak (see ``win_streaks``), so every
    other row is left out of the scan.
    """
    rows = (
        await session.execute(
            select(GameType.name, Game.outcome)
            .join(GameType, Game.game_type_id == GameType.id)
            .where(
                Game.session_id == session_id,
                Game.completed_at.is_not(None),
                Game.outcome.in_((_WIN, _LOSS)),
            )
            .order_by(GameType.name, Game.completed_at, Game.started_at, Game.id)
        )
    ).all()
    outcomes_by_game: dict[str, list[str]] = {}
    for name, outcome in rows:
        outcomes_by_game.setdefault(name, []).append(outcome)
    return {name: win_streaks(outcomes) for name, outcomes in outcomes_by_game.items()}


async def get_stats_for_session(session: AsyncSession, *, session_id: str) -> StatsSummary:
    """Aggregate per-game-type stats for a single session.

    Only counts finished games (``completed_at`` set); in-progress games are
    left out.

    Abandoned games (#2468 / #2472) are counted but not scored. ``sessions``
    and ``last_played_at`` are lifecycle facts and still include them (though
    not ``last_played_at`` for a row the stale-session sweep closed); every
    score aggregate (``best_value`` and the ``best`` / ``latest_score`` inputs
    to ``stats_shape()``) and ``completed_played`` — the count XP is derived
    from — excludes them, because the frontend abandon paths do send a
    ``final_score`` (Sudoku sends the full completion formula, so a 0-error
    abandon on Hard scores 300).

    Per-game stat shaping is delegated to each module's ``stats_shape()``
    method via the registry (#541).  No game-name branches live here.

    The comparable fields (#2620: ``sessions``, ``won``/``lost``/``tied``,
    win streaks, ``time_played_ms``, ``best_value``) are set from the queries
    and the game's ``BoardDefinition``, never through ``stats_shape()``. They
    add conditional aggregates to the one aggregate query plus, only when some
    game has a ``win`` or ``loss``, one ordered scan for the win streaks.
    """
    # --- aggregate query -------------------------------------------------
    # Conditional aggregates keep this one round-trip: `case` with no `else`
    # yields NULL, which count/max/avg all skip.
    scored = case((not_abandoned(), Game.final_score))
    rows = (
        await session.execute(
            select(
                GameType.name,
                func.count(Game.id).label("played"),
                func.count(case((not_abandoned(), Game.id))).label("completed_played"),
                # The highest score: the ``best`` input to stats_shape()
                # (Blackjack's best_chips).
                func.max(scored).label("best"),
                # Swept rows (#2621) carry a synthetic completed_at
                # (started_at + 24 h), not a time the player played.
                func.max(case((not_swept(), Game.completed_at))).label("last_played_at"),
                *_comparable_columns(dialect_name(session)),
            )
            .select_from(Game)
            .join(GameType, Game.game_type_id == GameType.id)
            .where(
                Game.session_id == session_id,
                Game.completed_at.is_not(None),
            )
            .group_by(GameType.name)
        )
    ).all()
    streaks = (
        await _win_streaks_by_game(session, session_id=session_id)
        if any(row.won or row.lost for row in rows)
        else {}
    )

    # --- pre-fetch the latest row per game type --------------------------
    # Used by modules (e.g. Blackjack) that need the most-recent score or
    # metadata. Score and metadata come from *different* latest rows on
    # purpose:
    #
    #   score    — skips abandons (#2468). Blackjack reads current_chips
    #              through it, so an abandoned table must not become the
    #              player's live chip balance.
    #   metadata — takes the latest row whatever its outcome, latest by
    #              *start*. Blackjack writes its cumulative run aggregates
    #              (best_run_chips, total_runs, runs_completed, current_table)
    #              at session start, so the newest session always holds the
    #              freshest figures even when it was later abandoned — and "New
    #              Game" and unmount are both abandon paths, so filtering here
    #              would blank the run history for anyone who has not just
    #              cashed out or busted. Ordering by started_at also keeps a
    #              swept row (#2621) in its place: its completed_at is a
    #              synthetic started_at + 24 h that can postdate newer games,
    #              while it still wins when it really is the newest session.
    #
    # Ties (SQLite's server-default started_at has one-second resolution) fall
    # back to completed_at, then id, so exactly one row per game type wins.
    # Both rankings run in one query (#2966): the score one partitions the
    # abandoned rows apart, and only its non-abandoned rank 1 supplies a score.
    abandoned = case((not_abandoned(), 0), else_=1)
    ranked = (
        select(
            Game.id,
            abandoned.label("abandoned"),
            func.row_number()
            .over(
                partition_by=(Game.game_type_id, abandoned),
                order_by=(Game.completed_at.desc(), Game.id.desc()),
            )
            .label("score_rn"),
            func.row_number()
            .over(
                partition_by=Game.game_type_id,
                order_by=(Game.started_at.desc(), Game.completed_at.desc(), Game.id.desc()),
            )
            .label("meta_rn"),
        )
        .where(Game.session_id == session_id, Game.completed_at.is_not(None))
        .subquery()
    )
    is_score_row = (ranked.c.score_rn == 1) & (ranked.c.abandoned == 0)
    latest_rows = (
        await session.execute(
            select(GameType.name, Game.final_score, Game.game_metadata, ranked.c.meta_rn == 1)
            .join(GameType, Game.game_type_id == GameType.id)
            .join(ranked, (Game.id == ranked.c.id) & (is_score_row | (ranked.c.meta_rn == 1)))
            .add_columns(is_score_row)
        )
    ).all()
    latest_score_by_name: dict[str, int | None] = {
        name: (int(score) if score is not None else None)
        for name, score, _, _, score_row in latest_rows
        if score_row
    }
    latest_meta_by_name: dict[str, dict] = {
        name: (meta or {}) for name, _, meta, meta_row, _ in latest_rows if meta_row
    }

    # --- build per-game stats via module dispatch -------------------------
    by_game: dict[str, GameTypeStats] = {}
    total = 0
    favorite: str | None = None
    favorite_count = -1

    for row in rows:
        name, played, completed_played = row.name, row.played, row.completed_played
        game_module = get_module(name)
        if game_module is None:
            # A game type with rows but no module is a bug, but it must not
            # take /stats/me down for every player who played it: report it
            # and leave that game out (it has no board or stats shape).
            sentry_sdk.capture_message(
                f"/stats: no GameModule for game type {name!r}; left out", level="error"
            )
            continue
        total += played

        raw: dict = {
            "best": int(row.best) if row.best is not None else None,
            "last_played_at": row.last_played_at,
            "latest_score": latest_score_by_name.get(name),
            "metadata": latest_meta_by_name.get(name, {}),
        }

        shaped = game_module.stats_shape(raw)

        extras: dict[str, Any] = dict(shaped.get("extras") or {})

        by_game[name] = GameTypeStats(
            last_played_at=shaped.get("last_played_at"),
            extras=extras,
            completed_played=completed_played,
            **_comparable_fields(row, game_module.board, streaks.get(name)),
        )

        if played > favorite_count:
            favorite = name
            favorite_count = played

    return StatsSummary(total_games=total, by_game=by_game, favorite_game=favorite)

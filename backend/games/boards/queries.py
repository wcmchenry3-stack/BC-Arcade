"""Board, viewer and rank queries (#2618, #2633, #2677; split out in #2992).

``top_entries`` lists a board, ``viewer_entry`` is the caller's own entry on
it and ``game_rank`` / ``player_standing`` answer ``GET /games/{id}/rank``.
All of them read through the same ``games.boards.sql`` filters and order, so
a rank always agrees with the listed board.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import ColumnElement, Select, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.models import Game
from games import catalog_cache
from games.board import DURATION_METRIC, SCORE_METRIC, BoardDefinition
from games.boards.limits import is_count
from games.boards.partitions import metric_cap, row_partition
from games.boards.sql import (
    best_rows,
    board_filters,
    board_order,
    display_name,
    metric_expr,
    tiebreak_expr,
)
from games.boards.types import BestRow, BoardEntry, GameRank, LeaderboardError, Standing
from games.filters import is_swept
from games.ranking import compute_rank
from games.registry import get_module
from players.names import display_name_of, session_has_display_name
from vocab import GameOutcome

logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 10
MAX_LIMIT = 100


def top_statement(
    board: BoardDefinition,
    game_type_id: int,
    partition: Mapping[str, str | None],
    limit: int = DEFAULT_LIMIT,
) -> Select:
    """The SELECT behind ``top_entries`` (exposed for EXPLAIN checks)."""
    metric = metric_expr(board, metric_cap(board, partition))
    sub = best_rows(board, board_filters(board, game_type_id, partition), metric)
    top = (
        select(sub)
        .where(sub.c.rn == 1)
        .order_by(*board_order(board, sub))
        .limit(limit)
        .subquery("top_rows")
    )
    return select(top, display_name_of(top.c.session_id).label("player_name")).order_by(
        *board_order(board, top)
    )


async def top_entries(
    db: AsyncSession,
    *,
    game_type: str,
    board: BoardDefinition,
    game_type_id: int,
    partition: Mapping[str, str | None],
    limit: int = DEFAULT_LIMIT,
    viewer_session_id: str | None = None,
) -> list[BoardEntry]:
    """The top ``limit`` players on a board, one entry each, best first.

    The entry of ``viewer_session_id`` (the caller, when known) is flagged
    ``is_me`` (#2633), so the app never has to match a row by name.
    """
    stmt = top_statement(board, game_type_id, partition, limit)
    try:
        rows = (await db.execute(stmt)).all()
    except SQLAlchemyError as exc:
        _log_db_error("leaderboard query", game_type, exc)
        raise LeaderboardError(500, "Failed to load leaderboard.") from exc

    entries: list[BoardEntry] = []
    prev_key: tuple | None = None
    rank = 0
    for i, row in enumerate(rows):
        key = (row.value, row.tiebreak, row.completed_at)
        # Players with identical keys share a rank, as compute_rank reports it.
        if key != prev_key:
            rank = i + 1
            prev_key = key
        entries.append(
            BoardEntry(
                rank=rank,
                player_name=display_name(row.player_name),
                value=int(row.value),
                completed_at=row.completed_at,
                is_me=viewer_session_id is not None and row.session_id == viewer_session_id,
            )
        )
    return entries


async def viewer_entry(
    db: AsyncSession,
    *,
    game_type: str,
    board: BoardDefinition,
    game_type_id: int,
    partition: Mapping[str, str | None],
    session_id: str,
) -> BoardEntry | None:
    """The caller's own entry on one board: their best row and its exact rank (#2633).

    What the leaderboard screen pins as "Your best" when the player is outside
    the listed top N. Uses the board's own filters, best-row order and
    ``compute_rank``, like ``player_standing``, so it agrees with the list.
    ``None`` when the player has no entry there (no display name, or no
    eligible row). Reads only; a DB error is a clean 500.
    """
    filters = board_filters(board, game_type_id, partition)
    metric = metric_expr(board, metric_cap(board, partition))
    try:
        # Name and best row in one query; the board's filters only admit
        # named players, so a row always has a name.
        best = await _session_best(db, board, filters, metric, session_id, with_name=True)
    except SQLAlchemyError as exc:
        _log_db_error("viewer entry query", game_type, exc)
        raise LeaderboardError(500, "Failed to load leaderboard.") from exc
    if best is None:
        return None
    rank = await _best_row_rank(db, board, filters, metric, best, game_type)
    return BoardEntry(
        rank=rank,
        player_name=display_name(best.player_name),
        value=int(best.value),
        completed_at=best.completed_at,
        is_me=True,
    )


def _log_db_error(what: str, game_type: str, exc: SQLAlchemyError) -> None:
    # Class name and game type only: SQLAlchemy's message carries the bound
    # parameters, which include session ids (privacy policy: no identifiers).
    logger.error("%s failed for %s: %s", what, game_type, type(exc).__name__)


async def _session_best(
    db: AsyncSession,
    board: BoardDefinition,
    filters: Sequence[ColumnElement],
    metric: ColumnElement,
    session_id: str,
    *,
    with_name: bool = False,
) -> BestRow | None:
    """The session's best row on the board; ``with_name`` also reads the
    player's display name in the same query (as ``top_statement`` does)."""
    sub = best_rows(board, [*filters, Game.session_id == session_id], metric)
    columns: list[Any] = [sub]
    if with_name:
        columns.append(display_name_of(sub.c.session_id).label("player_name"))
    row = (await db.execute(select(*columns).where(sub.c.rn == 1))).first()
    if row is None:
        return None
    return BestRow(
        game_id=row.game_id,
        value=row.value,
        tiebreak=row.tiebreak,
        completed_at=row.completed_at,
        player_name=row.player_name if with_name else None,
    )


def _metric_value(board: BoardDefinition, game: Game) -> Any:
    if board.metric == SCORE_METRIC:
        return game.final_score
    if board.metric == DURATION_METRIC:
        return game.duration_ms
    return (game.game_metadata or {}).get(board.metric)


def _not_finished(board: BoardDefinition, game: Game) -> bool:
    """``game`` has no completion or no metric value yet: nothing to rank *so far*.

    A completion still in the app's sync queue looks exactly like this, so it
    is the one unrankable cause that can change (``not_finished`` on the rank
    route); every other cause in ``_unrankable_reason`` is permanent.

    ``duration_ms`` is written by the completion itself, so a completed game
    without one never gets one: it is unrankable, not unfinished (#2747). A row
    the stale-game sweep closed (``metadata.swept``) is not completed: the real
    completion can still replace it, so it stays unfinished on every board.
    """
    if game.completed_at is None or is_swept(game.game_metadata):
        return True
    return board.metric != DURATION_METRIC and _metric_value(board, game) is None


def _unrankable_reason(board: BoardDefinition, game: Game) -> str | None:
    """Why ``game`` can't appear on its board (mirrors ``board_filters``)."""
    if _not_finished(board, game):
        return "Game has no final score."
    value = _metric_value(board, game)
    if value is None:
        return f"Game has no {board.metric}."
    if game.outcome == GameOutcome.ABANDONED.value:
        return "Abandoned games are not ranked."
    if board.qualifying_outcomes is not None and game.outcome not in board.qualifying_outcomes:
        return "This game's outcome is not ranked."
    partition = row_partition(board, game.game_metadata or {})
    if any(v is None for v in partition.values()):
        # e.g. a Mahjong clear from before #2627 records no layout, and the
        # board has no default for it (#2747): no board can be named for it.
        return "This game's board does not exist."
    if any(not board.is_allowed(k, v) for k, v in partition.items() if v is not None):
        # e.g. a Star Swarm tier the backend doesn't know yet: stored, so the
        # run isn't lost, but there is no board to rank it on.
        return "This game's board does not exist."
    cap = metric_cap(board, partition)
    if not is_count(value) or value < board.min_value or value > cap:
        return f"{board.metric} must be an integer from {board.min_value} to {cap} to be ranked."
    return None


async def player_standing(
    db: AsyncSession, *, board: BoardDefinition, game: Game, session_id: str
) -> Standing | None:
    """The player's standing in ``game``'s partition (``session_id`` owns ``game``).

    The one standing calculation, behind ``GET /games/{id}/rank``. It uses the
    board's own filters and order, so it agrees with the listed board.
    Returns the exact rank of the player's best entry in that partition and
    whether ``game`` is that entry, or ``None`` when the player has no entry
    there (no display name, or no eligible row). Reads only; a DB error is a
    clean 500.
    """
    game_type = game.game_type.name
    partition = row_partition(board, game.game_metadata or {})
    filters = board_filters(board, game.game_type_id, partition)
    metric = metric_expr(board, metric_cap(board, partition))
    try:
        best = await _session_best(db, board, filters, metric, session_id)
    except SQLAlchemyError as exc:
        _log_db_error("player best query", game_type, exc)
        raise LeaderboardError(500, "Failed to calculate rank.") from exc
    if best is None:
        return None
    rank = await _best_row_rank(db, board, filters, metric, best, game_type)
    return Standing(rank=rank, is_best=best.game_id == game.id)


async def _best_row_rank(
    db: AsyncSession,
    board: BoardDefinition,
    filters: Sequence[ColumnElement],
    metric: ColumnElement,
    best: BestRow,
    game_type: str,
) -> int:
    """The exact rank of a player's best row, with the board's order."""
    tiebreak_arg = None
    if board.tiebreak is not None:
        tb = tiebreak_expr(board)
        assert tb is not None
        tiebreak_arg = (tb, board.tiebreak[1], best.tiebreak)
    return await compute_rank(
        db,
        metric=metric,
        direction=board.direction,
        value=best.value,
        completed_at=best.completed_at,
        tiebreak=tiebreak_arg,
        filters=filters,
        game_label=game_type,
    )


async def game_rank(db: AsyncSession, *, game: Game, session_id: str) -> GameRank:
    """``GET /games/{id}/rank``: where ``game`` puts its player (#2677). Writes nothing.

    ``game`` must be loaded with its ``game_type`` and owned by ``session_id``
    (the router checks both). 404 when the game has no board definition at
    all. Otherwise the player's standing (``player_standing``), or
    ``ranked: false`` with the first reason that applies:

    - ``board_disabled``: the game has no leaderboard (Blackjack, Daily Word);
    - ``not_finished``: no completion or no metric value yet. Usually the
      completion is still in the app's sync queue, so asking again later can
      give a rank;
    - ``not_rankable``: this game can never be on its board (abandoned, a
      non-qualifying outcome, over the cap, a partition value with no board,
      a sentinel session, ...).
    - ``no_name``: the player has no display name, so no board shows them and
      no rank is computed. Checked after the game, so a result card never
      asks for a name the game couldn't use.
    """
    game_type = game.game_type.name
    mod = get_module(game_type)
    board = mod.board if mod is not None else None
    if board is None:
        raise LeaderboardError(404, f"{game_type} has no leaderboard.")
    if not board.enabled:
        return GameRank(ranked=False, reason="board_disabled")
    if _not_finished(board, game):
        return GameRank(ranked=False, reason="not_finished")
    if _unrankable_reason(board, game) is not None:
        return GameRank(ranked=False, reason="not_rankable")
    try:
        named = await session_has_display_name(db, session_id)
    except SQLAlchemyError as exc:
        _log_db_error("player name query", game_type, exc)
        raise LeaderboardError(500, "Failed to calculate rank.") from exc
    if not named:
        return GameRank(ranked=False, reason="no_name")
    standing = await player_standing(db, board=board, game=game, session_id=session_id)
    if standing is None:
        # Named and rankable by the row check, yet off the board (e.g. a
        # sentinel ``*-anon`` session): report what the board shows.
        return GameRank(ranked=False, reason="not_rankable")
    return GameRank(ranked=True, rank=standing.rank, is_best=standing.is_best)


async def load_game(db: AsyncSession, game_id: uuid.UUID) -> Game | None:
    return (
        await db.execute(
            select(Game).options(selectinload(Game.game_type)).where(Game.id == game_id)
        )
    ).scalar_one_or_none()


async def load_game_type(db: AsyncSession, name: str) -> catalog_cache.GameTypeRow | None:
    """The active game type called *name* (from the catalog cache, #2966), else None."""
    gt = await catalog_cache.get_game_type(db, name)
    if gt is None or not gt.is_active:
        return None
    return gt

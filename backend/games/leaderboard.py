"""Generic leaderboards, driven by each module's ``BoardDefinition`` (#2618).

One query, one rank calculation and one "put my name on this game" operation
serve every game. They replace the per-game leaderboard routers, which stay in
place (unchanged) until #2644 because v1.0 clients still call them.

Rules every board follows
-------------------------
- **One entry per player** (#2519 decision 12): rows are grouped by
  ``session_id`` and only each session's best row is listed. "Best" is the
  board's metric in its direction, then its tie-break, then the earliest
  ``completed_at``. The same key orders the board and drives the rank, so a
  replay that doesn't beat a player's best never shows up.
- **Only named rows rank**: a row needs a non-blank ``metadata.player_name``.
  A player's best is taken among their named rows.
- **Excluded**: abandoned rows (``not_abandoned()``) and every sentinel
  ``*-anon`` session. Old clients keep writing those rows through
  ``POST /<game>/score`` until #2644, so this must hold without #2622 having
  deleted them.
- **Exact rank**: the number of players whose best beats yours, plus one.

The per-player best uses ``ROW_NUMBER() OVER (PARTITION BY session_id ...)``
so it runs on SQLite (CI, >= 3.25) and Postgres (prod); ``DISTINCT ON`` is
Postgres-only.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import ColumnElement, Float, Select, Subquery, func, literal, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.models import Game, GameType
from games.board import SCORE_METRIC, BoardDefinition, Direction
from games.filters import not_abandoned
from games.ranking import compute_rank
from games.registry import get_module
from vocab import GameOutcome

DEFAULT_LIMIT = 10
MAX_LIMIT = 100

SENTINEL_SESSION_SUFFIX = "-anon"
"""Sessions like ``solitaire-anon``, written by the legacy ``POST /<game>/score``."""

MAX_PARTITION_VALUE_LENGTH = 64

LEGACY_PARTITION_DEFAULTS: dict[str, dict[str, str]] = {
    # Sudoku rows written before #748 have no ``variant``; they are classic
    # games (``sudoku/router.py``). A request without ``variant`` also means
    # classic, as it does on ``GET /sudoku/scores/{difficulty}``.
    "sudoku": {"variant": "classic"},
}

# A missing tie-break value sorts after every real one, whatever the direction.
_WORST_TIEBREAK = 1e15


class LeaderboardError(HTTPException):
    """An HTTP error raised by the leaderboard layer."""


@dataclass(frozen=True)
class BoardEntry:
    rank: int
    player_name: str
    value: int
    completed_at: datetime


@dataclass(frozen=True)
class NameResult:
    rank: int
    is_best: bool


@dataclass(frozen=True)
class _BestRow:
    game_id: uuid.UUID
    value: Any
    tiebreak: Any
    completed_at: datetime


@dataclass(frozen=True)
class LimitViolation:
    game_type: str
    metric: str
    detail: str


# ---------------------------------------------------------------------------
# Board lookup and partitions
# ---------------------------------------------------------------------------


def enabled_board(game_type: str) -> BoardDefinition | None:
    """The game's board, or ``None`` if the game is unknown or has no leaderboard."""
    mod = get_module(game_type)
    board = getattr(mod, "board", None) if mod is not None else None
    if board is None or not board.enabled:
        return None
    return board


def resolve_partition(
    game_type: str, board: BoardDefinition, params: Sequence[tuple[str, str]]
) -> dict[str, str]:
    """Validate request query params against ``board.partitions``.

    Every partition key is required unless it has a legacy default. Unknown or
    repeated keys are rejected so a typo can't silently show the wrong board.
    """
    defaults = LEGACY_PARTITION_DEFAULTS.get(game_type, {})
    given: dict[str, str] = {}
    for key, value in params:
        if key not in board.partitions:
            raise LeaderboardError(400, f"Unknown partition {key!r} for {game_type}.")
        if key in given:
            raise LeaderboardError(400, f"Partition {key!r} given more than once.")
        if not value or len(value) > MAX_PARTITION_VALUE_LENGTH:
            raise LeaderboardError(400, f"Invalid value for partition {key!r}.")
        given[key] = value
    partition: dict[str, str] = {}
    for key in board.partitions:
        if key in given:
            partition[key] = given[key]
        elif key in defaults:
            partition[key] = defaults[key]
        else:
            raise LeaderboardError(400, f"Partition {key!r} is required for {game_type}.")
    return partition


def row_partition(
    game_type: str, board: BoardDefinition, metadata: Mapping[str, Any]
) -> dict[str, str | None]:
    """The partition a stored row belongs to (legacy defaults applied)."""
    defaults = LEGACY_PARTITION_DEFAULTS.get(game_type, {})
    out: dict[str, str | None] = {}
    for key in board.partitions:
        value = metadata.get(key)
        if value is None:
            value = defaults.get(key)
        out[key] = None if value is None else str(value)
    return out


# ---------------------------------------------------------------------------
# SQL building blocks
# ---------------------------------------------------------------------------


def _name_expr() -> ColumnElement:
    return Game.game_metadata["player_name"].as_string()


def metric_expr(board: BoardDefinition) -> ColumnElement:
    """The ranked value: the ``final_score`` column or a metadata number."""
    if board.metric == SCORE_METRIC:
        return Game.final_score
    return Game.game_metadata[board.metric].as_float()


def tiebreak_expr(board: BoardDefinition) -> ColumnElement | None:
    """The tie-break value; a row without one sorts last."""
    if board.tiebreak is None:
        return None
    key, direction = board.tiebreak
    worst = _WORST_TIEBREAK if direction == "asc" else -_WORST_TIEBREAK
    return func.coalesce(Game.game_metadata[key].as_float(), literal(worst, Float))


def _ordered(expr: ColumnElement, direction: Direction) -> ColumnElement:
    return expr.desc() if direction == "desc" else expr.asc()


def board_filters(
    game_type: str,
    board: BoardDefinition,
    game_type_id: int,
    partition: Mapping[str, str | None],
) -> list[ColumnElement]:
    """Which rows may appear on the board (before one-per-player)."""
    name = _name_expr()
    defaults = LEGACY_PARTITION_DEFAULTS.get(game_type, {})
    filters: list[ColumnElement] = [
        Game.game_type_id == game_type_id,
        # For final_score boards this is the games_game_type_score_idx predicate.
        metric_expr(board).is_not(None),
        Game.completed_at.is_not(None),
        not_abandoned(),
        Game.session_id.not_like(f"%{SENTINEL_SESSION_SUFFIX}"),
        func.trim(name) != "",  # also false for a missing name (NULL)
    ]
    for key, value in partition.items():
        col = Game.game_metadata[key].as_string()
        if value is None:
            filters.append(col.is_(None))
        elif defaults.get(key) == value:
            filters.append(or_(col == value, col.is_(None)))
        else:
            filters.append(col == value)
    return filters


def _best_rows(board: BoardDefinition, filters: Sequence[ColumnElement]) -> Subquery:
    """Every eligible row with ``rn`` = its place within its own session.

    Kept narrow (no name) so the window's sort stays in memory on a large
    board; ``top_entries`` joins the name back for the rows it returns.
    """
    metric = metric_expr(board)
    tiebreak = tiebreak_expr(board)
    order = [_ordered(metric, board.direction)]
    if tiebreak is not None and board.tiebreak is not None:
        order.append(_ordered(tiebreak, board.tiebreak[1]))
    order += [Game.completed_at.asc(), Game.id.asc()]
    tiebreak_col = tiebreak if tiebreak is not None else literal(None)
    return (
        select(
            Game.id.label("game_id"),
            Game.session_id.label("session_id"),
            metric.label("value"),
            tiebreak_col.label("tiebreak"),
            Game.completed_at.label("completed_at"),
            func.row_number().over(partition_by=Game.session_id, order_by=order).label("rn"),
        )
        .where(*filters)
        .subquery("session_rows")
    )


def _board_order(board: BoardDefinition, sub: Subquery) -> list[ColumnElement]:
    order = [_ordered(sub.c.value, board.direction)]
    if board.tiebreak is not None:
        order.append(_ordered(sub.c.tiebreak, board.tiebreak[1]))
    order += [sub.c.completed_at.asc(), sub.c.game_id.asc()]
    return order


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------


def top_statement(
    game_type: str,
    board: BoardDefinition,
    game_type_id: int,
    partition: Mapping[str, str | None],
    limit: int = DEFAULT_LIMIT,
) -> Select:
    """The SELECT behind ``top_entries`` (exposed for EXPLAIN checks)."""
    sub = _best_rows(board, board_filters(game_type, board, game_type_id, partition))
    top = (
        select(sub)
        .where(sub.c.rn == 1)
        .order_by(*_board_order(board, sub))
        .limit(limit)
        .subquery("top_rows")
    )
    return (
        select(top, _name_expr().label("player_name"))
        .join(Game, Game.id == top.c.game_id)
        .order_by(*_board_order(board, top))
    )


async def top_entries(
    db: AsyncSession,
    *,
    game_type: str,
    board: BoardDefinition,
    game_type_id: int,
    partition: Mapping[str, str | None],
    limit: int = DEFAULT_LIMIT,
) -> list[BoardEntry]:
    """The top ``limit`` players on a board, one entry each, best first."""
    stmt = top_statement(game_type, board, game_type_id, partition, limit)
    try:
        rows = (await db.execute(stmt)).all()
    except SQLAlchemyError:
        raise LeaderboardError(500, "Failed to load leaderboard.")

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
                player_name=str(row.player_name).strip(),
                value=int(row.value),
                completed_at=row.completed_at,
            )
        )
    return entries


async def _session_best(
    db: AsyncSession, board: BoardDefinition, filters: Sequence[ColumnElement], session_id: str
) -> _BestRow | None:
    sub = _best_rows(board, [*filters, Game.session_id == session_id])
    row = (await db.execute(select(sub).where(sub.c.rn == 1))).first()
    if row is None:
        return None
    return _BestRow(
        game_id=row.game_id,
        value=row.value,
        tiebreak=row.tiebreak,
        completed_at=row.completed_at,
    )


def _metric_value(board: BoardDefinition, game: Game) -> Any:
    if board.metric == SCORE_METRIC:
        return game.final_score
    return (game.game_metadata or {}).get(board.metric)


async def set_player_name(
    db: AsyncSession, *, game: Game, session_id: str, player_name: str
) -> NameResult:
    """Put ``player_name`` on a finished game and return the player's standing.

    ``game`` must be loaded with its ``game_type`` and owned by ``session_id``
    (the router checks both). Returns the rank of the player's best entry in
    the game's partition, and whether ``game`` is that best entry.
    """
    game_type = game.game_type.name
    board = enabled_board(game_type)
    if board is None:
        raise LeaderboardError(404, f"{game_type} has no leaderboard.")
    if game.completed_at is None or _metric_value(board, game) is None:
        raise LeaderboardError(400, "Game has no final score.")
    if game.outcome == GameOutcome.ABANDONED.value:
        raise LeaderboardError(400, "Abandoned games are not ranked.")

    # Reassign (never mutate in place): the JSONB column isn't a MutableDict.
    metadata = {**(game.game_metadata or {}), "player_name": player_name}
    game.game_metadata = metadata
    try:
        await db.commit()
    except SQLAlchemyError:
        raise LeaderboardError(500, "Failed to save player name.")

    partition = row_partition(game_type, board, metadata)
    filters = board_filters(game_type, board, game.game_type_id, partition)
    best = await _session_best(db, board, filters, session_id)
    if best is None:  # pragma: no cover - the row just named is eligible
        raise LeaderboardError(500, "Failed to calculate rank.")

    tiebreak_arg = None
    if board.tiebreak is not None:
        tb = tiebreak_expr(board)
        assert tb is not None
        tiebreak_arg = (tb, board.tiebreak[1], best.tiebreak)
    rank = await compute_rank(
        db,
        metric=metric_expr(board),
        direction=board.direction,
        value=best.value,
        completed_at=best.completed_at,
        tiebreak=tiebreak_arg,
        filters=filters,
        game_label=game_type,
    )
    return NameResult(rank=rank, is_best=best.game_id == game.id)


async def load_game(db: AsyncSession, game_id: uuid.UUID) -> Game | None:
    return (
        await db.execute(
            select(Game).options(selectinload(Game.game_type)).where(Game.id == game_id)
        )
    ).scalar_one_or_none()


async def load_game_type(db: AsyncSession, name: str) -> GameType | None:
    gt = (await db.execute(select(GameType).where(GameType.name == name))).scalar_one_or_none()
    if gt is None or not gt.is_active:
        return None
    return gt


# ---------------------------------------------------------------------------
# Submission limits (PATCH /games/{id}/complete)
# ---------------------------------------------------------------------------


def _is_count(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def board_limit_violation(
    game_type: str,
    board: BoardDefinition | None,
    final_score: int | None,
    metadata: Mapping[str, Any],
) -> LimitViolation | None:
    """Why a completion breaks the board's limits, or ``None`` if it doesn't.

    ``metadata`` is the row's metadata as it will be stored (the validated
    result merged under the creation-time keys). A metric above
    ``max_value`` is rejected (absorbs #2215). A metadata metric or tie-break
    must be a non-negative integer, so the board query's numeric cast can't
    fail on a malformed row.
    """
    if board is None:
        return None
    metric = board.metric
    if metric == SCORE_METRIC:
        value: Any = final_score
    else:
        value = metadata.get(metric)
        if value is not None and not _is_count(value):
            return LimitViolation(game_type, metric, f"{metric} must be a non-negative integer.")
    if board.max_value is not None and value is not None and value > board.max_value:
        return LimitViolation(
            game_type,
            metric,
            f"{metric} {value} is above the maximum {board.max_value} for {game_type}.",
        )
    if board.tiebreak is not None:
        key = board.tiebreak[0]
        tb_value = metadata.get(key)
        if tb_value is not None and not _is_count(tb_value):
            return LimitViolation(game_type, key, f"{key} must be a non-negative integer.")
    return None


async def check_completion_limits(
    db: AsyncSession, game: Game, final_score: int | None, result: Mapping[str, Any]
) -> LimitViolation | None:
    """``board_limit_violation`` for a game about to be completed."""
    name = (
        await db.execute(select(GameType.name).where(GameType.id == game.game_type_id))
    ).scalar_one()
    mod = get_module(name)
    board = getattr(mod, "board", None) if mod is not None else None
    merged = {**result, **(game.game_metadata or {})}
    return board_limit_violation(name, board, final_score, merged)

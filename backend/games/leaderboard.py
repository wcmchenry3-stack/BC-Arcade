"""Generic leaderboards, driven by each module's ``BoardDefinition`` (#2618).

One query, one rank calculation and one name operation serve every game.
They replace the per-game leaderboard routers, which stay in place
(unchanged) until #2644 because v1.0 clients still call them.

Rules every board follows
-------------------------
- **One entry per player** (#2519 decision 12): rows are grouped by
  ``session_id`` and only each session's best row is listed. "Best" is the
  board's metric in its direction, then its tie-break, then the earliest
  ``completed_at``. The same key orders the board and drives the rank, so a
  replay that doesn't beat a player's best never shows up.
- **Only named players rank** (#2624, #2519 decisions 17-18): a session ranks
  only if its player has a display name (a ``players`` row), and then **every**
  eligible finished game of that player counts. The name shown is the
  player's current one, looked up through ``players.names`` (the one place
  #1047's accounts will change), so a rename shows on every entry at once.
  ``metadata.player_name`` plays no part in ranking.
- **Excluded**: abandoned rows (``not_abandoned()``), rows whose outcome is
  not in ``qualifying_outcomes`` (when the board sets it), and every sentinel
  ``*-anon`` session. Old clients keep writing those rows through
  ``POST /<game>/score`` until #2644, so this must hold without #2622 having
  deleted them.
- **Only sane values rank**: the metric must be an integer from 0 to the
  row's effective cap (``board.max_value_for``, or ``MAX_BOARD_VALUE`` when
  uncapped). A tie-break that isn't an integer in ``[0, MAX_BOARD_VALUE]``
  counts as missing. Rows stored before these rules were enforced on write
  (negative, over-cap, strings, huge numbers) are filtered on read, so they
  can neither top a board nor break its query.
- **Exact rank**: the number of players whose best beats yours, plus one.

The per-player best uses ``ROW_NUMBER() OVER (PARTITION BY session_id ...)``
so it runs on SQLite (CI, >= 3.25) and Postgres (prod); ``DISTINCT ON`` is
Postgres-only.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import (
    BigInteger,
    ColumnElement,
    Select,
    Subquery,
    and_,
    case,
    cast,
    func,
    literal,
    or_,
    select,
)
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import selectinload
from sqlalchemy.sql.expression import FunctionElement

from db.models import PLAYER_DISPLAY_NAME_MAX_LENGTH, Game, GameType
from games.board import SCORE_METRIC, BoardDefinition, Direction
from games.filters import not_abandoned
from games.protocol import GameModule
from games.ranking import compute_rank
from games.registry import get_module
from players import service as players_service
from players.names import display_name_of, has_display_name
from vocab import GameOutcome

logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 10
MAX_LIMIT = 100

SENTINEL_SESSION_SUFFIX = "-anon"
"""Sessions like ``solitaire-anon``, written by the legacy ``POST /<game>/score``."""

MAX_PARTITION_VALUE_LENGTH = 64

MAX_BOARD_VALUE = 2**31 - 1
"""Upper bound for any metric or tie-break value (the ``games.final_score``
column is a 32-bit integer). Bounds uncapped boards and every tie-break."""

MAX_NAME_LENGTH = PLAYER_DISPLAY_NAME_MAX_LENGTH
"""Longest name a board shows. Every write path enforces it; names are also
cut on read, so a longer stored name can never widen a board."""

# A missing tie-break value sorts after every real one, whatever the direction.
_WORST_TIEBREAK = {"asc": MAX_BOARD_VALUE + 1, "desc": -1}


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
    board = _module_board(get_module(game_type))
    if board is None or not board.enabled:
        return None
    return board


def _module_board(mod: GameModule | None) -> BoardDefinition | None:
    return getattr(mod, "board", None) if mod is not None else None


def resolve_partition(
    game_type: str, board: BoardDefinition, params: Sequence[tuple[str, str]]
) -> dict[str, str]:
    """Validate request query params against ``board.partitions``.

    Every partition key is required unless the board declares a default for
    it (``board.partition_default``; e.g. a Sudoku request without ``variant``
    means ``classic``, as on ``GET /sudoku/scores/{difficulty}``). Unknown or
    repeated keys are rejected so a typo can't silently show the wrong board,
    and so is a value outside the key's ``partition_values`` (Star Swarm's
    tiers): there is no board for it.
    """
    given: dict[str, str] = {}
    for key, value in params:
        if key not in board.partitions:
            raise LeaderboardError(400, f"Unknown partition {key!r} for {game_type}.")
        if key in given:
            raise LeaderboardError(400, f"Partition {key!r} given more than once.")
        if not value or len(value) > MAX_PARTITION_VALUE_LENGTH:
            raise LeaderboardError(400, f"Invalid value for partition {key!r}.")
        if not board.is_allowed(key, value):
            raise LeaderboardError(400, f"Unknown value for partition {key!r} of {game_type}.")
        given[key] = value
    partition: dict[str, str] = {}
    for key in board.partitions:
        value = given.get(key, board.partition_default(key))
        if value is None:
            raise LeaderboardError(400, f"Partition {key!r} is required for {game_type}.")
        partition[key] = value
    return partition


def row_partition(board: BoardDefinition, metadata: Mapping[str, Any]) -> dict[str, str | None]:
    """The partition a stored row belongs to (``partition_defaults`` applied)."""
    out: dict[str, str | None] = {}
    for key in board.partitions:
        value = metadata.get(key)
        if value is None:
            value = board.partition_default(key)
        out[key] = None if value is None else str(value)
    return out


def metric_cap(board: BoardDefinition, partition: Mapping[str, Any]) -> int:
    """Highest metric value that ranks in ``partition`` (a row's metadata or a
    resolved request partition): ``board.max_value_for``, else ``MAX_BOARD_VALUE``.
    """
    cap = board.max_value_for(partition)
    return MAX_BOARD_VALUE if cap is None else min(cap, MAX_BOARD_VALUE)


# ---------------------------------------------------------------------------
# SQL building blocks
# ---------------------------------------------------------------------------


class metadata_count(FunctionElement):
    """``games.metadata[key]`` as an integer in ``[0, hi]``, else NULL.

    Only a JSON integer qualifies: a string, bool, float, negative or huge
    value reads as NULL, so a malformed stored row can't break the board query
    (a ``CAST(... AS FLOAT)`` of ``10**400`` overflows on Postgres) or outrank
    real entries. The value is cast only once it is known to fit.
    """

    type = BigInteger()
    name = "metadata_count"
    # ``key`` and ``hi`` are baked into the SQL, not bound: never cache it.
    inherit_cache = False

    def __init__(self, key: str, hi: int) -> None:
        self.key = key
        self.hi = hi
        super().__init__()


@compiles(metadata_count, "postgresql")
def _metadata_count_pg(element: metadata_count, compiler: Any, **kw: Any) -> str:
    node = Game.game_metadata[element.key]
    text = node.as_string()
    # jsonb keeps a number's text form: "5.0" and "-3" fail the regex. At
    # most 10 digits, so the BIGINT cast can't overflow. The nested CASE
    # guarantees the cast only runs on a string that passed both checks.
    number = cast(text, BigInteger)
    expr = case(
        (
            and_(func.jsonb_typeof(node) == "number", text.regexp_match("^[0-9]{1,10}$")),
            case((number <= element.hi, number)),
        )
    )
    return compiler.process(expr, **kw)


@compiles(metadata_count)
def _metadata_count_sqlite(element: metadata_count, compiler: Any, **kw: Any) -> str:
    path = f'$."{element.key}"'
    value = func.json_extract(Game.game_metadata, path)
    # A JSON integer too big for 64 bits reads back as a real (or inf), so
    # the range check drops it.
    expr = case(
        (
            and_(
                func.json_type(Game.game_metadata, path) == "integer",
                value >= 0,
                value <= element.hi,
            ),
            value,
        )
    )
    return compiler.process(expr, **kw)


def display_name(stored: Any) -> str:
    """The name a board shows: trimmed, then cut to ``MAX_NAME_LENGTH``."""
    return str(stored).strip()[:MAX_NAME_LENGTH].rstrip()


def metric_expr(board: BoardDefinition, cap: int) -> ColumnElement:
    """The ranked value: the ``final_score`` column or a metadata integer.

    A metadata metric outside ``[0, cap]`` or not an integer reads as NULL.
    ``final_score`` is returned bare (so ``games_game_type_score_idx`` still
    applies); ``board_filters`` bounds it.
    """
    if board.metric == SCORE_METRIC:
        return Game.final_score
    return metadata_count(board.metric, cap)


def tiebreak_expr(board: BoardDefinition) -> ColumnElement | None:
    """The tie-break value; a row without a valid one sorts last."""
    if board.tiebreak is None:
        return None
    key, direction = board.tiebreak
    return func.coalesce(
        metadata_count(key, MAX_BOARD_VALUE), literal(_WORST_TIEBREAK[direction], BigInteger)
    )


def _ordered(expr: ColumnElement, direction: Direction) -> ColumnElement:
    return expr.desc() if direction == "desc" else expr.asc()


def board_filters(
    board: BoardDefinition,
    game_type_id: int,
    partition: Mapping[str, str | None],
) -> list[ColumnElement]:
    """Which rows may appear on the board (before one-per-player).

    Applies the partition's effective cap and the value checks to every
    stored row, so rows written before they were enforced on
    ``/complete`` never rank.
    """
    cap = metric_cap(board, partition)
    metric = metric_expr(board, cap)
    filters: list[ColumnElement] = [
        Game.game_type_id == game_type_id,
        # For final_score boards this is the games_game_type_score_idx predicate.
        metric.is_not(None),
        Game.completed_at.is_not(None),
        not_abandoned(),
        Game.session_id.not_like(f"%{SENTINEL_SESSION_SUFFIX}"),
        # Only players with a display name rank; all their games count (#2624).
        has_display_name(Game.session_id),
    ]
    if board.metric == SCORE_METRIC:
        filters += [metric >= 0, metric <= cap]
    if board.qualifying_outcomes is not None:
        filters.append(Game.outcome.in_(board.qualifying_outcomes))
    for key, value in partition.items():
        col = Game.game_metadata[key].as_string()
        if value is None:
            filters.append(col.is_(None))
        elif board.partition_default(key) == value:
            filters.append(or_(col == value, col.is_(None)))
        else:
            filters.append(col == value)
    return filters


def _best_rows(
    board: BoardDefinition, filters: Sequence[ColumnElement], metric: ColumnElement
) -> Subquery:
    """Every eligible row with ``rn`` = its place within its own session.

    Kept narrow (no name) so the window's sort stays in memory on a large
    board; ``top_statement`` looks the name up for the rows it returns.
    """
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
    board: BoardDefinition,
    game_type_id: int,
    partition: Mapping[str, str | None],
    limit: int = DEFAULT_LIMIT,
) -> Select:
    """The SELECT behind ``top_entries`` (exposed for EXPLAIN checks)."""
    metric = metric_expr(board, metric_cap(board, partition))
    sub = _best_rows(board, board_filters(board, game_type_id, partition), metric)
    top = (
        select(sub)
        .where(sub.c.rn == 1)
        .order_by(*_board_order(board, sub))
        .limit(limit)
        .subquery("top_rows")
    )
    return select(top, display_name_of(top.c.session_id).label("player_name")).order_by(
        *_board_order(board, top)
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
            )
        )
    return entries


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
) -> _BestRow | None:
    sub = _best_rows(board, [*filters, Game.session_id == session_id], metric)
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


def _unrankable_reason(board: BoardDefinition, game: Game) -> str | None:
    """Why ``game`` can't appear on its board (mirrors ``board_filters``)."""
    value = _metric_value(board, game)
    if game.completed_at is None or value is None:
        return "Game has no final score."
    if game.outcome == GameOutcome.ABANDONED.value:
        return "Abandoned games are not ranked."
    if board.qualifying_outcomes is not None and game.outcome not in board.qualifying_outcomes:
        return "This game's outcome is not ranked."
    partition = row_partition(board, game.game_metadata or {})
    if any(v is not None and not board.is_allowed(k, v) for k, v in partition.items()):
        # e.g. a Star Swarm tier the backend doesn't know yet: stored, so the
        # run isn't lost, but there is no board to rank it on.
        return "This game's board does not exist."
    cap = metric_cap(board, partition)
    if not _is_count(value) or value > cap:
        return f"{board.metric} must be an integer from 0 to {cap} to be ranked."
    return None


async def set_player_name(
    db: AsyncSession, *, game: Game, session_id: str, player_name: str
) -> NameResult:
    """``PATCH /games/{id}/name``: set the player's display name, return their standing.

    Kept for installed builds (#2624): the name is the player's, not the
    game's, so this is ``PUT /players/me`` plus a rank. ``game`` must be
    loaded with its ``game_type`` and owned by ``session_id`` (the router
    checks both), and must be able to rank (else 400, as before). Returns the
    rank of the player's best entry in the game's partition, and whether
    ``game`` is that best entry.

    The name is also written to ``metadata.player_name`` on ``game``: the
    legacy per-game ``GET /<game>/scores`` routes still read it from session
    rows until #2644 removes them. The generic boards never read it.
    """
    game_type = game.game_type.name
    board = enabled_board(game_type)
    if board is None:
        raise LeaderboardError(404, f"{game_type} has no leaderboard.")
    reason = _unrankable_reason(board, game)
    if reason is not None:
        raise LeaderboardError(400, reason)

    # Reassign (never mutate in place): the JSONB column isn't a MutableDict.
    metadata = {**(game.game_metadata or {}), "player_name": player_name}
    game.game_metadata = metadata
    try:
        await players_service.set_display_name(db, session_id, player_name)
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        _log_db_error("player name commit", game_type, exc)
        raise LeaderboardError(500, "Failed to save player name.") from exc

    partition = row_partition(board, metadata)
    filters = board_filters(board, game.game_type_id, partition)
    metric = metric_expr(board, metric_cap(board, partition))
    try:
        best = await _session_best(db, board, filters, metric, session_id)
    except SQLAlchemyError as exc:
        _log_db_error("player best query", game_type, exc)
        raise LeaderboardError(500, "Failed to calculate rank.") from exc
    if best is None:  # pragma: no cover - the row just named is eligible
        raise LeaderboardError(500, "Failed to calculate rank.")

    tiebreak_arg = None
    if board.tiebreak is not None:
        tb = tiebreak_expr(board)
        assert tb is not None
        tiebreak_arg = (tb, board.tiebreak[1], best.tiebreak)
    rank = await compute_rank(
        db,
        metric=metric,
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
    """A non-negative integer (never a bool)."""
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def board_limit_violation(
    game_type: str,
    board: BoardDefinition | None,
    final_score: int | None,
    metadata: Mapping[str, Any],
) -> LimitViolation | None:
    """Why a completion breaks the board's limits, or ``None`` if it doesn't.

    ``metadata`` is the row's metadata as it will be stored (the validated
    result merged under the creation-time keys). A metric above the row's
    effective cap (``board.max_value_for`` its partition, e.g. 100 for an
    easy Sudoku; ``MAX_BOARD_VALUE`` when uncapped) is rejected (absorbs
    #2215). A metadata metric or tie-break must be an integer in
    ``[0, MAX_BOARD_VALUE]``.

    A negative ``final_score`` is *not* rejected: a 400 here dead-letters the
    game in the app's sync worker and its stats are lost. The board and rank
    queries ignore such rows instead.
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
    cap = metric_cap(board, metadata)
    if value is not None and value > cap:
        return LimitViolation(
            game_type, metric, f"{metric} {value} is above the maximum {cap} for {game_type}."
        )
    if board.tiebreak is not None:
        key = board.tiebreak[0]
        tb_value = metadata.get(key)
        if tb_value is not None and not (_is_count(tb_value) and tb_value <= MAX_BOARD_VALUE):
            return LimitViolation(
                game_type, key, f"{key} must be an integer from 0 to {MAX_BOARD_VALUE}."
            )
    return None


def merge_result_metadata(
    metadata: Mapping[str, Any] | None, result: Mapping[str, Any]
) -> dict[str, Any]:
    """The row's ``games.metadata`` once a validated *result* is merged in.

    Creation-time keys win: leaderboards read ``player_name``, ``difficulty``
    and the like from here, and a result must never rewrite them. A creation
    key holding ``null`` has no value to protect, so it doesn't win: it reads
    exactly like a missing key everywhere else (``row_partition``, the board
    filters), and letting it win would drop a real value the result carries,
    e.g. a Star Swarm run created with ``difficulty_tier: null`` would lose
    the tier its completion reports and fall off every board.
    """
    merged = dict(metadata or {})
    for key, value in result.items():
        if merged.get(key) is None:
            merged[key] = value
    return merged


def check_completion_limits(
    game_type: str,
    mod: GameModule | None,
    game: Game,
    final_score: int | None,
    result: Mapping[str, Any],
) -> LimitViolation | None:
    """``board_limit_violation`` for a game about to be completed.

    ``game_type`` and ``mod`` are the ones ``complete_game`` already resolved.
    """
    merged = merge_result_metadata(game.game_metadata, result)
    return board_limit_violation(game_type, _module_board(mod), final_score, merged)

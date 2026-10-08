"""SQL building blocks of the boards (#2618; split out of ``games/leaderboard.py`` in #2992).

The expressions every board query shares: the ranked value, the tie-break,
the row filters, the per-session best-row window and the board order.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import (
    BigInteger,
    ColumnElement,
    Subquery,
    and_,
    case,
    cast,
    func,
    literal,
    or_,
    select,
)
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.expression import FunctionElement

from db.models import PLAYER_DISPLAY_NAME_MAX_LENGTH, Game
from games.board import (
    COLUMN_METRICS,
    DURATION_METRIC,
    FINAL_TIEBREAK,
    MAX_BOARD_VALUE,
    SCORE_METRIC,
    BoardDefinition,
    Direction,
)
from games.boards.partitions import metric_cap
from games.filters import not_abandoned
from players.names import has_display_name

SENTINEL_SESSION_SUFFIX = "-anon"
"""Sessions like ``solitaire-anon``, written by the removed legacy ``POST /<game>/score``."""

MAX_NAME_LENGTH = PLAYER_DISPLAY_NAME_MAX_LENGTH
"""Longest name a board shows. Every write path enforces it; names are also
cut on read, so a longer stored name can never widen a board."""

# A missing tie-break value sorts after every real one, whatever the direction.
_WORST_TIEBREAK = {"asc": MAX_BOARD_VALUE + 1, "desc": -1}


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
    """The ranked value: the ``final_score`` or ``duration_ms`` column, or a
    metadata integer.

    A metadata metric outside ``[0, cap]`` or not an integer reads as NULL.
    A column metric is returned bare (so ``games_game_type_score_idx`` still
    applies to ``final_score``); ``board_filters`` bounds it.
    """
    if board.metric == SCORE_METRIC:
        return Game.final_score
    if board.metric == DURATION_METRIC:
        return Game.duration_ms
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
    if board.metric in COLUMN_METRICS:
        filters += [metric >= board.min_value, metric <= cap]
    elif board.min_value > 0:
        filters.append(metric >= board.min_value)
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


def best_rows(
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
    order += [_ordered(Game.completed_at, FINAL_TIEBREAK[1]), Game.id.asc()]
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


def board_order(board: BoardDefinition, sub: Subquery) -> list[ColumnElement]:
    """The board's order over a ``best_rows`` subquery (or one selected from it)."""
    order = [_ordered(sub.c.value, board.direction)]
    if board.tiebreak is not None:
        order.append(_ordered(sub.c.tiebreak, board.tiebreak[1]))
    order += [_ordered(sub.c.completed_at, FINAL_TIEBREAK[1]), sub.c.game_id.asc()]
    return order

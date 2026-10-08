"""SQL column helpers for ``/stats/me`` (#2620): the comparable per-game aggregates.

Split out of ``games.stats`` to keep it under the file-length cap. Builds the
conditional aggregates (won/lost/tied, time played, best-value candidate) added
to the one stats query, and turns an aggregate row into the comparable
``GameTypeStats`` fields. The metadata metric is read through
``db.jsonx.json_number``, which compiles per dialect.
"""

from __future__ import annotations

import functools
from typing import Any

from sqlalchemy import ColumnElement, and_, case, func, or_

from db.jsonx import json_number
from db.models import Game, GameType
from games.board import DURATION_METRIC, SCORE_METRIC, BoardDefinition
from games.filters import not_abandoned
from games.protocol import GameModule
from games.registry import get_module
from vocab import GameOutcome
from vocab import GameType as VocabGameType

# --- comparable per-game stats (#2620) -------------------------------------

# Upper bound on what one row may add to time_played_ms: a sanity bound on the
# reported duration_ms, not an estimate of play time.
MAX_TIME_PLAYED_PER_GAME_MS = 24 * 60 * 60 * 1000

# Only these three outcomes count. The legacy ``blackjack`` outcome is not a
# win here: #2619 (migration 0024_drop_blackjack_outcome) rewrites any stored
# ``blackjack`` row to ``win`` and drops the value from the CHECK constraint.
_WIN = GameOutcome.WIN.value
_LOSS = GameOutcome.LOSS.value
_PUSH = GameOutcome.PUSH.value


def _registered_module(name: str) -> GameModule:
    """The ``GameModule`` for game type *name*.

    Every vocab ``GameType`` has one since #2623 (a test checks it). A game
    without one is a bug, so this fails loudly instead of guessing a board for
    it. Only code-defined types reach it; a ``game_types`` row with no module
    is left out of the stats instead (``get_stats_for_session``).
    """
    module = get_module(name)
    if module is None:
        raise LookupError(f"No GameModule registered for game type {name!r}")
    return module


def _rankable_duration(board: BoardDefinition) -> ColumnElement[bool]:
    """A ``duration_ms`` row that could be on one of the board's boards (#2747).

    At or above ``min_value``, and in a partition that has a board: a value
    from ``partition_values``, or a missing one where the key has a default.
    Mahjong's best is then its fastest clear on a known layout, as the boards
    rank it; a row with no layout (before #2627) is not a best.
    """
    conditions: list[ColumnElement[bool]] = [Game.duration_ms >= board.min_value]
    for key in board.partitions:
        col = Game.game_metadata[key].as_string()
        allowed = board.allowed_values(key)
        has_default = board.partition_default(key) is not None
        if allowed is not None:
            ok = col.in_(allowed)
            conditions.append(or_(ok, col.is_(None)) if has_default else ok)
        elif not has_default:
            conditions.append(col.is_not(None))
    return and_(*conditions)


@functools.cache
def _best_candidate() -> ColumnElement:
    """Each row's board metric when the row can be its game's best, else NULL.

    A row qualifies when it is not abandoned and, if its board sets
    ``qualifying_outcomes``, its outcome is one of them (Daily Word: wins
    only). The value is ``final_score``, ``duration_ms`` (Mahjong's clear
    time, #2747; only from the board's ``min_value`` up, as on the board) or
    the metadata key the board names.

    Boards are static, so the expression is built once and reused by every
    request; its JSON reads compile per dialect (``db.jsonx``).
    """
    whens = []
    for game_type in VocabGameType:
        board = _registered_module(game_type.value).board
        if board.metric == SCORE_METRIC and board.qualifying_outcomes is None:
            continue  # the ELSE branch below
        value: ColumnElement
        if board.metric == SCORE_METRIC:
            value = Game.final_score
        elif board.metric == DURATION_METRIC:
            value = case((_rankable_duration(board), Game.duration_ms))
        else:
            value = json_number(Game.game_metadata, board.metric)
        if board.qualifying_outcomes is not None:
            value = case((Game.outcome.in_(board.qualifying_outcomes), value))
        whens.append((GameType.name == game_type.value, value))
    per_game = case(*whens, else_=Game.final_score) if whens else Game.final_score
    return case((not_abandoned(), per_game))


# Each row's reported play time: duration_ms when it is > 0, capped at 24 h.
# Rows with a null, 0 or negative duration_ms add nothing (SUM skips NULL).
# There is deliberately no completed_at − started_at fallback: wall-clock time
# counts idle and backgrounded hours, and rows swept to abandoned (#2621) would
# add up to a day each.
_REPORTED_TIME_MS = case(
    (Game.duration_ms > MAX_TIME_PLAYED_PER_GAME_MS, MAX_TIME_PLAYED_PER_GAME_MS),
    (Game.duration_ms > 0, Game.duration_ms),
)


def _comparable_columns() -> list[ColumnElement]:
    """Conditional aggregates for the comparable fields, added to the stats query."""
    candidate = _best_candidate()
    return [
        func.count(case((Game.outcome == _WIN, Game.id))).label("won"),
        func.count(case((Game.outcome == _LOSS, Game.id))).label("lost"),
        func.count(case((Game.outcome == _PUSH, Game.id))).label("tied"),
        func.sum(_REPORTED_TIME_MS).label("time_played_ms"),
        func.max(candidate).label("metric_max"),
        func.min(candidate).label("metric_min"),
    ]


def _as_number(value: Any) -> int | float | None:
    """DB numerics (Decimal, float) to int when integral, else float."""
    if value is None:
        return None
    number = float(value)
    return int(number) if number.is_integer() else number


def _comparable_fields(
    row: Any, board: BoardDefinition, streak: tuple[int, int] | None
) -> dict[str, Any]:
    """The comparable GameTypeStats fields for one aggregate row."""
    has_result = (row.won + row.lost + row.tied) > 0
    current, best = streak or (0, 0)
    best_value = row.metric_max if board.direction == "desc" else row.metric_min
    return {
        "sessions": row.played,
        "won": row.won if has_result else None,
        "lost": row.lost if has_result else None,
        "tied": row.tied if has_result else None,
        "current_win_streak": current if has_result else None,
        "best_win_streak": best if has_result else None,
        "time_played_ms": round(float(row.time_played_ms or 0)),
        "best_value": _as_number(best_value),
        "best_label_key": board.label_key,
    }

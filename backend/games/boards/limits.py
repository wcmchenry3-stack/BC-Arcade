"""Submission limits for ``PATCH /games/{id}/complete`` (#2618; split out in #2992).

The only part of the boards package ``games/sessions.py`` uses.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from db.models import Game
from games.board import DURATION_METRIC, MAX_BOARD_VALUE, SCORE_METRIC, BoardDefinition
from games.boards.partitions import metric_cap
from games.boards.types import LimitViolation
from games.protocol import GameModule


def is_count(value: Any) -> bool:
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
    queries ignore such rows instead. Likewise a metric below the board's
    ``min_value`` (an implausibly fast Mahjong clear, #2747) is stored and
    ignored, never rejected.

    A ``duration_ms`` metric is not checked here: it is a validated column of
    the completion body (non-negative), not part of the result, and the board
    bounds it on read.
    """
    if board is None:
        return None
    metric = board.metric
    if metric == DURATION_METRIC:
        value: Any = None
    elif metric == SCORE_METRIC:
        value = final_score
    else:
        value = metadata.get(metric)
        if value is not None and not is_count(value):
            return LimitViolation(game_type, metric, f"{metric} must be a non-negative integer.")
    cap = metric_cap(board, metadata)
    if value is not None and value > cap:
        return LimitViolation(
            game_type, metric, f"{metric} {value} is above the maximum {cap} for {game_type}."
        )
    if board.tiebreak is not None:
        key = board.tiebreak[0]
        tb_value = metadata.get(key)
        if tb_value is not None and not (is_count(tb_value) and tb_value <= MAX_BOARD_VALUE):
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
    return board_limit_violation(game_type, mod.board if mod else None, final_score, merged)

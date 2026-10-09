"""Board lookup and partitions (#2618; split out of ``games/leaderboard.py`` in #2992)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from games.board import MAX_BOARD_VALUE, BoardDefinition
from games.boards.types import LeaderboardError
from games.registry import get_module

MAX_PARTITION_VALUE_LENGTH = 64


def enabled_board(game_type: str) -> BoardDefinition | None:
    """The game's board, or ``None`` if the game is unknown or has no leaderboard."""
    mod = get_module(game_type)
    board = mod.board if mod is not None else None
    if board is None or not board.enabled:
        return None
    return board


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

"""Sudoku GameModule descriptor (#614).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from games.board import SCORE_METRIC, BoardDefinition
from sudoku.models import SudokuMetadata, SudokuResult
from vocab import GameType


class SudokuModule:
    """GameModule implementation for Sudoku.

    Uses the default pass-through stats shape: raw aggregate fields are
    forwarded as-is; ``latest_score`` is stripped (not exposed in API).
    """

    game_type = GameType.SUDOKU
    metadata_model = SudokuMetadata
    result_model = SudokuResult
    # One board per (difficulty, variant). A game scores its difficulty's base
    # (DIFFICULTY_BASE in SudokuScreen.tsx: 100/200/300) minus 10 per error, so
    # each difficulty has its own cap and 300 is the overall one (recomputed in
    # tests/test_board_definitions.py). Rows from before #748 carry no
    # ``variant`` and belong to ``classic``, as in sudoku/router.py _top_scores.
    # qualifying_outcomes stays None: every Sudoku row's outcome is
    # ``completed`` (a solved puzzle) or ``abandoned`` (never counts).
    board = BoardDefinition(
        metric=SCORE_METRIC,
        direction="desc",
        label_key="score",
        partitions=("difficulty", "variant"),
        partition_defaults=(("variant", "classic"),),
        max_value=300,
        partition_max_values=(
            ("difficulty", "easy", 100),
            ("difficulty", "medium", 200),
            ("difficulty", "hard", 300),
        ),
    )

    def stats_shape(self, raw_stats: dict) -> dict:
        return {k: v for k, v in raw_stats.items() if k != "latest_score"}


module = SudokuModule()

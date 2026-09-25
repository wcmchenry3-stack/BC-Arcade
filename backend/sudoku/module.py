"""Sudoku GameModule descriptor (#614).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

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
    has_winner = False

    def stats_shape(self, raw_stats: dict) -> dict:
        return {k: v for k, v in raw_stats.items() if k != "latest_score"}


module = SudokuModule()

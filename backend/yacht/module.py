"""Yacht GameModule descriptor.

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from games.board import SCORE_METRIC, BoardDefinition
from vocab import GameType
from yacht.models import YachtMetadata


class YachtModule:
    """GameModule implementation for Yacht."""

    game_type = GameType.YACHT
    metadata_model = YachtMetadata
    result_model = None
    # Solo and vs-computer games share one board (#2519 decision 2).
    board = BoardDefinition(metric=SCORE_METRIC, direction="desc", label_key="score", max_value=400)

    def stats_shape(self, raw_stats: dict) -> dict:
        return {k: v for k, v in raw_stats.items() if k != "latest_score"}


module = YachtModule()

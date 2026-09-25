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
    # 1575: every roll a Yacht of the right face — 13 categories at their best
    # plus the upper bonus, and 12 extra Yachts at the Yacht bonus each
    # (recomputed from engine.ts in test_board_definitions.py). The legacy
    # POST /yacht/score cap of 400 applied to its `400 - raw` transform, not to
    # a real game's total.
    board = BoardDefinition(
        metric=SCORE_METRIC, direction="desc", label_key="score", max_value=1575
    )

    def stats_shape(self, raw_stats: dict) -> dict:
        return {k: v for k, v in raw_stats.items() if k != "latest_score"}


module = YachtModule()

"""Cascade GameModule descriptor (#540).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from cascade.models import CascadeMetadata
from games.board import SCORE_METRIC, BoardDefinition
from games.protocol import default_stats_shape
from vocab import GameType


class CascadeModule:
    """GameModule implementation for Cascade.

    Uses the default pass-through stats shape: raw aggregate fields are
    forwarded as-is; ``latest_score`` is stripped (not exposed in API).
    """

    game_type = GameType.CASCADE
    metadata_model = CascadeMetadata
    result_model = None
    has_winner = False
    # No natural ceiling (#2519 decision 14). Every non-abandoned game counts.
    board = BoardDefinition(metric=SCORE_METRIC, direction="desc", label_key="score")

    def stats_shape(self, raw_stats: dict) -> dict:
        return default_stats_shape(raw_stats)


module = CascadeModule()

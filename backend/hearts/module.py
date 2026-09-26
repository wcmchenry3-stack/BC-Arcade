"""Hearts GameModule descriptor (#603).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from games.board import SCORE_METRIC, BoardDefinition
from games.protocol import default_stats_shape
from hearts.models import HeartsMetadata
from vocab import GameType


class HeartsModule:
    """GameModule implementation for Hearts."""

    game_type = GameType.HEARTS
    metadata_model = HeartsMetadata
    result_model = None
    has_winner = True
    # ``final_score`` is 100 - penalty points. qualifying_outcomes stays None:
    # a lost or drawn hand still has a real score, so win/loss/push all count.
    board = BoardDefinition(metric=SCORE_METRIC, direction="desc", label_key="score", max_value=100)

    def stats_shape(self, raw_stats: dict) -> dict:
        return default_stats_shape(raw_stats)


module = HeartsModule()

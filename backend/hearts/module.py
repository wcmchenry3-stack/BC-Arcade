"""Hearts GameModule descriptor (#603).

A ``GameModuleBase`` subclass (``games/module_base.py``).
"""

from __future__ import annotations

from games.board import SCORE_METRIC, BoardDefinition
from games.module_base import GameModuleBase
from hearts.models import HeartsMetadata, HeartsResult
from vocab import GameType


class HeartsModule(GameModuleBase):
    """GameModule implementation for Hearts."""

    game_type = GameType.HEARTS
    metadata_model = HeartsMetadata
    result_model = HeartsResult
    has_winner = True
    # ``final_score`` is 100 - penalty points. qualifying_outcomes stays None:
    # a lost or drawn hand still has a real score, so win/loss/push all count.
    board = BoardDefinition(metric=SCORE_METRIC, direction="desc", label_key="score", max_value=100)


module = HeartsModule()

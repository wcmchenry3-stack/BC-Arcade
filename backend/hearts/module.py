"""Hearts GameModule descriptor (#603).

A ``GameModuleBase`` subclass (``games/module_base.py``).
"""

from __future__ import annotations

from typing import Any

from games.board import SCORE_METRIC, BoardDefinition
from games.module_base import GameModuleBase
from hearts.events import EVENT_TYPES, validate_hearts_event
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

    def validate_event(self, name: str, data: dict[str, Any]) -> dict[str, Any] | None:
        """The replay events (``hearts.events.EVENT_TYPES``, #3283) are checked against
        their v1 schemas; the lifecycle events pass through."""
        if name in EVENT_TYPES:
            return validate_hearts_event(name, data)
        return data


module = HeartsModule()

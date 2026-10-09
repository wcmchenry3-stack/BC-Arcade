"""Cascade GameModule descriptor (#540).

A ``GameModuleBase`` subclass (``games/module_base.py``).
"""

from __future__ import annotations

from cascade.models import CascadeMetadata
from games.board import SCORE_METRIC, BoardDefinition
from games.module_base import GameModuleBase
from vocab import GameType


class CascadeModule(GameModuleBase):
    """GameModule implementation for Cascade."""

    game_type = GameType.CASCADE
    metadata_model = CascadeMetadata
    result_model = None
    has_winner = False
    # No natural ceiling (#2519 decision 14). Every non-abandoned game counts.
    board = BoardDefinition(metric=SCORE_METRIC, direction="desc", label_key="score")


module = CascadeModule()

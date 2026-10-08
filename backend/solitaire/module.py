"""Solitaire GameModule descriptor (#592).

A ``GameModuleBase`` subclass (``games/module_base.py``).
"""

from __future__ import annotations

from games.board import SCORE_METRIC, BoardDefinition
from games.module_base import GameModuleBase
from solitaire.models import SolitaireMetadata, SolitaireResult
from vocab import GameType


class SolitaireModule(GameModuleBase):
    """GameModule implementation for Solitaire."""

    game_type = GameType.SOLITAIRE
    metadata_model = SolitaireMetadata
    result_model = SolitaireResult
    has_winner = False
    # Draw-1 and Draw-3 share one board (#591). The 1245 cap is recomputed from
    # the engine's scoring constants in tests/test_board_definitions.py.
    # qualifying_outcomes stays None: only a won game is recorded ``completed``.
    board = BoardDefinition(
        metric=SCORE_METRIC, direction="desc", label_key="score", max_value=1245
    )


module = SolitaireModule()

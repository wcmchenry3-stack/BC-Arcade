"""FreeCell GameModule descriptor (#2452).

A ``GameModuleBase`` subclass (``games/module_base.py``).

Registering FreeCell lets the app record a per-session ``games`` row
(``POST /games`` + ``PATCH /games/{id}/complete``) like every other game, so a
player's FreeCell plays earn Arcade XP, show in Profile history and can be
measured by the daily challenge. Its wins rank on the generic board (#2632).
"""

from __future__ import annotations

from typing import Any

from freecell.models import MOVES, FreeCellMetadata, FreeCellResult, validate_moves
from games.board import SCORE_METRIC, BoardDefinition
from games.module_base import GameModuleBase
from vocab import GameType


class FreeCellModule(GameModuleBase):
    """GameModule implementation for FreeCell."""

    game_type = GameType.FREECELL
    metadata_model = FreeCellMetadata
    result_model = FreeCellResult
    has_winner = False
    # Fewest moves wins. qualifying_outcomes stays None: every non-abandoned
    # FreeCell completion is a won game (a game given up is abandoned, with no
    # score). Since #2632 the app's win sends ``final_score = moveCount``.
    board = BoardDefinition(metric=SCORE_METRIC, direction="asc", label_key="moves")

    def validate_event(self, name: str, data: dict[str, Any]) -> dict[str, Any] | None:
        """``moves`` is checked against the v1 schema (#3289); every other
        event passes through."""
        if name == MOVES:
            return validate_moves(data)
        return data


module = FreeCellModule()

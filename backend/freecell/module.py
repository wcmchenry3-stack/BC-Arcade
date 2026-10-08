"""FreeCell GameModule descriptor (#2452).

A ``GameModuleBase`` subclass (``games/module_base.py``).

Registering FreeCell lets the app record a per-session ``games`` row
(``POST /games`` + ``PATCH /games/{id}/complete``) like every other game, so a
player's FreeCell plays earn Arcade XP, show in Profile history and can be
measured by the daily challenge. Its wins rank on the generic board (#2632).
"""

from __future__ import annotations

from freecell.models import FreeCellMetadata, FreeCellResult
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


module = FreeCellModule()

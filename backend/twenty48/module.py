"""Twenty48 GameModule descriptor (#2623).

A ``GameModuleBase`` subclass (``games/module_base.py``).
"""

from __future__ import annotations

from games.board import SCORE_METRIC, BoardDefinition
from games.module_base import GameModuleBase
from twenty48.models import Twenty48Metadata, Twenty48Result
from vocab import GameType


class Twenty48Module(GameModuleBase):
    """GameModule implementation for Twenty48."""

    game_type = GameType.TWENTY48
    metadata_model = Twenty48Metadata
    result_model = Twenty48Result
    # One global board by score (#2519 decision 1); no natural ceiling (decision 14).
    board = BoardDefinition(metric=SCORE_METRIC, direction="desc", label_key="score")
    # Reaching 2048 records ``win`` and a game over before it records ``loss``
    # (#2631). Older builds send ``completed`` / ``kept_playing``: the session
    # in which 2048 was first reached is stored as ``win`` (#2703,
    # games.legacy_outcomes); every other one stays as sent, a finish with no
    # winner.
    has_winner = True


module = Twenty48Module()

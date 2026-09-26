"""Twenty48 GameModule descriptor (#2623).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from games.board import SCORE_METRIC, BoardDefinition
from games.protocol import default_stats_shape
from twenty48.models import Twenty48Metadata, Twenty48Result
from vocab import GameType


class Twenty48Module:
    """GameModule implementation for Twenty48.

    Uses the default pass-through stats shape: raw aggregate fields are
    forwarded as-is; ``latest_score`` is stripped (not exposed in API).
    """

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

    def stats_shape(self, raw_stats: dict) -> dict:
        return default_stats_shape(raw_stats)


module = Twenty48Module()

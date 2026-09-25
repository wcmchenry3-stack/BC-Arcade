"""Twenty48 GameModule descriptor (#2623).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from games.board import SCORE_METRIC, BoardDefinition
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
    # True only once the client records win/loss. Today the app sends
    # ``completed`` / ``kept_playing`` / ``abandoned``; #2631 flips this when
    # reaching 2048 records ``win`` and a game over before it records ``loss``.
    has_winner = False

    def stats_shape(self, raw_stats: dict) -> dict:
        return {k: v for k, v in raw_stats.items() if k != "latest_score"}


module = Twenty48Module()

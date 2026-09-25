"""Star Swarm GameModule descriptor (#2623).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from games.board import SCORE_METRIC, BoardDefinition
from starswarm.models import StarSwarmMetadata, StarSwarmResult
from vocab import GameType


class StarSwarmModule:
    """GameModule implementation for Star Swarm.

    Uses the default pass-through stats shape: raw aggregate fields are
    forwarded as-is; ``latest_score`` is stripped (not exposed in API).
    """

    game_type = GameType.STARSWARM
    metadata_model = StarSwarmMetadata
    result_model = StarSwarmResult
    # One board per difficulty tier; no natural ceiling (#2519 decision 14).
    board = BoardDefinition(
        metric=SCORE_METRIC,
        direction="desc",
        label_key="score",
        partitions=["difficulty_tier"],
    )
    # A run ends when the ship is lost: there is no win.
    has_winner = False

    def stats_shape(self, raw_stats: dict) -> dict:
        return {k: v for k, v in raw_stats.items() if k != "latest_score"}


module = StarSwarmModule()

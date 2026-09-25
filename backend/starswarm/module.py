"""Star Swarm GameModule descriptor (#2623).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from games.board import SCORE_METRIC, BoardDefinition
from games.protocol import default_stats_shape
from starswarm.models import (
    DEFAULT_DIFFICULTY_TIER,
    DIFFICULTY_TIERS,
    StarSwarmMetadata,
    StarSwarmResult,
)
from vocab import GameType


class StarSwarmModule:
    """GameModule implementation for Star Swarm.

    Uses the default pass-through stats shape: raw aggregate fields are
    forwarded as-is; ``latest_score`` is stripped (not exposed in API).
    """

    game_type = GameType.STARSWARM
    metadata_model = StarSwarmMetadata
    result_model = StarSwarmResult
    # One board per difficulty tier (plan §4.2); no natural ceiling (#2519 decision 14).
    # Only the app's tiers have a board, and a row with no tier counts as
    # LieutenantJG, as on the legacy GET /starswarm/leaderboard.
    board = BoardDefinition(
        metric=SCORE_METRIC,
        direction="desc",
        label_key="score",
        partitions=("difficulty_tier",),
        partition_defaults=(("difficulty_tier", DEFAULT_DIFFICULTY_TIER),),
        partition_values=(("difficulty_tier", DIFFICULTY_TIERS),),
    )
    # A run ends when the ship is lost: there is no win.
    has_winner = False

    def stats_shape(self, raw_stats: dict) -> dict:
        return default_stats_shape(raw_stats)


module = StarSwarmModule()

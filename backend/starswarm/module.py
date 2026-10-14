"""Star Swarm GameModule descriptor (#2623).

A ``GameModuleBase`` subclass (``games/module_base.py``).
"""

from __future__ import annotations

from typing import Any

from games.board import SCORE_METRIC, BoardDefinition
from games.module_base import GameModuleBase
from starswarm.models import (
    DEFAULT_DIFFICULTY_TIER,
    DIFFICULTY_TIERS,
    WAVE_COMPLETED,
    StarSwarmMetadata,
    StarSwarmResult,
    validate_wave_completed,
)
from vocab import GameType


class StarSwarmModule(GameModuleBase):
    """GameModule implementation for Star Swarm."""

    game_type = GameType.STARSWARM
    metadata_model = StarSwarmMetadata
    result_model = StarSwarmResult
    # One board per difficulty tier (plan §4.2); no natural ceiling (#2519 decision 14).
    # Only the app's tiers have a board, and a row with no tier counts as
    # LieutenantJG (``DEFAULT_DIFFICULTY_TIER``).
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

    def validate_event(self, name: str, data: dict[str, Any]) -> dict[str, Any] | None:
        """``wave_completed`` is checked against the v1 schema (#3250); the
        lifecycle events pass through."""
        if name == WAVE_COMPLETED:
            return validate_wave_completed(data)
        return data


module = StarSwarmModule()

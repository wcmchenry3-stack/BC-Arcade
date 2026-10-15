"""Yacht GameModule descriptor.

A ``GameModuleBase`` subclass (``games/module_base.py``).

``has_winner`` is true because vs-the-computer games record ``win`` /
``loss`` / ``push``. Solo games have no opponent and record ``completed``,
which the stats layer reads per row as "no winner" — a ``completed`` Yacht
row is not a win. See ``vocab.GameOutcome``.
"""

from __future__ import annotations

from typing import Any

from games.board import SCORE_METRIC, BoardDefinition
from games.module_base import GameModuleBase
from vocab import GameType
from yacht.models import YachtMetadata, YachtResult
from yacht.turn_event import TURN_COMPLETED, validate_turn


class YachtModule(GameModuleBase):
    """GameModule implementation for Yacht."""

    game_type = GameType.YACHT
    metadata_model = YachtMetadata
    result_model = YachtResult
    has_winner = True
    # Solo and vs-computer games share one board (#2519 decision 2); the
    # metadata records ``mode`` and ``difficulty`` without partitioning.
    # 1575: every roll a Yacht of the right face — 13 categories at their best
    # plus the upper bonus, and 12 extra Yachts at the Yacht bonus each
    # (recomputed from engine.ts in test_board_definitions.py).
    # qualifying_outcomes stays None: a solo game is ``completed`` and a game
    # lost to the computer still has a real total, so every outcome counts.
    board = BoardDefinition(
        metric=SCORE_METRIC, direction="desc", label_key="score", max_value=1575
    )

    def validate_event(self, name: str, data: dict[str, Any]) -> dict[str, Any] | None:
        """``turn_completed`` is checked against the v1 schema (#3282); every other
        event passes through, including the ``roll`` / ``score`` events older builds send."""
        if name == TURN_COMPLETED:
            return validate_turn(data)
        return data


module = YachtModule()

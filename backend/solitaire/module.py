"""Solitaire GameModule descriptor (#592).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from games.board import SCORE_METRIC, BoardDefinition
from games.protocol import default_stats_shape
from solitaire.models import SolitaireMetadata, SolitaireResult
from vocab import GameType


class SolitaireModule:
    """GameModule implementation for Solitaire.

    Uses the default pass-through stats shape: raw aggregate fields are
    forwarded as-is; ``latest_score`` is stripped (not exposed in API).
    """

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

    def stats_shape(self, raw_stats: dict) -> dict:
        return default_stats_shape(raw_stats)


module = SolitaireModule()

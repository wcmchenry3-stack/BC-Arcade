"""Mahjong Solitaire GameModule descriptor (#871).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from games.board import SCORE_METRIC, BoardDefinition
from games.protocol import default_stats_shape
from mahjong.models import MahjongMetadata, MahjongResult
from vocab import GameType


class MahjongModule:
    game_type = GameType.MAHJONG
    metadata_model = MahjongMetadata
    result_model = MahjongResult
    # A cleared board records ``win`` (#2627) and a deadlock the player leaves
    # records ``loss`` (#2592). Builds before #2627 send ``completed``; one with
    # ``won: true`` (a cleared board) is stored as ``win`` (#2703,
    # games.legacy_outcomes), the rest stay ``completed``: no winner.
    has_winner = True
    # 72 pairs x SCORE_PER_PAIR (10) + SCORE_COMPLETE_BONUS (500); every layout
    # is 144 tiles. Recomputed from the engine in tests/test_board_definitions.py.
    # qualifying_outcomes stays None: a deadlocked game is recorded as a loss
    # with no ``final_score``, so it can't rank on a ``final_score`` board anyway.
    board = BoardDefinition(
        metric=SCORE_METRIC, direction="desc", label_key="score", max_value=1220
    )

    def stats_shape(self, raw_stats: dict) -> dict:
        return default_stats_shape(raw_stats)


module = MahjongModule()

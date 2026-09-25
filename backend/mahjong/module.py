"""Mahjong Solitaire GameModule descriptor (#871).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from games.board import SCORE_METRIC, BoardDefinition
from mahjong.models import MahjongMetadata, MahjongResult
from vocab import GameType


class MahjongModule:
    game_type = GameType.MAHJONG
    metadata_model = MahjongMetadata
    result_model = MahjongResult
    # 72 pairs x SCORE_PER_PAIR (10) + SCORE_COMPLETE_BONUS (500); every layout
    # is 144 tiles. Recomputed from the engine in tests/test_board_definitions.py.
    board = BoardDefinition(
        metric=SCORE_METRIC, direction="desc", label_key="score", max_value=1220
    )

    def stats_shape(self, raw_stats: dict) -> dict:
        return {k: v for k, v in raw_stats.items() if k != "latest_score"}


module = MahjongModule()

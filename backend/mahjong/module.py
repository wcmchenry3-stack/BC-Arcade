"""Mahjong Solitaire GameModule descriptor (#871).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from mahjong.models import MahjongMetadata, MahjongResult
from vocab import GameType


class MahjongModule:
    game_type = GameType.MAHJONG
    metadata_model = MahjongMetadata
    result_model = MahjongResult
    # False until #2627: a cleared board still records ``completed``, so only
    # the deadlock ``loss`` is written today and a win rate would read 0 %.
    has_winner = False

    def stats_shape(self, raw_stats: dict) -> dict:
        return {k: v for k, v in raw_stats.items() if k != "latest_score"}


module = MahjongModule()

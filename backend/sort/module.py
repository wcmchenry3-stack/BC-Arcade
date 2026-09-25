from __future__ import annotations

from sort.models import SortMetadata
from vocab import GameType


class SortModule:
    game_type = GameType.SORT
    metadata_model = SortMetadata
    result_model = None
    has_winner = False

    def stats_shape(self, raw_stats: dict) -> dict:
        return {k: v for k, v in raw_stats.items() if k != "latest_score"}


module = SortModule()

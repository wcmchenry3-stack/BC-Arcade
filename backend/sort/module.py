from __future__ import annotations

from sort.models import SortMetadata
from vocab import GameType


class SortModule:
    game_type = GameType.SORT
    metadata_model = SortMetadata

    def stats_shape(self, raw_stats: dict) -> dict:
        return {k: v for k, v in raw_stats.items() if k != "latest_score"}


module = SortModule()

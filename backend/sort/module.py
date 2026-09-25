from __future__ import annotations

from games.board import BoardDefinition
from sort.models import SortMetadata
from vocab import GameType


class SortModule:
    game_type = GameType.SORT
    metadata_model = SortMetadata
    result_model = None
    # Highest level cleared; fewest total moves breaks a tie (levels are seeded,
    # so every player gets the same 23).
    board = BoardDefinition(
        metric="level_reached",
        direction="desc",
        tiebreak=("total_moves", "asc"),
        label_key="level",
        max_value=23,
    )

    def stats_shape(self, raw_stats: dict) -> dict:
        return {k: v for k, v in raw_stats.items() if k != "latest_score"}


module = SortModule()

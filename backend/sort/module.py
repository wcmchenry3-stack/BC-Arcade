from __future__ import annotations

from games.board import BoardDefinition
from games.protocol import default_stats_shape
from sort.models import SortMetadata, SortResult
from vocab import GameType


class SortModule:
    game_type = GameType.SORT
    metadata_model = SortMetadata
    result_model = SortResult
    has_winner = False
    # Highest level cleared; fewest total moves breaks a tie (levels are seeded,
    # so every player gets the same 23). qualifying_outcomes stays None: a
    # solved level is recorded ``completed``, the only non-abandoned outcome.
    # Legacy rows: POST /sort/score stored the level in ``final_score`` under
    # the ``sort-anon`` session. The generic board (#2657) excludes all
    # ``*-anon`` rows, so those values never meet this declaration.
    # The app sends both keys on the first solve of the player's frontier
    # level only (#2625, ``SortResult``); every other solve ranks nowhere.
    board = BoardDefinition(
        metric="level_reached",
        direction="desc",
        tiebreak=("total_moves", "asc"),
        label_key="level",
        max_value=23,
    )

    def stats_shape(self, raw_stats: dict) -> dict:
        return default_stats_shape(raw_stats)


module = SortModule()

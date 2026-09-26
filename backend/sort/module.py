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
    # Highest level cleared; fewest total moves breaks a tie. The levels are
    # not seeded: GET /sort/levels generates new random mixtures of the same
    # 23 level specs on every request (``build_levels(seed=None)``), so two
    # players' ``total_moves`` cover the same level numbers, not identical
    # puzzles (#2746). qualifying_outcomes stays None: a solved level is
    # recorded ``completed``, the only non-abandoned outcome.
    # Legacy rows: POST /sort/score stored the level in ``final_score`` under
    # the ``sort-anon`` session. The generic board (#2657) excludes all
    # ``*-anon`` rows, so those values never meet this declaration.
    # The app sends both keys on every solve, replays included (#2625,
    # ``SortResult``): the player's standing after it. The board keeps each
    # player's best row, so a replay that lowers a best improves their rank.
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

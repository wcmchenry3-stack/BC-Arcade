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
    # Highest level cleared; ties go to the earliest completion, the generic
    # FINAL_TIEBREAK (``completed_at asc``). There is no moves tie-break
    # (#2746): the levels are not seeded. GET /sort/levels generates new random
    # mixtures of the same 23 level specs on every request
    # (``build_levels(seed=None)``), so two players' moves on "level 19" are
    # moves on different puzzles. qualifying_outcomes stays None: a solved
    # level is recorded ``completed``, the only non-abandoned outcome.
    # The app sends ``level_reached`` (and ``total_moves``, kept as metadata)
    # on every solve, replays included (#2625, ``SortResult``): the player's
    # standing after it. The board keeps each player's best row, which is
    # their first solve of their highest level; a replay never displaces it.
    # The metric is metadata, not a column, so the board reads Sort's finished
    # rows through games_game_type_completed_idx (#2965). It deliberately does
    # not rank a final_score mirror of level_reached to ride the score index:
    # that would change which stored rows rank (docs/LEADERBOARDS.md
    # "Indexes" has the EXPLAIN comparison).
    board = BoardDefinition(
        metric="level_reached",
        direction="desc",
        label_key="level",
        max_value=23,
    )

    def stats_shape(self, raw_stats: dict) -> dict:
        return default_stats_shape(raw_stats)


module = SortModule()

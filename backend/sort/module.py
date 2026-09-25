from __future__ import annotations

from games.board import BoardDefinition
from sort.models import SortMetadata
from vocab import GameType


class SortModule:
    game_type = GameType.SORT
    metadata_model = SortMetadata
    result_model = None
    # Highest level cleared; fewest total moves breaks a tie (levels are seeded,
    # so every player gets the same 23). qualifying_outcomes stays None: a
    # solved level is recorded ``completed``, the only non-abandoned outcome.
    # Legacy rows: POST /sort/score stored the level in ``final_score`` under
    # the ``sort-anon`` session. The generic board (#2657) excludes all
    # ``*-anon`` rows, so those values never meet this declaration.
    # The client still sends ``level``/``moves`` rather than the declared
    # ``level_reached``/``total_moves``; the Phase 2 story (#2625) makes it send
    # the declared keys. The declaration stays as it is.
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

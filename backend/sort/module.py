"""Bottle Sort GameModule descriptor.

A ``GameModuleBase`` subclass (``games/module_base.py``). Sort ranks the
highest level a player has cleared (``level_reached``), a metadata metric.
"""

from __future__ import annotations

from typing import Any

from games.board import BoardDefinition
from games.module_base import GameModuleBase
from sort.catalog import CATALOG_VERSION, LEVEL_COUNT
from sort.models import SortMetadata, SortResult
from sort.replay import MOVES, validate_moves
from vocab import GameType


class SortModule(GameModuleBase):
    game_type = GameType.SORT
    metadata_model = SortMetadata
    result_model = SortResult
    has_winner = False
    # Highest level cleared, then the fewest total moves (the sum of the
    # player's best moves on levels 1 to it), then the earliest server
    # receipt (the generic FINAL_TIEBREAK). The moves tie-break was dropped
    # in #2746 while levels were random per request, and is back since every
    # player gets the same fixed catalog (#2761, ``sort.catalog``).
    # qualifying_outcomes stays None: a solved level is recorded
    # ``completed``, the only non-abandoned outcome.
    # The app sends ``level_reached``, ``total_moves`` and ``catalog_version``
    # on every solve, replays included (#2625, ``SortResult``): the player's
    # standing after it. The board keeps each player's best row; a replay
    # that lowers the total takes over from an earlier row at the same level.
    # ``edition`` resets the board for the catalog (#2761): only rows sent
    # with the current ``catalog_version`` rank. Rows from the random levels,
    # including those still sent by app builds from before the catalog, are
    # stored but never rank. No row is migrated or deleted. The reset waits
    # for SORT_CATALOG_EDITION_ENFORCED (default off; ``edition_switch``): the
    # backend deploys before the app builds that send ``catalog_version`` reach
    # players, so until the owner turns it on the board ranks every row as
    # before (games.boards.editions).
    # The metric is metadata, not a column, so the board reads Sort's finished
    # rows through games_game_type_completed_idx (#2965). It deliberately does
    # not rank a final_score mirror of level_reached to ride the score index:
    # that would change which stored rows rank (docs/LEADERBOARDS.md
    # "Indexes" has the EXPLAIN comparison).
    board = BoardDefinition(
        metric="level_reached",
        direction="desc",
        tiebreak=("total_moves", "asc"),
        label_key="level",
        max_value=LEVEL_COUNT,
        edition=("catalog_version", CATALOG_VERSION),
        edition_switch="sort_catalog_edition_enforced",
    )

    def validate_event(self, name: str, data: dict[str, Any]) -> dict[str, Any] | None:
        """``moves`` is checked against the v1 schema (#3387); every other
        event passes through (the lifecycle events)."""
        if name == MOVES:
            return validate_moves(data)
        return data


module = SortModule()

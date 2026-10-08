"""Mahjong Solitaire GameModule descriptor (#871).

A ``GameModuleBase`` subclass (``games/module_base.py``).
"""

from __future__ import annotations

from games.board import DURATION_METRIC, BoardDefinition
from games.module_base import GameModuleBase
from mahjong.models import LAYOUTS, MIN_CLEAR_MS, MahjongMetadata, MahjongResult
from vocab import GameType


class MahjongModule(GameModuleBase):
    game_type = GameType.MAHJONG
    metadata_model = MahjongMetadata
    result_model = MahjongResult
    # A cleared board records ``win`` (#2627) and a deadlock the player leaves
    # records ``loss`` (#2592). Builds before #2627 send ``completed``; one with
    # ``won: true`` (a cleared board) is stored as ``win`` (#2703,
    # games.legacy_outcomes), the rest stay ``completed``: no winner.
    has_winner = True
    # Fastest clear wins (#2747): the play time of a cleared board
    # (``games.duration_ms``, the app's pausable play clock), lower is better,
    # one board per layout. Only wins rank: a deadlock is a ``loss`` and a
    # legacy ``completed`` row was never cleared. A clear under MIN_CLEAR_MS
    # (or with no duration) is stored but never ranks. Rows from before #2627
    # carry no ``layout``; there is deliberately no ``partition_defaults``
    # entry for it, so they rank on no board rather than on Turtle's, which
    # they may never have been played on.
    board = BoardDefinition(
        metric=DURATION_METRIC,
        direction="asc",
        label_key="time",
        partitions=("layout",),
        partition_values=(("layout", LAYOUTS),),
        min_value=MIN_CLEAR_MS,
        qualifying_outcomes=("win",),
    )


module = MahjongModule()

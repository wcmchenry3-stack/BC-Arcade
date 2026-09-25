"""FreeCell GameModule descriptor (#2452).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.

Registering FreeCell lets the app record a per-session ``games`` row
(``POST /games`` + ``PATCH /games/{id}/complete``) like every other game, so a
player's FreeCell plays earn Arcade XP, show in Profile history and can be
measured by the daily challenge. Its wins rank on the generic board (#2632); the
legacy routes (``freecell/router.py``) stay for installed builds until #2644.
"""

from __future__ import annotations

from freecell.models import FreeCellMetadata, FreeCellResult
from games.board import SCORE_METRIC, BoardDefinition
from games.protocol import default_stats_shape
from vocab import GameType


class FreeCellModule:
    """GameModule implementation for FreeCell.

    Uses the default pass-through stats shape: raw aggregate fields are
    forwarded as-is; ``latest_score`` is stripped (not exposed in API).
    """

    game_type = GameType.FREECELL
    metadata_model = FreeCellMetadata
    result_model = FreeCellResult
    has_winner = False
    # Fewest moves wins. qualifying_outcomes stays None: every non-abandoned
    # FreeCell completion is a won game (a game given up is abandoned, with no
    # score). Since #2632 the app's win sends ``final_score = moveCount``; the
    # legacy POST /freecell/score rows (``freecell-anon``) never rank here.
    board = BoardDefinition(metric=SCORE_METRIC, direction="asc", label_key="moves")

    def stats_shape(self, raw_stats: dict) -> dict:
        return default_stats_shape(raw_stats)


module = FreeCellModule()

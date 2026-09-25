"""FreeCell GameModule descriptor (#2452).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.

Registering FreeCell lets the app record a per-session ``games`` row
(``POST /games`` + ``PATCH /games/{id}/complete``) like every other game, so a
player's FreeCell plays earn Arcade XP, show in Profile history and can be
measured by the daily challenge. The leaderboard routes (``freecell/router.py``)
are unchanged and keep writing their own rows.
"""

from __future__ import annotations

from freecell.models import FreeCellMetadata, FreeCellResult
from games.board import SCORE_METRIC, BoardDefinition
from vocab import GameType


class FreeCellModule:
    """GameModule implementation for FreeCell.

    Uses the default pass-through stats shape: raw aggregate fields are
    forwarded as-is; ``latest_score`` is stripped (not exposed in API).
    """

    game_type = GameType.FREECELL
    metadata_model = FreeCellMetadata
    result_model = FreeCellResult
    # Fewest moves wins. qualifying_outcomes stays None: every non-abandoned
    # FreeCell completion is a won game today (a game given up is abandoned).
    # Session rows (POST /games) don't set ``final_score`` yet, so today only
    # the legacy POST /freecell/score rows carry the metric; the Phase 2 story
    # (#2632) makes the client send it. The declaration stays as it is.
    board = BoardDefinition(metric=SCORE_METRIC, direction="asc", label_key="moves")

    def stats_shape(self, raw_stats: dict) -> dict:
        return {k: v for k, v in raw_stats.items() if k != "latest_score"}


module = FreeCellModule()

"""Solitaire GameModule descriptor (#592).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from solitaire.models import SolitaireMetadata, SolitaireResult
from vocab import GameType


class SolitaireModule:
    """GameModule implementation for Solitaire.

    Uses the default pass-through stats shape: raw aggregate fields are
    forwarded as-is; ``latest_score`` is stripped (not exposed in API).
    """

    game_type = GameType.SOLITAIRE
    metadata_model = SolitaireMetadata
    result_model = SolitaireResult
    has_winner = False

    def stats_shape(self, raw_stats: dict) -> dict:
        return {k: v for k, v in raw_stats.items() if k != "latest_score"}


module = SolitaireModule()

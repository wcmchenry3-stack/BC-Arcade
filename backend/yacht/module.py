"""Yacht GameModule descriptor.

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.

``has_winner`` is true because vs-the-computer games record ``win`` /
``loss`` / ``push``. Solo games have no opponent and record ``completed``,
which the stats layer reads per row as "no winner" — a ``completed`` Yacht
row is not a win. See ``vocab.GameOutcome``.
"""

from __future__ import annotations

from vocab import GameType
from yacht.models import YachtMetadata


class YachtModule:
    """GameModule implementation for Yacht."""

    game_type = GameType.YACHT
    metadata_model = YachtMetadata
    result_model = None
    has_winner = True

    def stats_shape(self, raw_stats: dict) -> dict:
        return {k: v for k, v in raw_stats.items() if k != "latest_score"}


module = YachtModule()

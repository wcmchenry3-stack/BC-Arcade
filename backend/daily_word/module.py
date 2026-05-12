"""Daily Word GameModule descriptor (#1187).

Satisfies the GameModule Protocol from games/protocol.py via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from daily_word.models import DailyWordMetadata
from vocab import GameType


class DailyWordModule:
    game_type = GameType.DAILY_WORD
    metadata_model = DailyWordMetadata

    def stats_shape(self, raw_stats: dict) -> dict:
        return {k: v for k, v in raw_stats.items() if k != "latest_score"}


module = DailyWordModule()

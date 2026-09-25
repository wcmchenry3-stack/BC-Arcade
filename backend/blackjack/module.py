"""Blackjack GameModule descriptor (#540).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from blackjack.models import BlackjackMetadata, BlackjackResult
from games.board import SCORE_METRIC, BoardDefinition
from vocab import GameType


class BlackjackModule:
    """GameModule implementation for Blackjack.

    Stats shape differences from the generic pattern:
    - ``best``  → renamed to ``best_chips``
    - ``avg``   → dropped (chip counts don't aggregate meaningfully)
    - ``current_chips`` ← ``latest_score`` (chips at end of last session)
    """

    game_type = GameType.BLACKJACK
    metadata_model = BlackjackMetadata
    result_model = BlackjackResult
    # No leaderboard: chips are a balance, not a score (#2519 §4.2).
    # qualifying_outcomes stays None: every non-abandoned session's closing
    # balance counts toward ``best_chips`` in stats, whatever its last hand was.
    board = BoardDefinition(metric=SCORE_METRIC, direction="desc", label_key="chips", enabled=False)

    def stats_shape(self, raw_stats: dict) -> dict:
        meta: dict = raw_stats.get("metadata") or {}
        return {
            "played": raw_stats["played"],
            "best": None,
            "avg": None,
            "last_played_at": raw_stats["last_played_at"],
            "best_chips": raw_stats["best"],
            "current_chips": raw_stats["latest_score"],
            "best_run_chips": meta.get("best_run_chips"),
            "total_runs": meta.get("total_runs"),
            "runs_completed": meta.get("runs_completed"),
            "current_table": meta.get("current_table"),
        }


module = BlackjackModule()

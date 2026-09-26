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
    - ``best``  → moved to ``extras.best_chips``
    - ``avg``   → dropped (chip counts don't aggregate meaningfully)
    - ``extras.current_chips`` ← ``latest_score`` (chips at end of last session)
    - ``extras`` also carries the run aggregates from the latest row's metadata
      (#2620). ``games/service.py`` mirrors ``extras`` onto the deprecated
      top-level ``best_chips`` … ``current_table`` fields until #2644.
    """

    game_type = GameType.BLACKJACK
    metadata_model = BlackjackMetadata
    result_model = BlackjackResult
    # A run records ``win`` when it reached its goal (even if the player kept
    # playing and later ran out of chips), ``loss`` when the chips ran out
    # before the goal, and ``abandoned`` when left before the goal (#2628).
    # Builds before #2628 send ``completed``; a Cash Out (``final_chips`` > 0)
    # is stored as ``win`` (#2703, games.legacy_outcomes), the rest stay
    # ``completed``: no winner.
    has_winner = True
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
            "extras": {
                "best_chips": raw_stats["best"],
                "current_chips": raw_stats["latest_score"],
                "best_run_chips": meta.get("best_run_chips"),
                "total_runs": meta.get("total_runs"),
                "runs_completed": meta.get("runs_completed"),
                "current_table": meta.get("current_table"),
            },
        }


module = BlackjackModule()

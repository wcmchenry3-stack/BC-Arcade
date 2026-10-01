"""Blackjack GameModule descriptor (#540).

Satisfies the ``GameModule`` Protocol from ``games/protocol.py`` via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from blackjack.models import BlackjackMetadata, BlackjackResult
from games.board import BoardDefinition
from vocab import GameOutcome, GameType

# The run's closing balance, in the validated result (``BlackjackResult``).
FINAL_CHIPS_KEY = "final_chips"


class BlackjackModule:
    """GameModule implementation for Blackjack.

    A run's score is its closing balance, ``result.final_chips`` (#2745). Stats
    "Best" (``best_value``) is the board's metric, so it reads ``final_chips``
    from every non-abandoned row, including rows stored before #2745 with no
    ``final_score``. ``final_score`` mirrors it: the app sends it on a finished
    run, and ``derive_final_score`` fills it in from ``final_chips`` when an
    older build, an offline-queued completion or the unmount/kill "win" path
    leaves it out.

    Stats shape: Blackjack's figures are all in ``extras``:
    - ``best_chips`` ← ``best`` (the highest non-abandoned ``final_score``)
    - ``current_chips`` ← ``latest_score`` (chips at end of last finished run)
    - the run aggregates from the latest row's metadata (#2620)
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
    # No leaderboard: chips are a balance, not a score (#2519 §4.2). The metric
    # is ``final_chips`` (a metadata key) so Stats "Best" reads the closing
    # balance whether or not the row carries a ``final_score`` (#2745).
    # qualifying_outcomes stays None: every non-abandoned session's closing
    # balance counts toward Best, whatever its last hand was. Abandons never do.
    board = BoardDefinition(
        metric=FINAL_CHIPS_KEY, direction="desc", label_key="chips", enabled=False
    )

    def derive_final_score(
        self, final_score: int | None, outcome: str | None, result: Mapping[str, Any]
    ) -> int | None:
        """The ``final_score`` to store for a completion (#2745).

        A finished run (any outcome but ``abandoned``) that sent no
        ``final_score`` gets its validated ``final_chips``. A finished run that
        does send one must also send ``final_chips``, and the two must be equal:
        otherwise ``ValueError`` (``complete_game`` answers 400), so a stored
        score always has the board metric beside it. Abandons are stored
        exactly as sent.
        """
        if outcome == GameOutcome.ABANDONED.value:
            return final_score
        raw = result.get(FINAL_CHIPS_KEY)
        chips = raw if isinstance(raw, int) and not isinstance(raw, bool) else None
        if final_score is None:
            return chips
        if chips is None:
            raise ValueError("final_score requires result.final_chips")
        if final_score != chips:
            raise ValueError("final_score must equal result.final_chips")
        return final_score

    def stats_shape(self, raw_stats: dict) -> dict:
        meta: dict = raw_stats.get("metadata") or {}
        return {
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

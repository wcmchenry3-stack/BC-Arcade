"""Cascade GameModule descriptor (#540).

A ``GameModuleBase`` subclass (``games/module_base.py``) that overrides
``derive_final_score``: a finished game scores its merge points plus the
server's time bonus (#3700), and ``validate_event``: the replay events,
``drop`` and ``merge``, are checked against their schema and byte caps
(#3858, ``cascade/events.py``).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from cascade.events import DROP, MERGE, validate_replay_event
from cascade.models import CascadeMetadata, CascadeResult, cascade_score
from games.board import SCORE_METRIC, BoardDefinition
from games.module_base import GameModuleBase
from vocab import GameOutcome, GameType


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


class CascadeModule(GameModuleBase):
    """GameModule implementation for Cascade."""

    game_type = GameType.CASCADE
    metadata_model = CascadeMetadata
    # Its server fields (time_bonus, bonus_rule, won, final_score) are set in
    # validation, from the completion's outcome and duration_ms (#3700).
    result_model = CascadeResult
    # A capstone records win, the lid loss (#3699); builds before it send completed.
    has_winner = True
    # No natural ceiling (#2519 decision 14). Every non-abandoned game counts.
    # Score = merge score + time bonus (#3700); no tie-break (equal scores go
    # to the entry received first, as on every board).
    board = BoardDefinition(metric=SCORE_METRIC, direction="desc", label_key="score")

    def derive_final_score(
        self, final_score: int | None, outcome: str | None, result: Mapping[str, Any]
    ) -> int | None:
        """The ``final_score`` to store for a completion (#3700).

        A finished game (any outcome but ``abandoned``) whose block carries
        ``merge_score`` scores ``merge_score + time_bonus``, at most 2³¹−1 (the bonus the
        result model computed), whatever ``final_score`` the app sent: a
        mismatch is overwritten, never rejected (a 400 dead-letters the game).
        An abandon, and a block from a build before #3700 (no ``merge_score``),
        keep the ``final_score`` sent, with no bonus.
        """
        if outcome == GameOutcome.ABANDONED.value:
            return final_score
        merge = _int(result.get("merge_score"))
        if merge is None:
            return final_score
        return cascade_score(merge, _int(result.get("time_bonus")) or 0)

    def validate_event(self, name: str, data: dict[str, Any]) -> dict[str, Any] | None:
        """``drop`` and ``merge`` are checked against the v1 schema and their byte caps
        (#3858); ``game_started`` / ``game_ended`` are stored as sent."""
        if name in (DROP, MERGE):
            return validate_replay_event(name, data)
        return data


module = CascadeModule()

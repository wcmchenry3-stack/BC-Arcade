"""Leaderboard board definitions (#2617, epic #2519).

Each ``GameModule`` declares how its game is ranked in one place, its
``board`` attribute. The server, the app (through the generated
``frontend/src/api/vocab.ts``) and the docs all read that declaration instead
of per-game leaderboard code.

This module only declares. ``games/leaderboard.py`` ranks boards, looks up
ranks and enforces ``max_value`` from these definitions (#2618); stats read
them from #2620.

Ordering a board
----------------
1. ``metric`` in ``direction`` (``desc``: higher is better; ``asc``: lower is
   better).
2. ``tiebreak``, when set, e.g. ``("total_moves", "asc")`` for Sort.
3. ``FINAL_TIEBREAK``: ``completed_at asc`` (the earlier entry wins). It is
   always applied last and is never declared on a board.

Where values live
-----------------
``metric`` is either ``SCORE_METRIC`` (``"final_score"``, the ``games``
column) or a key in ``games.metadata``, which holds the creation-time metadata
merged with the validated result block. ``tiebreak`` and ``partitions`` keys
always live in ``games.metadata``.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Direction = Literal["asc", "desc"]
"""``desc``: higher is better. ``asc``: lower is better (e.g. FreeCell moves)."""

SCORE_METRIC = "final_score"
"""The ``games.final_score`` column. Any other ``metric`` is a metadata key."""

FINAL_TIEBREAK: tuple[str, Direction] = ("completed_at", "asc")
"""Breaks the last tie on every board: the earlier entry ranks higher."""


class BoardDefinition(BaseModel):
    """How one game is ranked on its leaderboard.

    Attributes
    ----------
    metric:
        What is ranked: ``SCORE_METRIC`` or a ``games.metadata`` key.
    direction:
        ``desc`` if a higher ``metric`` is better, ``asc`` if lower is better.
    tiebreak:
        Optional ``(metadata key, direction)`` applied before ``FINAL_TIEBREAK``.
    label_key:
        i18n key for the metric's label, e.g. ``"score"``, ``"moves"``,
        ``"level"``. The client never has to know what the number means.
    partitions:
        ``games.metadata`` keys that split the game into separate boards, one
        per combination of values, e.g. ``["difficulty", "variant"]``.
    max_value:
        Highest legitimate ``metric`` value, for submission validation
        (absorbs #2215). ``None`` means the game has no natural ceiling.
    enabled:
        ``False`` for games with no leaderboard (Blackjack, Daily Word). Their
        ``metric``, ``direction`` and ``label_key`` still describe the
        per-game "best" shown in stats.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    metric: str = Field(min_length=1)
    direction: Direction
    tiebreak: tuple[str, Direction] | None = None
    label_key: str = Field(min_length=1)
    partitions: list[str] = Field(default_factory=list)
    max_value: int | None = Field(default=None, ge=0)
    enabled: bool = True

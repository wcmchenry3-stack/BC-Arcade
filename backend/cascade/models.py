"""Cascade metadata and result models (#539, #3700)."""

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, model_validator

from cascade.time_bonus import BONUS_RULE, time_bonus
from games.metadata import LegacyPlayerName
from int_bounds import INT32_MAX, Int32, NonNegInt32

MAX_TIER = 11
"""The capstone's tier (``CAPSTONE_TIER`` in ``frontend/src/game/cascade/tiers.ts``; 11 on the
12-tier ladder, #3960 / #3975)."""

# Written by the server only: whatever the app sends for them is replaced.
SERVER_KEYS = ("time_bonus", "bonus_rule")


class CascadeMetadata(BaseModel):
    """Validated metadata shape for Cascade game rows (#539).

    ``player_name`` is optional: older builds sent it on ``POST /games``;
    since #2624 the name lives on the player (``PUT /players/me``).
    ``extra="forbid"`` rejects unknown keys.
    """

    model_config = ConfigDict(extra="forbid")
    player_name: LegacyPlayerName = ""


class CascadeResult(BaseModel):
    """The result block sent on ``PATCH /games/{id}/complete`` (#3700).

    Sent by the app (``frontend/src/game/cascade/resultBlock.ts``):
    ``merge_score`` (the merge points), ``max_tier`` (highest tier made, 11 on a
    win), ``won`` / ``outcome``, and the keys sent before #3700: ``final_score``,
    ``duration_ms``, ``theme`` (the fruit set id), ``total_drops`` and
    ``total_merges``.

    Written by the server, from the completion's own ``outcome`` and
    ``duration_ms`` (the columns, passed as ``context`` by ``_validate_result``),
    never from the app's copies:

    - ``time_bonus`` and ``bonus_rule`` (``cascade/time_bonus.py``), when the
      block carries ``merge_score``. A block without one (builds before #3700)
      gets neither: its score is kept as sent, with no bonus.
    - ``won`` (``outcome == "win"``), which the Daily Challenge goals read, and
      ``outcome`` for a ``win`` / ``loss`` (left out otherwise: the column has it).
    - ``final_score`` = ``merge_score + time_bonus`` (at most 2³¹−1) on a
      finished (not abandoned) game, the value
      ``CascadeModule.derive_final_score`` stores.

    The bonus is worked out after validation, from the typed ``merge_score``
    (so ``"5000"`` scores as 5000 in the block and the column alike), and only
    when there is one: a null ``merge_score`` writes no bonus keys. A block
    ``duration_ms`` that isn't a whole number from 0 to 2³¹−1 (a negative one
    from a device clock set back, builds before #3738) is dropped, not
    rejected: the bonus reads the column, and a 400 would dead-letter the game.

    ``extra="ignore"``: a key a later build adds is dropped, never a 400, which
    would dead-letter the game in the app (``docs/GAME-CONTRACT.md``).
    """

    model_config = ConfigDict(extra="ignore")

    won: bool | None = None
    outcome: Literal["win", "loss"] | None = None
    merge_score: NonNegInt32 | None = None
    time_bonus: NonNegInt32 | None = None
    bonus_rule: NonNegInt32 | None = None
    max_tier: int | None = Field(default=None, ge=0, le=MAX_TIER)
    final_score: Int32 | None = None
    duration_ms: NonNegInt32 | None = None
    theme: str | None = Field(default=None, max_length=64)
    total_drops: NonNegInt32 | None = None
    total_merges: NonNegInt32 | None = None

    @model_validator(mode="before")
    @classmethod
    def _strip_server_keys(cls, data: Any, info: ValidationInfo) -> Any:
        """Drop the app's copies of the server fields, and a bad ``duration_ms``."""
        if not isinstance(data, dict):
            return data
        outcome = (info.context or {}).get("outcome")
        block = {k: v for k, v in data.items() if k not in SERVER_KEYS and k != "outcome"}
        block["won"] = outcome == "win"
        if outcome in ("win", "loss"):
            block["outcome"] = outcome
        if "duration_ms" in block and not _whole_ms(block["duration_ms"]):
            del block["duration_ms"]
        return block

    @model_validator(mode="after")
    def _score(self, info: ValidationInfo) -> Self:
        """The bonus and the score, from the typed merge score (none without one)."""
        if self.merge_score is None:
            return self
        context = info.context or {}
        outcome = context.get("outcome")
        self.time_bonus = time_bonus(outcome, context.get("duration_ms"))
        self.bonus_rule = BONUS_RULE
        if outcome != "abandoned":
            self.final_score = cascade_score(self.merge_score, self.time_bonus)
        return self


def cascade_score(merge_score: int, bonus: int) -> int:
    """A finished game's score: merge score + time bonus, at most 2³¹−1 (the column's top)."""
    return min(merge_score + bonus, INT32_MAX)


def _whole_ms(value: Any) -> bool:
    """A ``duration_ms`` the block can store: a whole number from 0 to 2³¹−1."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return False
    return float(value).is_integer() and 0 <= value <= INT32_MAX

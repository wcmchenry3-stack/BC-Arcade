"""Cascade metadata and result models (#539, #3700)."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, model_validator

from cascade.time_bonus import BONUS_RULE, time_bonus
from games.metadata import LegacyPlayerName
from int_bounds import Int32, NonNegInt32

MAX_TIER = 10
"""The capstone's tier (``MAX_TIER`` in ``frontend/src/game/cascade/tiers.ts``)."""

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
    ``merge_score`` (the merge points), ``max_tier`` (highest tier made, 10 on a
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
    - ``final_score`` = ``merge_score + time_bonus`` on a finished (not
      abandoned) game, the value ``CascadeModule.derive_final_score`` stores.

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
    def _server_fields(cls, data: Any, info: ValidationInfo) -> Any:
        if not isinstance(data, dict):
            return data
        context = info.context or {}
        outcome = context.get("outcome")
        block = {k: v for k, v in data.items() if k not in SERVER_KEYS and k != "outcome"}
        block["won"] = outcome == "win"
        if outcome in ("win", "loss"):
            block["outcome"] = outcome
        merge = block.get("merge_score")
        if "merge_score" not in block:
            return block
        bonus = time_bonus(outcome, context.get("duration_ms"))
        block["time_bonus"] = bonus
        block["bonus_rule"] = BONUS_RULE
        if outcome != "abandoned" and isinstance(merge, int) and not isinstance(merge, bool):
            block["final_score"] = merge + bonus
        return block

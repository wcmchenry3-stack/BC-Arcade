"""Bottle Sort metadata and result models (#2625)."""

from pydantic import BaseModel, ConfigDict, Field, StrictInt

from games.board import MAX_BOARD_VALUE
from games.metadata import LegacyPlayerName
from sort.catalog import LEVEL_COUNT


class SortMetadata(BaseModel):
    """Creation-time metadata for a Sort game row: only the legacy ``player_name``.

    ``extra="forbid"`` rejects unknown keys.
    """

    model_config = ConfigDict(extra="forbid")
    player_name: LegacyPlayerName = ""


class SortResult(BaseModel):
    """Result block sent on ``PATCH /games/{id}/complete`` (#2625).

    Mirrors ``SortScreen.tsx``. Every solved level is one session row with
    ``won: true`` and the ``level`` actually played, its ``moves`` and
    ``undos``. Every solve, replays included, is scored with the player's
    standing after it: ``level_reached`` is the highest level solved (also
    sent as ``final_score``) and ``total_moves`` the sum of the player's best
    moves over levels 1 to it (omitted when one of them has no best on
    record). ``catalog_version`` is the version of the level catalog the
    levels came from (#2761). The board ranks ``level_reached`` desc, then
    ``total_moves`` asc, then the earliest receipt (``module.board``), keeps
    each player's best row, and only ranks rows of the current catalog. An
    abandon sends ``won: false`` with the level (``null`` if none was open)
    and the moves so far, and no score.

    Every field is optional and unknown keys are ignored, so no build the
    testers have can fail completion and dead-letter a solve. The standing
    keys are strict integers: lax coercion would turn a string or a bool
    into a stored number. ``level_reached`` and ``level`` stop at the
    catalog's last level; builds from before the catalog only ever sent
    levels up to 23, so they still pass. ``stars`` (#3687) is the solve's own
    1 to 3 stars (a strict integer); builds from before it simply omit it.
    """

    level: int | None = Field(default=None, ge=0, le=LEVEL_COUNT)
    moves: int | None = Field(default=None, ge=0)
    undos: int | None = Field(default=None, ge=0)
    level_reached: StrictInt | None = Field(default=None, ge=0, le=LEVEL_COUNT)
    total_moves: StrictInt | None = Field(default=None, ge=0, le=MAX_BOARD_VALUE)
    catalog_version: StrictInt | None = Field(default=None, ge=1, le=MAX_BOARD_VALUE)
    # The solve's stars, 1 to 3 (#3687), judged against the level's par. Sent on
    # the row already sent; it does not affect the board's ranking.
    stars: StrictInt | None = Field(default=None, ge=1, le=3)
    # Sent by the #2512 builds; kept so their rows store what they always did.
    outcome: str | None = Field(default=None, max_length=32)
    won: bool | None = None


class LevelData(BaseModel):
    id: int
    bottles: list[list[str]]


class LevelsResponse(BaseModel):
    levels: list[LevelData]

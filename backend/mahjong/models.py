from pydantic import BaseModel, ConfigDict, Field

LAYOUTS: tuple[str, ...] = (
    "turtle",
    "pyramid",
    "square",
    "arena",
    "four_rivers",
    "butterfly",
    "fish",
    "spider",
    "cat",
    "snowflake",
    "castle",
    "bridge",
    "gate",
    "double_pyramid",
    "anchor",
    "crown",
    "shield",
    "heart",
    "hourglass",
    "the_key",
    "diamond",
    "x_wing",
    "maze",
    "zig_zag",
    "concentric_squares",
)
"""The app's layout ids, in its registry order (``LAYOUTS`` in
``frontend/src/game/mahjong/layouts/registry.ts``; a test keeps the two in
step). Each has its own board (#2747). A row with another id is stored but
never ranks: there is no board to name it."""

MIN_CLEAR_MS = 72 * 500
"""Fastest clear that ranks: half a second per pair over the 72 pairs of every
layout (36 s). Each pair takes two taps on two free tiles that first have to
be found, so a faster ``duration_ms`` is a broken clock or a forged result,
not play. It is stored (never rejected) but never ranks (#2747)."""


class MahjongMetadata(BaseModel):
    """Validated metadata shape for Mahjong Solitaire game rows (#871).

    ``player_name`` is optional: older builds sent it on ``POST /games``;
    since #2624 the name lives on the player (``PUT /players/me``).
    ``layout`` is the id of the layout played (``turtle``, ``pyramid``, ...),
    sent by the app since #2627; rows from older builds have none. The board
    ranks the fastest clear per layout (#2747): layouts differ in difficulty,
    so each id in ``LAYOUTS`` has its own board. A row with no layout can't be
    placed on one and never ranks. Any well-formed id is accepted (rejecting
    one would dead-letter the game in the app); only ``LAYOUTS`` rank.
    ``extra="forbid"`` rejects unknown keys.
    """

    model_config = ConfigDict(extra="forbid")
    player_name: str = Field(default="", max_length=64)
    layout: str | None = Field(default=None, min_length=1, max_length=32, pattern=r"^[a-z0-9_]+$")


class MahjongResult(BaseModel):
    """Validated result block sent on ``PATCH /games/{id}/complete`` (#2449).

    Distinct from the creation-time metadata model. Unknown keys are ignored so
    a newer app build never fails completion. ``won`` is the win signal for
    goal evaluation (daily challenges read it). What Mahjong records in
    ``games.outcome`` (``win`` for a cleared board, ``loss`` for a deadlock
    the player leaves) is documented on ``vocab.GameOutcome``.
    """

    won: bool
    pairs: int = Field(ge=0)

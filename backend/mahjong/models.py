from pydantic import BaseModel, ConfigDict, Field


class MahjongMetadata(BaseModel):
    """Validated metadata shape for Mahjong Solitaire game rows (#871).

    ``player_name`` is optional: older builds sent it on ``POST /games``;
    since #2624 the name lives on the player (``PUT /players/me``).
    ``layout`` is the id of the layout played (``turtle``, ``pyramid``, ...),
    sent by the app since #2627; rows from older builds have none. Every
    layout is 144 tiles, so there is one board for all of them (#2519
    decision 3); the id is recorded so the board can be split later.
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

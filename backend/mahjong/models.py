from pydantic import BaseModel, ConfigDict, Field


class MahjongMetadata(BaseModel):
    """Validated metadata shape for Mahjong Solitaire game rows (#871).

    ``player_name`` is optional here because the generic ``POST /games``
    endpoint may be called without a name; the Mahjong-specific
    ``POST /mahjong/score`` route always supplies it internally.
    ``extra="forbid"`` rejects unknown keys.
    """

    model_config = ConfigDict(extra="forbid")
    player_name: str = Field(default="", max_length=64)


class ScoreSubmitRequest(BaseModel):
    player_name: str = Field(..., min_length=1, max_length=32)
    score: int = Field(..., ge=0)


class ScoreEntry(BaseModel):
    player_name: str
    score: int
    rank: int


class LeaderboardResponse(BaseModel):
    scores: list[ScoreEntry]


class MahjongResult(BaseModel):
    """Validated result block sent on ``PATCH /games/{id}/complete`` (#2449).

    Distinct from the creation-time metadata model. Unknown keys are ignored so
    a newer app build never fails completion. ``won`` is the win signal for
    goal evaluation. What Mahjong records in ``games.outcome`` is documented on
    ``vocab.GameOutcome``.
    """

    won: bool
    pairs: int = Field(ge=0)

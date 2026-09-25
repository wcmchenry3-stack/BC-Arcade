from pydantic import BaseModel, ConfigDict, Field


class SolitaireMetadata(BaseModel):
    """Validated metadata shape for Solitaire game rows (#592).

    ``player_name`` is optional here because the generic ``POST /games``
    endpoint may be called without a name; the Solitaire-specific
    ``POST /solitaire/score`` route always supplies it internally.
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
    # 1-indexed position in the sorted leaderboard. A submit that didn't make
    # the top 10 will have rank == 11 (the truncated-off position).
    rank: int


class LeaderboardResponse(BaseModel):
    scores: list[ScoreEntry]


class SolitaireResult(BaseModel):
    """Validated result block sent on ``PATCH /games/{id}/complete`` (#2449).

    Distinct from the creation-time metadata model. Unknown keys are ignored so
    a newer app build never fails completion. ``won`` is the win signal for
    goal evaluation; ``games.outcome`` semantics live on ``vocab.GameOutcome``.
    """

    won: bool
    moves: int = Field(ge=0)

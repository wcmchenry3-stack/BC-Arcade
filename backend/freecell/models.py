from pydantic import BaseModel, ConfigDict, Field


class FreeCellMetadata(BaseModel):
    """Validated creation-time metadata for FreeCell game rows (#2452).

    Nothing is required: the session row the app opens with ``POST /games`` is
    separate from the name-gated leaderboard submission (``POST /freecell/score``),
    which writes its own row with ``player_name``. ``extra="forbid"`` rejects
    unknown keys.
    """

    model_config = ConfigDict(extra="forbid")
    player_name: str = Field(default="", max_length=64)


class FreeCellResult(BaseModel):
    """Validated result block sent on ``PATCH /games/{id}/complete`` (#2452).

    The daily challenge reads exactly these fields (``moves`` for the "make N
    moves" goal, which an abandoned game still counts; ``won`` and ``moves`` for
    the win goals). Unknown keys are ignored so a newer app build never fails
    completion. The session's ``final_score`` is deliberately left null — see
    ``freecell/router.py``: the leaderboard ranks every scored row.
    """

    won: bool
    moves: int = Field(ge=0)


class ScoreSubmitRequest(BaseModel):
    player_id: str = Field(..., min_length=1, max_length=64)
    move_count: int = Field(..., gt=0)


class ScoreEntry(BaseModel):
    player_id: str
    move_count: int
    rank: int


class LeaderboardResponse(BaseModel):
    scores: list[ScoreEntry]

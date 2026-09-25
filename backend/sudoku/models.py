from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Difficulty = Literal["easy", "medium", "hard"]
Variant = Literal["classic", "mini"]


class SudokuMetadata(BaseModel):
    """Validated metadata shape for Sudoku game rows (#614).

    ``extra="forbid"`` rejects unknown keys.  ``difficulty`` is the only
    required game-specific field; it's constrained to the three tiers
    defined in Epic #613.
    """

    model_config = ConfigDict(extra="forbid")
    player_name: str = Field(default="", max_length=64)
    difficulty: Difficulty
    variant: Variant = "classic"


class SetPlayerNameRequest(BaseModel):
    player_name: str = Field(..., min_length=1, max_length=32)


class ScoreEntry(BaseModel):
    player_name: str
    score: int
    rank: int


class LeaderboardResponse(BaseModel):
    scores: list[ScoreEntry]


class SudokuResult(BaseModel):
    """Validated result block sent on ``PATCH /games/{id}/complete`` (#2449).

    Distinct from the creation-time metadata model. Unknown keys are ignored so
    a newer app build never fails completion. ``won`` is the win signal for
    goal evaluation; ``games.outcome`` semantics live on ``vocab.GameOutcome``.
    """

    won: bool
    errors: int = Field(ge=0)

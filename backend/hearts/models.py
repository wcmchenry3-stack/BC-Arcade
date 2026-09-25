from pydantic import BaseModel, ConfigDict, Field


class HeartsMetadata(BaseModel):
    """Creation-time metadata for a Hearts game row.

    ``ai_difficulty`` is the opponent style the game was played against
    (#2629): one of the app's ``AI_PRESETS`` in
    ``frontend/src/game/hearts/types.ts``, the source of the values. It is
    recorded, not partitioned on: the board ranks every style together
    (#2519 decision 4). Builds before #2629 don't send it, so it is optional;
    any other string is accepted, since rejecting a label would lose the whole
    game in the app. ``extra="forbid"`` rejects unknown keys.
    """

    model_config = ConfigDict(extra="forbid")
    player_name: str = Field(default="", max_length=64)
    ai_difficulty: str | None = Field(default=None, max_length=32)


class ScoreSubmitRequest(BaseModel):
    player_name: str = Field(..., min_length=1, max_length=32)
    score: int = Field(..., ge=0)


class ScoreEntry(BaseModel):
    player_name: str
    score: int
    rank: int


class LeaderboardResponse(BaseModel):
    scores: list[ScoreEntry]

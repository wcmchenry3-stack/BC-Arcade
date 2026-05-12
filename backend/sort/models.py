from pydantic import BaseModel, ConfigDict, Field


class SortMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    player_name: str = Field(default="", max_length=32)


class ScoreSubmitRequest(BaseModel):
    player_name: str = Field(..., min_length=1, max_length=32)
    level_reached: int = Field(..., ge=1, le=20)


class ScoreEntry(BaseModel):
    player_name: str
    level_reached: int
    rank: int


class LeaderboardResponse(BaseModel):
    scores: list[ScoreEntry]


class LevelData(BaseModel):
    id: int
    bottles: list[list[str]]


class LevelsResponse(BaseModel):
    levels: list[LevelData]

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AiDifficulty = Literal["easy", "medium", "hard"]


class YachtMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    difficulty: AiDifficulty = Field(default="easy")


class YachtScoreSubmitRequest(BaseModel):
    player_name: str = Field(..., min_length=1, max_length=32)
    score: int = Field(..., ge=0, le=400)
    difficulty: AiDifficulty


class ScoreEntry(BaseModel):
    player_name: str
    raw_score: int
    score: int
    difficulty: AiDifficulty
    timestamp: datetime
    rank: int


class LeaderboardResponse(BaseModel):
    scores: list[ScoreEntry]

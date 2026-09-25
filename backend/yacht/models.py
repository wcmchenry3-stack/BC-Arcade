from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

AiDifficulty = Literal["easy", "medium", "hard"]
YachtMode = Literal["solo", "vs"]


class YachtMetadata(BaseModel):
    """``games.metadata`` for a Yacht session, validated on ``POST /games``.

    Recorded, not partitioned: solo and vs-the-computer games share one board
    (#2519 decision 2). ``difficulty`` is the computer's, so a vs game must
    have one and a solo game must not. Installed builds that predate #2630
    send no ``mode`` (``{}``, or only a ``difficulty``); those keep validating.
    """

    model_config = ConfigDict(extra="forbid")
    mode: YachtMode | None = None
    difficulty: AiDifficulty | None = None

    @model_validator(mode="after")
    def _difficulty_matches_mode(self) -> "YachtMetadata":
        if self.mode == "vs" and self.difficulty is None:
            raise ValueError("a vs game needs the computer's difficulty")
        if self.mode == "solo" and self.difficulty is not None:
            raise ValueError("a solo game has no difficulty")
        return self

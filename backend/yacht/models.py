from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AiDifficulty = Literal["easy", "medium", "hard"]
YachtMode = Literal["solo", "vs"]


class YachtMetadata(BaseModel):
    """``games.metadata`` for a Yacht session, validated on ``POST /games``.

    Recorded, not partitioned: solo and vs-the-computer games share one board
    (#2519 decision 2). ``difficulty`` is the computer's, so only a vs game
    has one. Both fields are optional because installed builds that predate
    #2630 send ``{}``.
    """

    model_config = ConfigDict(extra="forbid")
    mode: YachtMode | None = None
    difficulty: AiDifficulty = Field(default="easy")

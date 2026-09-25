from pydantic import BaseModel, ConfigDict, Field, StrictInt


class SortMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    player_name: str = Field(default="", max_length=32)


class SortResult(BaseModel):
    """Result block sent on ``PATCH /games/{id}/complete`` (#2625).

    Mirrors ``SortScreen.tsx``. Every solved level is one session row with
    ``won: true`` and the ``level`` actually played, its ``moves`` and
    ``undos``. Every solve, replays included, is scored with the player's
    standing after it: ``level_reached`` is the highest level solved (also
    sent as ``final_score``) and ``total_moves`` the sum of the player's best
    moves over levels 1 to it (omitted when one of them has no best on
    record). The board ranks ``level_reached`` desc, then ``total_moves`` asc
    (``module.board``) and keeps each player's best row, so a replay that
    lowers a best improves the player's rank. An abandon sends ``won: false``
    with the level (``null`` if none was open) and the moves so far, and no
    score.

    Every field is optional and unknown keys are ignored, so no build the
    testers have can fail completion and dead-letter a solve. The two board
    keys are strict integers: the board's checks already reject a string or a
    bool there (``board_limit_violation``), and lax coercion would turn one
    into a ranked value instead.
    """

    level: int | None = Field(default=None, ge=0)
    moves: int | None = Field(default=None, ge=0)
    undos: int | None = Field(default=None, ge=0)
    level_reached: StrictInt | None = Field(default=None, ge=0)
    total_moves: StrictInt | None = Field(default=None, ge=0)
    # Sent by the #2512 builds; kept so their rows store what they always did.
    outcome: str | None = Field(default=None, max_length=32)
    won: bool | None = None


class ScoreSubmitRequest(BaseModel):
    player_name: str = Field(..., min_length=1, max_length=32)
    level_reached: int = Field(..., ge=1, le=23)


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

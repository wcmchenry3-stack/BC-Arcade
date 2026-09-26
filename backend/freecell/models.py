from pydantic import BaseModel, ConfigDict, Field


class FreeCellMetadata(BaseModel):
    """Validated creation-time metadata for FreeCell game rows (#2452).

    Deliberately empty: the session row the app opens with ``POST /games`` carries
    no creation-time fields. The board shows the player's display name
    (``PUT /players/me``, #2624), never a name on the row.
    ``extra="forbid"`` rejects anything sent.
    """

    model_config = ConfigDict(extra="forbid")


class FreeCellResult(BaseModel):
    """Validated result block sent on ``PATCH /games/{id}/complete`` (#2452).

    The daily challenge reads exactly these fields (``moves`` for the "make N
    moves" goal, which an abandoned game still counts; ``won`` and ``moves`` for
    the win goals). Unknown keys are ignored so a newer app build never fails
    completion. Since #2632 a won session also sends its move count as
    ``final_score`` (the generic board ranks it, fewest first); older builds
    leave it null.
    """

    won: bool
    moves: int = Field(ge=0)

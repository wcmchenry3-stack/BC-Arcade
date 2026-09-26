from pydantic import BaseModel, ConfigDict, Field


class CascadeMetadata(BaseModel):
    """Validated metadata shape for Cascade game rows (#539).

    ``player_name`` is optional: older builds sent it on ``POST /games``;
    since #2624 the name lives on the player (``PUT /players/me``).
    ``extra="forbid"`` rejects unknown keys.
    """

    model_config = ConfigDict(extra="forbid")
    player_name: str = Field(default="", max_length=64)

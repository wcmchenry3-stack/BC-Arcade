"""Cascade metadata model (#539). Cascade sends no result block."""

from pydantic import BaseModel, ConfigDict

from games.metadata import LegacyPlayerName


class CascadeMetadata(BaseModel):
    """Validated metadata shape for Cascade game rows (#539).

    ``player_name`` is optional: older builds sent it on ``POST /games``;
    since #2624 the name lives on the player (``PUT /players/me``).
    ``extra="forbid"`` rejects unknown keys.
    """

    model_config = ConfigDict(extra="forbid")
    player_name: LegacyPlayerName = ""

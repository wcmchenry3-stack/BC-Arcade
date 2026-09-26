from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

DrawMode = Literal[1, 3]


class SolitaireMetadata(BaseModel):
    """Validated metadata shape for Solitaire game rows (#592).

    ``player_name`` is optional: older builds sent it on ``POST /games``;
    since #2624 the name lives on the player (``PUT /players/me``).
    ``draw_mode`` (#2632) is the deal's Draw-1 / Draw-3 mode, sent on
    ``POST /games`` by current builds. It is optional so older builds, which
    send no metadata, still validate. Both modes share one board (#591): it is
    recorded, not a partition. ``extra="forbid"`` rejects unknown keys.
    """

    model_config = ConfigDict(extra="forbid")
    player_name: str = Field(default="", max_length=64)
    draw_mode: DrawMode | None = None

    @field_validator("draw_mode", mode="before")
    @classmethod
    def _draw_mode_is_an_int(cls, value: Any) -> Any:
        # The metadata is stored as sent, and ``Literal[1, 3]`` alone would let
        # ``true`` (== 1) or ``3.0`` through.
        if value is not None and type(value) is not int:
            raise ValueError("draw_mode must be 1 or 3")
        return value


class SolitaireResult(BaseModel):
    """Validated result block sent on ``PATCH /games/{id}/complete`` (#2449).

    Distinct from the creation-time metadata model. Unknown keys are ignored so
    a newer app build never fails completion. ``won`` is the win signal for
    goal evaluation; ``games.outcome`` semantics live on ``vocab.GameOutcome``.
    """

    won: bool
    moves: int = Field(ge=0)

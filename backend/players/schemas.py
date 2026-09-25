"""Request/response schemas for ``/players/me`` (#2624)."""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, StringConstraints

from db.models import PLAYER_DISPLAY_NAME_MAX_LENGTH

DisplayName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=PLAYER_DISPLAY_NAME_MAX_LENGTH
    ),
]
"""A display name: 1-32 characters once surrounding whitespace is dropped.

Shared with ``PATCH /games/{id}/name``'s ``player_name`` so the two can't drift.
"""


class SetDisplayNameRequest(BaseModel):
    """``PUT /players/me``."""

    display_name: DisplayName


class PlayerResponse(BaseModel):
    """The caller's display name, or ``null`` when none is set."""

    display_name: str | None

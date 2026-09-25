"""Request/response schemas for ``/players/me`` (#2624)."""

from __future__ import annotations

import unicodedata
from typing import Annotated

from pydantic import AfterValidator, BaseModel

from db.models import PLAYER_DISPLAY_NAME_MAX_LENGTH


def clean_display_name(raw: object, *, truncate: bool = False) -> str | None:
    """``raw`` as a display name, or ``None`` when it can't be one.

    Trimmed with ``str.strip()`` (the board trims the same way), 1-32
    characters, and no control characters (Unicode ``Cc``): those render as
    nothing on a board, and Postgres rejects NUL outright. ``truncate`` cuts
    a longer name to 32 characters instead of refusing it, for names that
    come from legacy routes (#2624 review).
    """
    if not isinstance(raw, str):
        return None
    name = raw.strip()
    if truncate:
        name = name[:PLAYER_DISPLAY_NAME_MAX_LENGTH].rstrip()
    if not name or len(name) > PLAYER_DISPLAY_NAME_MAX_LENGTH:
        return None
    if any(unicodedata.category(c) == "Cc" for c in name):
        return None
    return name


def _display_name(value: str) -> str:
    name = clean_display_name(value)
    if name is None:
        raise ValueError(
            f"must be 1-{PLAYER_DISPLAY_NAME_MAX_LENGTH} characters with no control characters"
        )
    return name


DisplayName = Annotated[str, AfterValidator(_display_name)]
"""A display name: 1-32 characters once surrounding whitespace is dropped,
with no control characters (``clean_display_name``). The app applies the same
rule (``normalizeDisplayName``), so a name it accepts is never refused here.

Shared with ``PATCH /games/{id}/name``'s ``player_name`` so the two can't drift.
"""


class SetDisplayNameRequest(BaseModel):
    """``PUT /players/me``."""

    display_name: DisplayName


class PlayerResponse(BaseModel):
    """The caller's display name, or ``null`` when none is set."""

    display_name: str | None

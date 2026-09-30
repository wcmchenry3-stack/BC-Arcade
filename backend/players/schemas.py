"""Request/response schemas for ``/players/me`` (#2624, #2778)."""

from __future__ import annotations

import unicodedata

from pydantic import BaseModel

from db.models import PLAYER_DISPLAY_NAME_MAX_LENGTH


def clean_display_name(raw: object, *, truncate: bool = False) -> str | None:
    """``raw`` as a would-be name, or ``None`` when it can't be one.

    Since #2778 no client text is ever stored as a public name: this only
    decides whether an older build *sent* a name (``POST /games`` metadata),
    which under the old model was the player's choice to join the boards.
    Trimmed, 1-32 characters (``truncate`` cuts a longer one instead of
    refusing it), and no control characters (Unicode ``Cc``).
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


class PlayerResponse(BaseModel):
    """The caller's generated public name, or ``null`` when they are not on
    the leaderboards."""

    display_name: str | None

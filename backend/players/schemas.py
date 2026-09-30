"""Request/response schemas for ``/players/me`` (#2624, #2778)."""

from __future__ import annotations

from pydantic import BaseModel

# Names older builds filled in or suggested for the player rather than ones the
# player chose (compared trimmed and case-insensitively, see
# ``is_default_legacy_name``). Sending one of these was not a deliberate choice
# to appear on the public boards, so it never opts anyone in. Migration
# ``0030_generated_player_names`` keeps a literal copy of this list;
# ``tests/test_generated_names.py`` checks the two copies match.
LEGACY_DEFAULT_NAMES: frozenset[str] = frozenset(
    {"", "you", "player", "guest", "anonymous", "anon", "me", "player 1", "player1"}
)


def clean_display_name(raw: object) -> str | None:
    """``raw`` trimmed, or ``None`` unless it is a non-blank string.

    Since #2778 no client text is ever stored as a public name, so nothing
    about its content matters beyond this: it only decides whether an older
    build *sent* a name (``POST /games`` metadata), which under the old model
    was the player's choice to join the boards.
    """
    if not isinstance(raw, str):
        return None
    return raw.strip() or None


def is_default_legacy_name(name: str) -> bool:
    """Whether ``name`` is a default an older build filled in, not a choice."""
    return name.strip().casefold() in LEGACY_DEFAULT_NAMES


class PlayerResponse(BaseModel):
    """The caller's generated public name, or ``null`` when they are not on
    the leaderboards."""

    display_name: str | None

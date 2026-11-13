"""Whether a board's ``edition`` is enforced right now (#2761).

``BoardDefinition.edition`` resets a board: only rows holding the edition's
integer rank. A board may tie that to a server switch, ``edition_switch``: the
name of a boolean ``Settings`` field (an env var on Render). While the switch
is off the edition is ignored and the board ranks every row as before the
reset; once it is on, only the edition's rows rank. That lets the backend ship
before the app builds that send the edition reach players, and the owner turn
the reset on when they do: change the env var and redeploy, no code release.

The switch is read lazily through this module's own ``_settings`` and kept for
the process, like ``REPLAY_RECORDING_ENABLED`` (``games.sessions``). The stats
"best" expression (``games.stats_columns._best_candidate``) is cached for the
process too, so a flip takes effect on the restart a redeploy does.

Sort: ``SORT_CATALOG_EDITION_ENFORCED`` (default off).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from games.board import BoardDefinition
from settings import Settings

_settings: Settings | None = None


def _get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def edition_switch_on(name: str) -> bool:
    """Whether the boolean ``Settings`` field *name* is on, read lazily (not at
    import time). Shared by the boards' ``edition_switch`` and by anything else
    gated on the same release step (Sort's daily-challenge goals, #3728)."""
    return bool(getattr(_get_settings(), name))


def enforced_edition(board: BoardDefinition) -> tuple[str, int] | None:
    """The board's ``edition`` if it applies now, else ``None`` (every row ranks)."""
    if board.edition is None:
        return None
    if board.edition_switch is not None and not edition_switch_on(board.edition_switch):
        return None
    return board.edition


def row_in_edition(board: BoardDefinition, metadata: Mapping[str, Any] | None) -> bool:
    """Whether a row with *metadata* may rank under the board's enforced edition."""
    edition = enforced_edition(board)
    return edition is None or board.in_edition(metadata)

"""Field types shared by the per-game metadata models (#2995).

``LegacyPlayerName`` is the ``player_name`` builds from before #2624 send in
``POST /games`` metadata. It plays no part in ranking: a non-blank one only
opts the player in to the leaderboards under a generated name
(``remember_legacy_opt_in``, #2778). It is validation-only JSON, so its limit
can change without a migration. Every game that accepts it allows the same
64 characters, so no shipped build is rejected (the owner's decision on
#2995; Sort allowed only 32 before).
"""

from __future__ import annotations

from typing import Annotated

from pydantic import Field

LEGACY_PLAYER_NAME_MAX_LENGTH = 64

# Declare as ``player_name: LegacyPlayerName = ""``.
LegacyPlayerName = Annotated[str, Field(max_length=LEGACY_PLAYER_NAME_MAX_LENGTH)]

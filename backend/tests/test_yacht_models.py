"""``YachtMetadata`` rules and the removed legacy models (#2630).

No database: these run in every environment, unlike ``test_yacht_api.py``,
which is skipped without ``DATABASE_URL``.
"""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from yacht import models
from yacht.models import YachtMetadata


def test_legacy_models_are_gone() -> None:
    for name in ("ScoreEntry", "LeaderboardResponse", "YachtScoreSubmitRequest"):
        assert not hasattr(models, name), name


@pytest.mark.parametrize(
    ("metadata", "mode", "difficulty"),
    [
        ({"mode": "solo"}, "solo", None),
        ({"mode": "vs", "difficulty": "easy"}, "vs", "easy"),
        ({"mode": "vs", "difficulty": "medium"}, "vs", "medium"),
        ({"mode": "vs", "difficulty": "hard"}, "vs", "hard"),
        # Installed builds that predate #2630 send no mode, with or without a
        # difficulty: either is accepted.
        ({}, None, None),
        ({"difficulty": "hard"}, None, "hard"),
    ],
)
def test_valid_metadata(metadata: dict[str, Any], mode: str | None, difficulty: str | None) -> None:
    m = YachtMetadata.model_validate(metadata)
    assert (m.mode, m.difficulty) == (mode, difficulty)


@pytest.mark.parametrize(
    ("metadata", "message"),
    [
        ({"mode": "vs"}, "a vs game needs the computer's difficulty"),
        ({"mode": "vs", "difficulty": None}, "a vs game needs the computer's difficulty"),
        ({"mode": "solo", "difficulty": "easy"}, "a solo game has no difficulty"),
        ({"mode": "duo"}, "mode"),
        ({"mode": "vs", "difficulty": "legendary"}, "difficulty"),
        ({"difficulty": "legendary"}, "difficulty"),
        ({"mode": "solo", "player_name": "Alice"}, "player_name"),
    ],
)
def test_invalid_metadata(metadata: dict[str, Any], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        YachtMetadata.model_validate(metadata)

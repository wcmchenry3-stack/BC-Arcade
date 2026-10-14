"""``game_started`` carries the deal seed for Solitaire, FreeCell and Mahjong (#3281).

The seed, seed-bank index, draw mode / layout and engine version are event
``data``, not row metadata: ``validate_event`` stores the data as sent, so the
new keys need no model change, and the metadata models (``extra="forbid"``,
#3221) still refuse them, so a client cannot write them onto the game row.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from games.registry import _REGISTRY

# game_type -> the game_started data the app sends (frontend dealEventData).
SENT: dict[str, dict] = {
    "solitaire": {"draw_mode": 3, "engine_version": 1, "seed": 1234567, "seed_index": 17},
    "freecell": {"engine_version": 1, "seed": 44, "seed_index": 9},
    "mahjong": {"layout": "turtle", "engine_version": 1, "seed": 4000000000},
}


@pytest.mark.parametrize("game_type", sorted(SENT))
def test_game_started_deal_data_is_stored_as_sent(game_type: str) -> None:
    module = _REGISTRY[game_type]
    data = dict(SENT[game_type])
    assert module.validate_event("game_started", data) == SENT[game_type]


@pytest.mark.parametrize("game_type", sorted(SENT))
def test_deal_keys_are_not_accepted_as_row_metadata(game_type: str) -> None:
    model = _REGISTRY[game_type].metadata_model
    with pytest.raises(ValidationError):
        model.model_validate({"seed": 1})
    with pytest.raises(ValidationError):
        model.model_validate({"engine_version": 1})

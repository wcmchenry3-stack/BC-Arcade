"""Every game's creation metadata rejects unknown keys (#3221).

``POST /games`` stores the metadata dict it validated, so a model that let extra
keys through would let a client write arbitrary data onto the row. These tests
cover every registered game, so a new game with a lax model fails here.

``APP_SENT`` is what the current app sends in ``POST /games`` metadata, per game
(the second argument of ``start``/``restart`` in ``useGameSync``). Keep it in
step with the frontend sources named beside each entry.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from games.registry import _REGISTRY
from games.schemas import CreateGameRequest

# game_type -> every metadata payload shape the app sends.
APP_SENT: dict[str, list[dict]] = {
    # BlackjackGameContext.tsx: syncStart({starting_chips}) is event data; no metadata.
    "blackjack": [{}],
    # CascadeScreen.tsx: syncStart({fruit_set, theme, seed}) is event data; no metadata.
    "cascade": [{}],
    # useDailyWordSubmit.ts
    "daily_word": [{"puzzle_id": "2026-10-13", "language": "en"}],
    # FreeCellScreen.tsx: syncStart() with no arguments.
    "freecell": [{}],
    # HeartsScreen.tsx
    "hearts": [{"ai_difficulty": "conservative"}],
    # MahjongScreen.tsx
    "mahjong": [{"layout": "turtle"}],
    # SolitaireScreen.tsx
    "solitaire": [{"draw_mode": 1}, {"draw_mode": 3}],
    # SortScreen.tsx: syncStart({level}) is event data; no metadata.
    "sort": [{}],
    # StarSwarmScreen.tsx
    "starswarm": [{"difficulty_tier": "LieutenantJG"}],
    # SudokuScreen.tsx
    "sudoku": [{"difficulty": "easy", "variant": "classic"}],
    # Twenty48Screen.tsx: syncStart({initial_board}) is event data; no metadata.
    "twenty48": [{}],
    # GameScreen.tsx (sessionMetadata)
    "yacht": [{"mode": "solo"}, {"mode": "vs", "difficulty": "easy"}],
}


def test_audit_covers_every_registered_game() -> None:
    assert set(APP_SENT) == set(_REGISTRY)


@pytest.mark.parametrize("name", sorted(_REGISTRY))
def test_metadata_model_forbids_extra_keys(name: str) -> None:
    assert _REGISTRY[name].metadata_model.model_config.get("extra") == "forbid"


@pytest.mark.parametrize("name", sorted(_REGISTRY))
def test_create_request_rejects_unknown_metadata_key(name: str) -> None:
    for sent in APP_SENT[name]:
        with pytest.raises(ValidationError):
            CreateGameRequest(game_type=name, metadata={**sent, "not_a_real_key": "x"})


@pytest.mark.parametrize("name", sorted(_REGISTRY))
def test_create_request_accepts_everything_the_app_sends(name: str) -> None:
    for sent in APP_SENT[name]:
        req = CreateGameRequest(game_type=name, metadata=sent)
        assert req.metadata == sent

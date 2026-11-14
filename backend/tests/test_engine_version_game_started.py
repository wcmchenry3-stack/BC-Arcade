"""``game_started`` carries ``engine_version`` for six more games (#3909, epic #3273).

Sudoku, Hearts, Yacht, 2048, Blackjack and Daily Word record an integer
``engine_version`` (the frontend ``ENGINE_VERSION``, starting at 1) in their
``game_started`` data, as Solitaire, FreeCell, Mahjong and Sort already do.
``validate_event`` stores lifecycle data as sent, so the field needs no model
change; a ``game_started`` from an older build, without it, is version 1.
The metadata models (``extra="forbid"``) still refuse it, so a client cannot
write it onto the game row.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from games.registry import _REGISTRY

# game_type -> the game_started data an older build sent (no engine_version).
LEGACY: dict[str, dict] = {
    "sudoku": {"difficulty": "easy", "variant": "classic", "puzzle": "0" * 81},
    "hearts": {
        "initial_score": 0,
        "preset": "mixed",
        "target": 100,
        "seats": ["human", "cautious", "schemer", "daring"],
    },
    "yacht": {"v": 1, "mode": "vs", "cpu_type": "oracle", "difficulty": "hard"},
    "twenty48": {"initial_board": [0] * 16},
    "blackjack": {"starting_chips": 1000},
    "daily_word": {"puzzle_id": "2026-05-03:en"},
}


def _current(game_type: str) -> dict:
    return {**LEGACY[game_type], "engine_version": 1}


def _version_of(data: dict) -> int:
    """A ``game_started`` without the field is version 1."""
    return data.get("engine_version", 1)


@pytest.mark.parametrize("game_type", sorted(LEGACY))
def test_game_started_with_engine_version_is_stored_as_sent(game_type: str) -> None:
    data = _current(game_type)
    assert _REGISTRY[game_type].validate_event("game_started", dict(data)) == data


@pytest.mark.parametrize("game_type", sorted(LEGACY))
def test_game_started_without_engine_version_is_still_accepted_as_version_1(
    game_type: str,
) -> None:
    data = dict(LEGACY[game_type])
    assert _REGISTRY[game_type].validate_event("game_started", data) == LEGACY[game_type]
    assert _version_of(data) == 1


@pytest.mark.parametrize("game_type", sorted(LEGACY))
def test_engine_version_is_not_accepted_as_row_metadata(game_type: str) -> None:
    with pytest.raises(ValidationError):
        _REGISTRY[game_type].metadata_model.model_validate({"engine_version": 1})


def test_the_sudoku_fixture_records_it_in_game_started() -> None:
    """The pinned fixture is what the app records today (the frontend test
    regenerates it); each game's start carries the version."""
    import json
    from pathlib import Path

    fixture = Path(__file__).parent / "fixtures" / "sudoku_entries_v1.json"
    games = json.loads(fixture.read_text(encoding="utf-8"))
    assert games
    for game in games.values():
        assert game["game_started"]["engine_version"] == 1

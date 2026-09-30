"""The generated public leaderboard names (#2778)."""

from __future__ import annotations

import re

import pytest

from db.models import PLAYER_DISPLAY_NAME_MAX_LENGTH
from players.generated import (
    ADJECTIVES,
    ANIMALS,
    NUMBER_MAX,
    NUMBER_MIN,
    generate_display_name,
    is_generated_display_name,
)


def test_word_lists_are_plain_unique_capitalised_words() -> None:
    for words in (ADJECTIVES, ANIMALS):
        assert len(words) == len(set(words))
        assert all(re.fullmatch(r"[A-Z][a-z]+", w) for w in words), words
    assert len(ADJECTIVES) >= 50 and len(ANIMALS) >= 50


def test_the_longest_possible_name_fits_the_column() -> None:
    longest = f"{max(ADJECTIVES, key=len)} {max(ANIMALS, key=len)} {NUMBER_MAX}"
    assert len(longest) <= PLAYER_DISPLAY_NAME_MAX_LENGTH


def test_generated_names_have_the_expected_shape() -> None:
    for _ in range(500):
        name = generate_display_name()
        assert is_generated_display_name(name), name
        adj, animal, number = name.split(" ")
        assert adj in ADJECTIVES and animal in ANIMALS
        assert NUMBER_MIN <= int(number) <= NUMBER_MAX


def test_exclude_always_yields_a_different_name(monkeypatch: pytest.MonkeyPatch) -> None:
    from players import generated

    draws = iter(["Brave Otter 10", "Brave Otter 10", "Calm Owl 11"])

    class FakeRng:
        def __init__(self) -> None:
            self.name = ""

        def choice(self, seq: tuple[str, ...]) -> str:
            if seq is ADJECTIVES:
                self.name = next(draws)
                return self.name.split(" ")[0]
            return self.name.split(" ")[1]

        def randint(self, _a: int, _b: int) -> int:
            return int(self.name.split(" ")[2])

    monkeypatch.setattr(generated, "_rng", FakeRng())
    assert generate_display_name(exclude="Brave Otter 10") == "Calm Owl 11"


@pytest.mark.parametrize(
    "name",
    [
        "Ada",
        "",
        "Brave Otter",
        "Brave Otter 9",
        "Brave Otter 10000",
        "Brave Otter 0123",
        "brave otter 42",
        "Brave  Otter 42",
        "Nasty Otter 42",
        "Brave Troll 42",
        " Brave Otter 42",
    ],
)
def test_other_text_is_not_a_generated_name(name: str) -> None:
    assert not is_generated_display_name(name)

"""The generated public leaderboard names (#2778)."""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path
from types import ModuleType

import pytest

from db.models import PLAYER_DISPLAY_NAME_MAX_LENGTH
from players.generated import (
    _BLOCKED_NUMBERS,
    ADJECTIVES,
    ANIMALS,
    NUMBER_MAX,
    NUMBER_MIN,
    _is_blocked_number,
    generate_display_name,
    is_generated_display_name,
)
from players.schemas import LEGACY_DEFAULT_NAMES, clean_display_name, is_default_legacy_name


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


# ---------------------------------------------------------------------------
# Numbers with an offensive meaning are never part of a name.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "number", [14, 18, 69, 88, 187, 311, 420, 666, 911, 1312, 1488, 1690, 4200, 6660, 2488]
)
def test_known_offensive_numbers_are_blocked(number: int) -> None:
    assert _is_blocked_number(number)
    assert number in _BLOCKED_NUMBERS


@pytest.mark.parametrize("number", [10, 11, 42, 100, 1234, 4821, 9999])
def test_ordinary_numbers_are_not_blocked(number: int) -> None:
    assert number not in _BLOCKED_NUMBERS


def test_the_validator_rejects_every_blocked_number() -> None:
    for number in sorted(_BLOCKED_NUMBERS):
        assert not is_generated_display_name(f"Brave Otter {number}"), number


def test_the_generator_never_emits_a_blocked_number(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every blocked number, when drawn, is redrawn until an allowed one comes up."""
    from players import generated

    for number in sorted(_BLOCKED_NUMBERS):
        draws = iter([number, 4821])

        class FakeRng:
            def choice(self, seq: tuple[str, ...]) -> str:
                return seq[0]

            def randint(self, _a: int, _b: int, _draws=draws) -> int:
                return next(_draws)

        monkeypatch.setattr(generated, "_rng", FakeRng())
        name = generate_display_name()
        assert name == f"{ADJECTIVES[0]} {ANIMALS[0]} 4821", (number, name)


def test_most_numbers_stay_available() -> None:
    assert len(_BLOCKED_NUMBERS) < (NUMBER_MAX - NUMBER_MIN + 1) // 10


# ---------------------------------------------------------------------------
# Migration 0030 keeps literal copies of the lists; they must match the app's.
# ---------------------------------------------------------------------------


def _migration_0030() -> ModuleType:
    path = (
        Path(__file__).resolve().parent.parent
        / "alembic"
        / "versions"
        / "0030_generated_player_names.py"
    )
    spec = importlib.util.spec_from_file_location("_mig_0030_parity", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_0030_copies_match_the_app() -> None:
    migration = _migration_0030()
    assert migration._ADJECTIVES == ADJECTIVES
    assert migration._ANIMALS == ANIMALS
    assert (migration._NUMBER_MIN, migration._NUMBER_MAX) == (NUMBER_MIN, NUMBER_MAX)
    assert migration._BLOCKED_NUMBERS == _BLOCKED_NUMBERS
    assert migration._DEFAULT_NAMES == LEGACY_DEFAULT_NAMES


def test_migration_0030_names_are_valid_generated_names() -> None:
    migration = _migration_0030()
    for _ in range(500):
        assert is_generated_display_name(migration.generated_name())


# ---------------------------------------------------------------------------
# Defaults an older build filled in are not a choice to join (#2778 review).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    ["", "  ", "You", "you", " YOU ", "Player", "player 1", "Player1", "Guest", "Anonymous",
     "anon", "Me"],
)  # fmt: skip
def test_default_legacy_names_are_recognised(name: str) -> None:
    assert is_default_legacy_name(name)


@pytest.mark.parametrize("name", ["Ada", "Player 2", "Guesty", "Youth", "Mei"])
def test_chosen_legacy_names_are_not_defaults(name: str) -> None:
    assert not is_default_legacy_name(name)


@pytest.mark.parametrize(
    ("raw", "expected"), [("  Ada ", "Ada"), ("   ", None), ("", None), (None, None), (42, None)]
)
def test_clean_display_name_is_a_non_blank_string_check(raw: object, expected: str | None) -> None:
    assert clean_display_name(raw) == expected

"""Generation quality tests for new color tiers 9–14 (#1576).

Validates that _build_level_fast reliably produces non-trivial, practically
solvable states for the full 9–14 color range including 1-empty tier entries.
"""

import random

import pytest

from sort.generate_levels import (
    COLORS_10,
    COLORS_11,
    COLORS_12,
    COLORS_13,
    COLORS_14,
    COLORS_5,
    COLORS_6,
    COLORS_7,
    COLORS_8,
    COLORS_9,
    _build_level_fast,
    _is_likely_solvable,
    _is_trivial,
)

# Tiers that use 1-empty in LEVEL_SPECS and go through _build_level_fast
# (≤4c use generate_level with full BFS and are not covered here).
_ONE_EMPTY_TIERS = [COLORS_5, COLORS_6, COLORS_7, COLORS_8, COLORS_9]
_TWO_EMPTY_TIERS = [COLORS_10, COLORS_11, COLORS_12, COLORS_13, COLORS_14]
_N_SAMPLES = 15


@pytest.mark.parametrize("colors", _ONE_EMPTY_TIERS, ids=lambda c: f"{len(c)}c")
@pytest.mark.parametrize("n_empty", [1, 2], ids=lambda e: f"{e}e")
def test_fast_generation_non_trivial_low_tiers(colors: list[str], n_empty: int) -> None:
    """_build_level_fast must produce non-trivial states for 5–9c (both empty counts)."""
    rng = random.Random(42)
    for _ in range(_N_SAMPLES):
        state = _build_level_fast(colors, n_empty, rng)
        assert not _is_trivial(state), (
            f"{len(colors)} colors, {n_empty} empty: got trivially-solved state"
        )


@pytest.mark.parametrize("colors", _TWO_EMPTY_TIERS, ids=lambda c: f"{len(c)}c")
def test_fast_generation_non_trivial_high_tiers(colors: list[str]) -> None:
    """_build_level_fast must produce non-trivial states for 10–14c (2 empties)."""
    rng = random.Random(42)
    for _ in range(_N_SAMPLES):
        state = _build_level_fast(colors, 2, rng)
        assert not _is_trivial(state), (
            f"{len(colors)} colors, 2 empty: got trivially-solved state"
        )


@pytest.mark.parametrize("colors", _ONE_EMPTY_TIERS, ids=lambda c: f"{len(c)}c")
@pytest.mark.parametrize("n_empty", [1, 2], ids=lambda e: f"{e}e")
def test_fast_generation_correct_bottle_count_low_tiers(colors: list[str], n_empty: int) -> None:
    """Generated state must have len(colors) + n_empty bottles (5–9c tiers)."""
    rng = random.Random(7)
    state = _build_level_fast(colors, n_empty, rng)
    assert len(state) == len(colors) + n_empty


@pytest.mark.parametrize("colors", _TWO_EMPTY_TIERS, ids=lambda c: f"{len(c)}c")
def test_fast_generation_correct_bottle_count_high_tiers(colors: list[str]) -> None:
    """Generated state must have len(colors) + 2 bottles (10–14c tiers)."""
    rng = random.Random(7)
    state = _build_level_fast(colors, 2, rng)
    assert len(state) == len(colors) + 2


@pytest.mark.parametrize("colors", _ONE_EMPTY_TIERS, ids=lambda c: f"{len(c)}c")
def test_fast_generation_1e_is_likely_solvable(colors: list[str]) -> None:
    """Every 1-empty state returned by _build_level_fast must pass _is_likely_solvable.

    Covers all 5–9c tiers that use n_empty=1 in LEVEL_SPECS. Tiers ≥10c are
    excluded: random 1-empty generation is unreliable there, so LEVEL_SPECS
    only assigns them 2-empty slots.
    """
    rng = random.Random(99)
    for _ in range(_N_SAMPLES):
        state = _build_level_fast(colors, 1, rng)
        assert _is_likely_solvable(state), (
            f"{len(colors)} colors, 1 empty: generated state failed solvability check"
        )


@pytest.mark.parametrize("colors", _TWO_EMPTY_TIERS, ids=lambda c: f"{len(c)}c")
def test_fast_generation_2e_is_likely_solvable(colors: list[str]) -> None:
    """Every 2-empty state at 10–14c must pass _is_likely_solvable."""
    rng = random.Random(99)
    for _ in range(_N_SAMPLES):
        state = _build_level_fast(colors, 2, rng)
        assert _is_likely_solvable(state), (
            f"{len(colors)} colors, 2 empty: generated state failed solvability check"
        )

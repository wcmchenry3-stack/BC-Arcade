"""The fast Sort solver agrees with the plain BFS and decides big levels (#2764)."""

from __future__ import annotations

import random

import pytest

from sort.fast_solver import encode, heuristic, solve, successors
from sort.generate_levels import build_levels
from sort.verify_levels import bfs_solvable

_COLORS = [chr(97 + i) for i in range(8)]


def _deal(rng: random.Random, n_colors: int, n_empty: int) -> list[list[str]]:
    units = [c for c in _COLORS[:n_colors] for _ in range(4)]
    rng.shuffle(units)
    return [units[i * 4 : (i + 1) * 4] for i in range(n_colors)] + [[] for _ in range(n_empty)]


def test_agrees_with_reference_bfs_on_small_deals() -> None:
    # One empty bottle and up to six colours: the plain BFS decides every one,
    # and roughly half are unsolvable, so both verdicts are exercised.
    rng = random.Random(2764)
    verdicts = set()
    for _ in range(150):
        bottles = _deal(rng, rng.choice([3, 4, 5, 6]), 1)
        expected, _ = bfs_solvable([list(b) for b in bottles])
        assert expected is not None
        got, _ = solve(bottles)
        assert got == expected, bottles
        verdicts.add(got)
    assert verdicts == {True, False}


def test_proves_the_known_dead_level_unsolvable() -> None:
    # build_levels(42) level 21: 14 colours, 2 empty bottles (#2764).
    level = build_levels(42)[20]
    assert level["id"] == 21
    verdict, seen = solve(level["bottles"])
    assert verdict is False
    assert seen < 50_000


def test_solves_a_fourteen_colour_level() -> None:
    level = build_levels(42)[22]
    assert level["id"] == 23
    assert solve(level["bottles"])[0] is True


def test_budget_exhausted_is_unknown() -> None:
    level = build_levels(42)[20]
    assert solve(level["bottles"], budget=10) == (None, 10)


@pytest.mark.parametrize(
    "bottles",
    [
        [["red"] * 4, ["", "", "", ""]],
        [[], []],
    ],
)
def test_already_solved(bottles: list[list[str]]) -> None:
    assert solve(bottles)[0] is True


def test_state_is_permutation_free_and_drops_full_bottles() -> None:
    a = encode([["red", "blue"], ["blue"] * 4, [], ["blue", "red"]])
    b = encode([["blue", "red"], [], ["red", "blue"]])
    assert a == b == ("", "AB", "BA")


def test_successors_skip_symmetric_pours() -> None:
    # A single-colour bottle into an empty one only permutes bottles, and the
    # second empty bottle is never a separate target.
    state = encode([["red", "red"], [], [], ["blue", "red"]])
    moves = successors(state)
    assert all(nxt != state for _, _, nxt in moves)
    targets = {(state[i], state[j]) for i, j, _ in moves}
    assert ("AA", "") not in targets  # the uniform red pair stays put
    assert len([t for t in targets if t[1] == ""]) == 1
    assert heuristic(state) == 1

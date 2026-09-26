"""The fast Sort solver agrees with the plain BFS and decides big levels (#2764)."""

from __future__ import annotations

import random

import pytest

from sort.fast_solver import encode, heuristic, solve, successors
from sort.generate_levels import build_levels
from sort.verify_levels import bfs_solvable

_COLORS = [chr(97 + i) for i in range(8)]

# Level 21 of build_levels(42) before #2764: 14 colours, 2 empty bottles, no
# solution. The generator now rejects deals like it, so it is kept here.
_DEAD_14C = [
    ["teal", "blue", "purple", "indigo"],
    ["red", "teal", "gold", "green"],
    ["navy", "orange", "orange", "brown"],
    ["purple", "yellow", "indigo", "gold"],
    ["navy", "pink", "blue", "green"],
    ["red", "yellow", "lime", "pink"],
    ["gold", "maroon", "yellow", "indigo"],
    ["purple", "pink", "green", "blue"],
    ["brown", "orange", "maroon", "red"],
    ["lime", "navy", "indigo", "maroon"],
    ["maroon", "teal", "gold", "orange"],
    ["green", "purple", "teal", "brown"],
    ["red", "pink", "blue", "yellow"],
    ["lime", "lime", "navy", "brown"],
    ["", "", "", ""],
    ["", "", "", ""],
]


def _deal(rng: random.Random, n_colors: int, n_empty: int) -> list[list[str]]:
    units = [c for c in _COLORS[:n_colors] for _ in range(4)]
    rng.shuffle(units)
    return [units[i * 4 : (i + 1) * 4] for i in range(n_colors)] + [[] for _ in range(n_empty)]


@pytest.mark.parametrize(("sizes", "n_empty"), [([3, 4, 5, 6], 1), ([3, 4], 2)])
def test_agrees_with_reference_bfs_on_small_deals(sizes: list[int], n_empty: int) -> None:
    # Small enough for the plain BFS to decide every deal. With one empty
    # bottle roughly half are unsolvable, so both verdicts are exercised; two
    # empty bottles exercise the pruning of equivalent empty targets.
    rng = random.Random(2764 + n_empty)
    verdicts = set()
    for _ in range(150 if n_empty == 1 else 40):
        bottles = _deal(rng, rng.choice(sizes), n_empty)
        expected, _ = bfs_solvable([list(b) for b in bottles])
        assert expected is not None
        got, _ = solve(bottles)
        assert got == expected, bottles
        verdicts.add(got)
    assert verdicts == ({True, False} if n_empty == 1 else {True})


def test_proves_the_known_dead_level_unsolvable() -> None:
    verdict, seen = solve(_DEAD_14C)
    assert verdict is False
    assert seen == 13_960  # the whole reachable space, bottle order ignored


def test_solves_a_fourteen_colour_level() -> None:
    level = build_levels(42)[22]
    assert level["id"] == 23
    assert solve(level["bottles"])[0] is True


def test_budget_exhausted_is_unknown() -> None:
    assert solve(_DEAD_14C, budget=10) == (None, 10)


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

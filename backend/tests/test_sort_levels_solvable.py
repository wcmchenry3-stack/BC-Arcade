"""The levels ``GET /sort/levels`` serves are solvable (#2746, #2764).

``build_levels()`` runs per request with no seed, and ``levels.json`` is gone,
so this is the automated check: build fixed-seed sets and prove every level of
every set solvable.

* ``sort.fast_solver`` decides every level, whatever its size, and must find a
  solution: an unsolvable or undecided level fails.
* The small levels are also proven with the reference BFS in
  ``sort/verify_levels.py``, written independently of ``fast_solver`` (which
  the generator itself uses).
"""

from __future__ import annotations

import pytest

from sort.fast_solver import solve
from sort.generate_levels import LEVEL_SPECS, SOLVER_BUDGET, build_levels
from sort.verify_levels import _from_json, bfs_solvable

# Fixed seeds, so a failure names a set that can be rebuilt exactly.
_SEEDS = list(range(20))
_BFS_SEEDS = [0, 1, 2]

# One empty bottle, or four colors or fewer: at most ~11,000 BFS states each.
_CHEAP_LEVELS = frozenset(
    level_id for level_id, colors, n_empty in LEVEL_SPECS if n_empty == 1 or len(colors) <= 4
)


def test_cheap_levels_cover_every_one_empty_level() -> None:
    assert _CHEAP_LEVELS == {1, 2, 3, 4, 5, 7, 9, 10, 12, 14, 16}


@pytest.mark.parametrize("seed", _SEEDS)
def test_every_level_is_proven_solvable(seed: int) -> None:
    levels = build_levels(seed)
    assert [level["id"] for level in levels] == [spec[0] for spec in LEVEL_SPECS]
    for level in levels:
        verdict, seen = solve(level["bottles"], SOLVER_BUDGET)
        # False is a proof of no solution; None means the budget ran out.
        assert verdict is True, f"seed {seed}, level {level['id']}: {verdict} after {seen} states"


@pytest.mark.parametrize("seed", _BFS_SEEDS)
def test_cheap_levels_are_solvable_by_reference_bfs(seed: int) -> None:
    for level in build_levels(seed):
        if level["id"] not in _CHEAP_LEVELS:
            continue
        solvable, explored = bfs_solvable(_from_json(level["bottles"]))
        # None would mean the search hit its cap: not a proof either way.
        assert (
            solvable is True
        ), f"seed {seed}, level {level['id']}: solvable={solvable} after {explored} states"

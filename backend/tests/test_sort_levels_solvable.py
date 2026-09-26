"""The levels ``GET /sort/levels`` serves are solvable (#2746).

``build_levels()`` runs per request with no seed, and ``levels.json`` is gone,
so this is the automated check: build a few fixed-seed sets and prove, with
the verifier's own BFS (``sort/verify_levels.py``, independent of the
generator's checks), that every level cheap enough to search exhaustively has
a solution.

Known gap (#2764): the levels with two empty bottles and five or more colors
(6, 8, 11, 13, 15 and 17-23) are not covered. Their state spaces run past
50,000 states, too slow for CI, and the generator does not prove them
solvable either: 10-14 color levels are assumed solvable, and ``build_levels(42)``
level 21 is provably not. Run ``python -m sort.verify_levels --runs N`` for a
capped manual check of those.
"""

from __future__ import annotations

import pytest

from sort.generate_levels import LEVEL_SPECS, build_levels
from sort.verify_levels import _from_json, bfs_solvable

# Fixed seeds, so a failure names a set that can be rebuilt exactly.
_SEEDS = [0, 1, 2]

# One empty bottle, or four colors or fewer: at most ~11,000 states each.
_CHEAP_LEVELS = frozenset(
    level_id for level_id, colors, n_empty in LEVEL_SPECS if n_empty == 1 or len(colors) <= 4
)


def test_cheap_levels_cover_every_one_empty_level() -> None:
    assert _CHEAP_LEVELS == {1, 2, 3, 4, 5, 7, 9, 10, 12, 14, 16}


@pytest.mark.parametrize("seed", _SEEDS)
def test_built_levels_are_solvable(seed: int) -> None:
    levels = build_levels(seed)
    assert [level["id"] for level in levels] == [spec[0] for spec in LEVEL_SPECS]
    for level in levels:
        if level["id"] not in _CHEAP_LEVELS:
            continue
        solvable, explored = bfs_solvable(_from_json(level["bottles"]))
        # None would mean the search hit its cap: not a proof either way.
        assert (
            solvable is True
        ), f"seed {seed}, level {level['id']}: solvable={solvable} after {explored} states"

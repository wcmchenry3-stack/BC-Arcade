"""Sort's fixed level catalog (#2761).

``frontend/src/game/sort/levels.catalog.json`` is the 120 levels every player
gets, shipped in the app. It is built by ``scripts/sort_build_catalog.py``
(run from ``backend/``); these tests regenerate it in memory, so the file
can't drift from the script, and prove every level solvable with a solution
replayed by the reference simulator, independent of the solver's pruning.
"""

from __future__ import annotations

import json
import math
import sys
from collections import Counter
from pathlib import Path

import pytest

from sort.catalog import CATALOG_VERSION, CHAPTER_SIZE, LEVEL_COUNT
from sort.fast_solver import DEPTH, solve
from sort.generate_levels import COLORS_14, SOLVER_BUDGET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import sort_build_catalog as build
from sort_verify_levels import is_solution

_CATALOG = json.loads(build.CATALOG_PATH.read_text())
_LEVELS = [(build.decode(bottles), par) for bottles, par in _CATALOG["levels"]]


def test_committed_catalog_is_current() -> None:
    """Same seed, same file, byte for byte."""
    expected = build.render(build.build_catalog())
    assert (
        build.CATALOG_PATH.read_text() == expected
    ), "levels.catalog.json is stale: run `python scripts/sort_build_catalog.py`"


def test_catalog_shape_matches_the_server() -> None:
    assert _CATALOG["version"] == CATALOG_VERSION
    assert _CATALOG["seed"] == build.SEED
    assert _CATALOG["legend"] == COLORS_14
    assert len(_LEVELS) == LEVEL_COUNT == len(build.CHAPTERS) * CHAPTER_SIZE
    # Compact enough to ship in the app bundle.
    assert len(build.CATALOG_PATH.read_bytes()) < 12_000


@pytest.mark.parametrize("n", range(1, LEVEL_COUNT + 1))
def test_every_level_is_solvable_and_its_par_is_the_stated_slack(n: int) -> None:
    bottles, par = _LEVELS[n - 1]
    result = solve(bottles, SOLVER_BUDGET)
    assert result.solvable is True and result.pours is not None
    # A certificate: the solver's pours replay as legal moves to a solved board.
    assert is_solution(bottles, result.pours)
    assert par == math.ceil(len(result.pours) * build.PAR_SLACK - 1e-9)
    assert par >= len(result.pours)


def test_levels_follow_the_curve() -> None:
    for (bottles, _), (colours, empties) in zip(_LEVELS, build.level_specs(), strict=True):
        full = [b for b in bottles if b]
        assert len(full) == colours and len(bottles) == colours + empties
        assert all(len(b) == DEPTH for b in full)
        assert Counter(c for b in full for c in b) == {c: DEPTH for c in COLORS_14[:colours]}
        # Never already solved.
        assert any(len(set(b)) > 1 for b in full)


def test_curve_spans_three_to_fourteen_colours_and_rises_by_chapter() -> None:
    specs = build.level_specs()
    assert specs[0][0] == 3 and specs[-1][0] == 14
    assert {e for _, e in specs} == {1, 2}
    # One empty bottle stops at 9 colours (random 1-empty deals above are ~all dead).
    assert max(c for c, e in specs if e == 1) == 9
    pars = [par for _, par in _LEVELS]
    chapters = [pars[k : k + CHAPTER_SIZE] for k in range(0, LEVEL_COUNT, CHAPTER_SIZE)]
    means = [sum(c) / len(c) for c in chapters]
    assert means == sorted(means), means
    # Within a chapter the second half is harder than the first.
    for chapter in chapters:
        half = CHAPTER_SIZE // 2
        assert sum(chapter[half:]) > sum(chapter[:half])


def test_no_two_levels_are_the_same_puzzle() -> None:
    keys = [build.canonical(tuple(bottles.split(","))) for bottles, _ in _CATALOG["levels"]]
    assert len(set(keys)) == len(keys)


def test_canonical_ignores_colour_names_and_bottle_order() -> None:
    level = ("ABCA", "BCAB", "CABC", "", "")
    relabelled = ("", "CABC", "BCAB", "ABCA", "")  # bottle order
    renamed = tuple(b.translate(str.maketrans("ABC", "CAB")) for b in level)  # colour names
    assert build.canonical(level) == build.canonical(relabelled) == build.canonical(renamed)
    assert build.canonical(level) != build.canonical(("ABCA", "BCAB", "CACB", "", ""))
    # Above six colours the key is the cheap one: still blind to bottle order.
    eight = ("ABCD", "EFGH", "HGFE", "DCBA", "ABCD", "EFGH", "HGFE", "DCBA", "", "")
    assert build.canonical(eight) == build.canonical(tuple(reversed(eight)))


def test_pick_takes_the_nearest_unused_candidate() -> None:
    pool = [
        build.Candidate(order=i, state=(str(i),), length=i, trap=0.0, openings=1) for i in range(5)
    ]
    used: set[int] = set()
    assert build.pick(pool, 0.5, used).order == 2
    assert build.pick(pool, 0.5, used).order == 1  # lower on a tie
    assert build.pick(pool, 0.5, used).order == 3
    assert build.pick(pool, 1.0, used).order == 4
    assert build.pick(pool, 0.0, used).order == 0
    with pytest.raises(AssertionError):
        build.pick(pool, 0.5, used)


def test_rank_orders_by_trap_rate_then_length_then_fewer_openings() -> None:
    def cand(order: int, trap: float, length: int, openings: int) -> build.Candidate:
        return build.Candidate(order, (str(order),), length, trap, openings)

    easy, mid, hard = cand(0, 0.0, 10, 4), cand(1, 0.5, 12, 4), cand(2, 1.0, 14, 4)
    assert build.rank([hard, easy, mid]) == [easy, mid, hard]
    many, few = cand(3, 0.5, 12, 6), cand(4, 0.5, 12, 2)
    assert build.rank([few, many]) == [many, few]

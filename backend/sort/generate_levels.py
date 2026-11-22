"""Deal Sort Puzzle boards, each proven solvable.

``deal_level`` is how ``scripts/sort_build_catalog.py`` deals the fixed level
catalog's candidates (#2761). The app ships that catalog and never fetches
levels (the random-level ``GET /sort/levels`` was removed in #3729).

Every board is a uniform random shuffle of its colours, dealt again until
``sort.fast_solver`` proves it has a solution (#2764). A deal the solver proves
dead, or can't decide within ``SOLVER_BUDGET`` states, is thrown away, so no
level is ever accepted on an assumption. If ``MAX_ATTEMPTS`` deals all fail,
``deal_level`` logs and raises ``LevelGenerationError`` rather than return an
unverified board.
"""

from __future__ import annotations

import logging
import random

from sort.fast_solver import DEPTH, solve

logger = logging.getLogger(__name__)


# Distinct states the solver may visit per deal before giving up (verdict
# "unknown", which is rejected like a dead deal). Across 5,000 raw shuffles of
# every configuration the catalog uses the most any deal needed was 40,340 (a dead
# 14-colour deal); solvable ones were decided in at most 27,914. Five times the
# observed maximum, and it only bounds the time spent on a pathological deal:
# the budget can never let an undecided level through.
SOLVER_BUDGET = 200_000

# Deals tried per level before giving up (``deal_level``'s default). The hardest configuration is 9
# colours with one empty bottle, where about 1% of random shuffles are
# solvable (52 of 5,000 measured): the chance that 5,000 deals in a row fail is
# about (1 - 0.0104) ** 5000, around 1e-23. The other configurations are far
# likelier to succeed.
MAX_ATTEMPTS = 5_000


class LevelGenerationError(RuntimeError):
    """No solvable deal of a level was found within ``MAX_ATTEMPTS``."""


def _solved(state: list[list[str]]) -> bool:
    """True when every non-empty bottle is full of one colour."""
    return all(not b or (len(b) == DEPTH and len(set(b)) == 1) for b in state)


def deal_level(
    colors: list[str],
    n_empty: int,
    rng: random.Random,
    max_attempts: int = MAX_ATTEMPTS,
) -> list[list[str]]:
    """A random, non-trivial deal of ``colors`` that the solver proves solvable."""
    units = [c for c in colors for _ in range(DEPTH)]
    for _ in range(max_attempts):
        rng.shuffle(units)
        state: list[list[str]] = [
            list(units[i * DEPTH : (i + 1) * DEPTH]) for i in range(len(colors))
        ]
        state += [[] for _ in range(n_empty)]
        if _solved(state):
            continue
        if solve(state, SOLVER_BUDGET).solvable is True:
            return state
    logger.error(
        "sort: no provably solvable deal in %d attempts (%d colors, %d empty)",
        max_attempts,
        len(colors),
        n_empty,
    )
    raise LevelGenerationError(
        f"No provably solvable level found after {max_attempts} attempts "
        f"({len(colors)} colors, {n_empty} empty)"
    )


COLORS_3 = ["red", "blue", "green"]
COLORS_4 = ["red", "blue", "green", "yellow"]
COLORS_5 = ["red", "blue", "green", "yellow", "orange"]
COLORS_6 = ["red", "blue", "green", "yellow", "orange", "purple"]
COLORS_7 = ["red", "blue", "green", "yellow", "orange", "purple", "pink"]
COLORS_8 = ["red", "blue", "green", "yellow", "orange", "purple", "pink", "teal"]
COLORS_9 = [*COLORS_8, "brown"]
COLORS_10 = [*COLORS_9, "lime"]
COLORS_11 = [*COLORS_10, "navy"]
COLORS_12 = [*COLORS_11, "maroon"]
COLORS_13 = [*COLORS_12, "gold"]
COLORS_14 = [*COLORS_13, "indigo"]

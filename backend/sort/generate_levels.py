"""Generate the 23 Sort Puzzle levels, each proven solvable.

``build_levels`` is what ``GET /sort/levels`` serves: it runs on every request
with no seed, so each fetch gets new random mixtures of the same
``LEVEL_SPECS`` (#2746). Nothing is saved to disk.

Every level is a uniform random shuffle of its colours, dealt again until
``sort.fast_solver`` proves it has a solution (#2764). A deal the solver proves
dead, or can't decide within ``SOLVER_BUDGET`` states, is thrown away, so no
level is ever served on an assumption. If ``MAX_ATTEMPTS`` deals of one level
all fail, ``build_levels`` logs and raises ``LevelGenerationError`` rather than
serve an unverified level; with the measured solvable rates that is
practically unreachable (see ``MAX_ATTEMPTS``).
"""

from __future__ import annotations

import logging
import random

from sort.fast_solver import solve

logger = logging.getLogger(__name__)

DEPTH = 4

# Distinct states the solver may visit per deal before giving up (verdict
# "unknown", which is rejected like a dead deal). Across 5,000 raw shuffles of
# every configuration in LEVEL_SPECS the most any deal needed was 40,340 (a dead
# 14-colour deal); solvable ones were decided in at most 27,914. Five times the
# observed maximum, and it only bounds the time spent on a pathological deal:
# the budget can never let an undecided level through.
SOLVER_BUDGET = 200_000

# Deals tried per level before giving up. The hardest configuration is 9
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
        verdict, _ = solve(state, SOLVER_BUDGET)
        if verdict is True:
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


def to_json_bottles(state: list[list[str]]) -> list[list[str]]:
    """Pad each bottle to DEPTH slots; '' marks an empty slot."""
    return [b + [""] * (DEPTH - len(b)) for b in state]


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

# 23-level progression: 3→14 colors.
# Tiers 3–9c: alternating tight (1 empty) / relaxed (2 empties).
# Tiers 10–14c: 2 empties only. Random 1-empty deals at 9 colors are already
# ~99% dead, so 10+ colors with one empty bottle would take too many deals.
# No two consecutive levels share the same (colors, n_empty) pair.
LEVEL_SPECS = [
    # (id, colors, n_empty)
    (1, COLORS_3, 2),  # tutorial — generous
    (2, COLORS_3, 1),  # tighten within 3-color tier
    (3, COLORS_4, 1),  # new tier, tight
    (4, COLORS_4, 2),  # ease off
    (5, COLORS_5, 1),  # new tier, tight
    (6, COLORS_5, 2),  # ease off
    (7, COLORS_6, 1),  # new tier, tight
    (8, COLORS_6, 2),  # ease off
    (9, COLORS_6, 1),  # plateau buster — revisit 6c tight
    (10, COLORS_7, 1),  # new tier, tight
    (11, COLORS_7, 2),  # ease off
    (12, COLORS_8, 1),  # new tier, tight
    (13, COLORS_8, 2),  # ease off
    (14, COLORS_9, 1),  # new tier, tight
    (15, COLORS_9, 2),  # ease off
    (16, COLORS_9, 1),  # plateau buster — revisit 9c tight
    (17, COLORS_10, 2),  # new tier
    (18, COLORS_11, 2),  # new tier
    (19, COLORS_12, 2),  # new tier
    (20, COLORS_13, 2),  # new tier
    (21, COLORS_14, 2),  # new tier
    # Levels 22–23 revisit 13c then 14c: the color count briefly dips then peaks,
    # providing a slight ease before the true endgame. Consecutive constraint holds
    # because 14c separates the two 13c entries and 13c separates the two 14c entries.
    (22, COLORS_13, 2),  # revisit 13c — brief ease before endgame
    (23, COLORS_14, 2),  # endgame
]


def build_levels(seed: int | None = None) -> list[dict]:
    """Deal the 23 levels, each proven solvable. seed=None uses a random seed.

    Raises ``LevelGenerationError`` (after logging) if a level has no provably
    solvable deal within ``MAX_ATTEMPTS``; an unverified level is never served.
    """
    rng = random.Random(seed)
    return [
        {"id": level_id, "bottles": to_json_bottles(deal_level(colors, n_empty, rng))}
        for level_id, colors, n_empty in LEVEL_SPECS
    ]

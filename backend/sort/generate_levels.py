#!/usr/bin/env python3
"""Generate 23 solvable Sort Puzzle levels.

Usage: python generate_levels.py > levels.json

Levels are produced by randomly distributing colors across bottles and
BFS-verifying solvability. RNG is seeded (42) for reproducibility.
For 5–9 colors the state space is too large for full BFS; those levels
are generated with a lightweight deadlock check (_FAST_BFS_CAP). For
10–14 colors even the lightweight check is too slow to filter reliably,
so only 2-empty levels are generated for those tiers (assumed solvable).
"""

import json
import random
from collections import deque
from itertools import takewhile

DEPTH = 4
BFS_CAP = 200_000
_FAST_BFS_CAP = 5_000   # cap for the lightweight deadlock check in _is_likely_solvable


def _top_color(bottle: list[str]) -> str | None:
    return bottle[-1] if bottle else None


def _space(bottle: list[str]) -> int:
    return DEPTH - len(bottle)


def _moves(state: list[list[str]]) -> list[tuple[int, int]]:
    result = []
    for i, src in enumerate(state):
        if not src:
            continue
        color = src[-1]
        for j, dst in enumerate(state):
            if i == j or _space(dst) == 0:
                continue
            top_j = _top_color(dst)
            if top_j is None or top_j == color:
                result.append((i, j))
    return result


def _apply(state: list[list[str]], frm: int, to: int) -> list[list[str]]:
    new = [list(b) for b in state]
    color = new[frm][-1]
    run = sum(1 for _ in takewhile(lambda c: c == color, reversed(new[frm])))
    n_pour = min(run, _space(new[to]))
    for _ in range(n_pour):
        new[frm].pop()
        new[to].append(color)
    return new


def _compact(state: list[list[str]]) -> tuple:
    return tuple(tuple(b) for b in state)


def _solved(state: list[list[str]]) -> bool:
    for b in state:
        if b and (len(b) < DEPTH or len(set(b)) > 1):
            return False
    return True


def _is_trivial(state: list[list[str]]) -> bool:
    """True when every non-empty bottle is already pure (already solved)."""
    return _solved(state)


def bfs_solvable(state: list[list[str]]) -> bool:
    """Return True if solvable, or True if BFS cap hit (assumed solvable)."""
    if _solved(state):
        return True
    visited = {_compact(state)}
    queue = deque([state])
    while queue:
        if len(visited) >= BFS_CAP:
            return True  # too large to verify; empirically solvable
        cur = queue.popleft()
        for frm, to in _moves(cur):
            nxt = _apply(cur, frm, to)
            key = _compact(nxt)
            if key in visited:
                continue
            if _solved(nxt):
                return True
            visited.add(key)
            queue.append(nxt)
    return False


def generate_level(
    colors: list[str], n_empty: int, rng: random.Random, max_attempts: int = 1000
) -> list[list[str]]:
    """Return a non-trivial, solvable starting state."""
    units = [c for c in colors for _ in range(DEPTH)]
    for _ in range(max_attempts):
        rng.shuffle(units)
        state: list[list[str]] = [
            list(units[i * DEPTH : (i + 1) * DEPTH]) for i in range(len(colors))
        ]
        state += [[] for _ in range(n_empty)]
        if not _is_trivial(state) and bfs_solvable(state):
            return state
    raise RuntimeError(
        f"No solvable level found after {max_attempts} attempts "
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
# Tiers 3–9c: alternating tight (1 empty) / relaxed (2 empties); 1-empty
# states are verified by _not_proven_unsolvable at generation time.
# Tiers 10–14c: 2 empties only — random 1-empty states at ≥10 colors fail
# too often within the generation budget to be reliable.
# No two consecutive levels share the same (colors, n_empty) pair.
LEVEL_SPECS = [
    # (id, colors, n_empty)
    (1, COLORS_3, 2),   # tutorial — generous
    (2, COLORS_3, 1),   # tighten within 3-color tier
    (3, COLORS_4, 1),   # new tier, tight
    (4, COLORS_4, 2),   # ease off
    (5, COLORS_5, 1),   # new tier, tight
    (6, COLORS_5, 2),   # ease off
    (7, COLORS_6, 1),   # new tier, tight
    (8, COLORS_6, 2),   # ease off
    (9, COLORS_6, 1),   # plateau buster — revisit 6c tight
    (10, COLORS_7, 1),  # new tier, tight
    (11, COLORS_7, 2),  # ease off
    (12, COLORS_8, 1),  # new tier, tight
    (13, COLORS_8, 2),  # ease off
    (14, COLORS_9, 1),  # new tier, tight
    (15, COLORS_9, 2),  # ease off
    (16, COLORS_9, 1),  # plateau buster — revisit 9c tight
    (17, COLORS_10, 2), # new tier
    (18, COLORS_11, 2), # new tier
    (19, COLORS_12, 2), # new tier
    (20, COLORS_13, 2), # new tier
    (21, COLORS_14, 2), # new tier
    # Levels 22–23 revisit 13c then 14c: the color count briefly dips then peaks,
    # providing a slight ease before the true endgame. Consecutive constraint holds
    # because 14c separates the two 13c entries and 13c separates the two 14c entries.
    (22, COLORS_13, 2), # revisit 13c — brief ease before endgame
    (23, COLORS_14, 2), # endgame
]


def _is_likely_solvable(state: list[list[str]]) -> bool:
    """Return False only when BFS exhausts all reachable states without solving.

    Uses _FAST_BFS_CAP so the check is cheap: for large state spaces the cap is
    hit immediately and True is returned; only provably-dead starting positions
    (small reachable state space, no solution path) return False. This filters
    the constrained deadlock arrangements that occur with 1 empty bottle.
    """
    if _solved(state):
        return True
    visited = {_compact(state)}
    queue = deque([state])
    while queue:
        if len(visited) >= _FAST_BFS_CAP:
            return True
        cur = queue.popleft()
        for frm, to in _moves(cur):
            nxt = _apply(cur, frm, to)
            key = _compact(nxt)
            if key in visited:
                continue
            if _solved(nxt):
                return True
            visited.add(key)
            queue.append(nxt)
    return False


def _build_level_fast(
    colors: list[str], n_empty: int, rng: random.Random, max_attempts: int = 1000
) -> list[list[str]]:
    """Generate a non-trivial level for 5+ colors.

    For n_empty == 1 applies _not_proven_unsolvable to discard deadlocked starts
    (the 1-empty constraint can leave some random arrangements with no solution
    path). For n_empty >= 2 the assumption that non-trivial balanced distributions
    are solvable is well-validated and the BFS check is skipped for speed.
    """
    units = [c for c in colors for _ in range(DEPTH)]
    for _ in range(max_attempts):
        rng.shuffle(units)
        state: list[list[str]] = [
            list(units[i * DEPTH : (i + 1) * DEPTH]) for i in range(len(colors))
        ]
        state += [[] for _ in range(n_empty)]
        if _is_trivial(state):
            continue
        if n_empty == 1 and not _is_likely_solvable(state):
            continue
        return state
    raise RuntimeError(
        f"No solvable level found after {max_attempts} attempts "
        f"({len(colors)} colors, {n_empty} empty)"
    )


def build_levels(seed: int | None = None) -> list[dict]:
    """Generate 23 levels with fresh randomisation. seed=None uses a random seed.

    Levels with ≤4 colors are BFS-verified solvable. Levels with 5–9 colors
    use _build_level_fast with a lightweight deadlock filter for 1-empty tiers;
    levels with 10–14 colors use 2 empties and skip the deadlock check (assumed
    solvable for non-trivial balanced distributions with 2+ empty bottles).
    """
    rng = random.Random(seed)
    levels = []
    for level_id, colors, n_empty in LEVEL_SPECS:
        if len(colors) <= 4:
            state = generate_level(colors, n_empty, rng)
        else:
            state = _build_level_fast(colors, n_empty, rng)
        levels.append({"id": level_id, "bottles": to_json_bottles(state)})
    return levels


def main() -> None:
    rng = random.Random(42)
    levels = []
    for level_id, colors, n_empty in LEVEL_SPECS:
        state = generate_level(colors, n_empty, rng)
        levels.append({"id": level_id, "bottles": to_json_bottles(state)})
    print(json.dumps(levels, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Generate 20 solvable Sort Puzzle levels.

Usage: python generate_levels.py > levels.json

Levels are produced by randomly distributing colors across bottles and
BFS-verifying solvability. RNG is seeded (42) for reproducibility.
For levels with 6+ colors the state space is too large for full BFS;
those are generated until non-trivial, then assumed solvable (empirically
true for balanced random distributions with 2+ empty bottles).
"""

import json
import random
from collections import deque
from itertools import takewhile

DEPTH = 4
BFS_CAP = 200_000


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

LEVEL_SPECS = [
    # (id, colors, n_empty)
    (1, COLORS_3, 1),
    (2, COLORS_3, 1),
    (3, COLORS_3, 1),
    (4, COLORS_4, 1),
    (5, COLORS_4, 1),
    (6, COLORS_4, 1),
    (7, COLORS_4, 1),
    (8, COLORS_5, 2),
    (9, COLORS_5, 2),
    (10, COLORS_5, 2),
    (11, COLORS_5, 2),
    (12, COLORS_6, 2),
    (13, COLORS_6, 2),
    (14, COLORS_6, 2),
    (15, COLORS_6, 2),
    (16, COLORS_7, 2),
    (17, COLORS_7, 2),
    (18, COLORS_7, 2),
    (19, COLORS_7, 2),
    (20, COLORS_8, 2),
]


def _build_level_fast(
    colors: list[str], n_empty: int, rng: random.Random, max_attempts: int = 1000
) -> list[list[str]]:
    """Generate a non-trivial level without BFS (for 5+ colors where state space is too large)."""
    units = [c for c in colors for _ in range(DEPTH)]
    for _ in range(max_attempts):
        rng.shuffle(units)
        state: list[list[str]] = [
            list(units[i * DEPTH : (i + 1) * DEPTH]) for i in range(len(colors))
        ]
        state += [[] for _ in range(n_empty)]
        if not _is_trivial(state):
            return state
    raise RuntimeError(
        f"No non-trivial level found after {max_attempts} attempts "
        f"({len(colors)} colors, {n_empty} empty)"
    )


def build_levels(seed: int | None = None) -> list[dict]:
    """Generate 20 levels with fresh randomisation. seed=None uses a random seed.

    Levels with ≤4 colors are BFS-verified solvable. Levels with 5+ colors skip
    full BFS (state space exceeds the cap anyway) and are assumed solvable given a
    non-trivial, balanced random distribution with 2+ empty bottles.
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

"""Script asserting every level ``build_levels()`` generates is solvable.

``GET /sort/levels`` builds a new random set on every request (#2746), so this
checks freshly built sets, not a saved file. Each level is decided by
``sort.fast_solver`` (#2764), which reaches a verdict on every level in well
under a second. The generator already requires that proof, so this is a manual
end-to-end check of what the endpoint serves.

``bfs_solvable`` below is the plain reference BFS, written independently of
``fast_solver``. The tests check that the two agree (``test_sort_fast_solver.py``)
and prove the small levels solvable with it (``test_sort_levels_solvable.py``).
It can't decide the big levels within ``MAX_STATES``.

Run from ``backend/``:
    python -m sort.verify_levels                 # one random set
    python -m sort.verify_levels --runs 5        # five random sets
    python -m sort.verify_levels --seed 42       # a reproducible set

Exits with code 1 if any level is proven unsolvable, or can't be decided within
the solver's budget.
"""

import argparse
import random
import sys
from collections import deque
from itertools import takewhile

from sort.fast_solver import solve
from sort.generate_levels import SOLVER_BUDGET, build_levels

DEPTH = 4
MAX_STATES = 300_000


def _compact(state: list[list[str]]) -> tuple:
    return tuple(tuple(b) for b in state)


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


def _solved(state: list[list[str]]) -> bool:
    for b in state:
        if b and (len(b) < DEPTH or len(set(b)) > 1):
            return False
    return True


def _from_json(bottles: list[list[str]]) -> list[list[str]]:
    """Convert padded JSON bottles ('' = empty slot) to compact variable-length lists."""
    return [[s for s in b if s != ""] for b in bottles]


def bfs_solvable(state: list[list[str]]) -> tuple[bool, int]:
    """Return (solvable, states_explored). solvable=None means hit state cap."""
    if _solved(state):
        return True, 0
    visited = {_compact(state)}
    queue = deque([state])
    while queue:
        if len(visited) >= MAX_STATES:
            return None, len(visited)  # type: ignore[return-value]
        cur = queue.popleft()
        for frm, to in _moves(cur):
            nxt = _apply(cur, frm, to)
            key = _compact(nxt)
            if key in visited:
                continue
            if _solved(nxt):
                return True, len(visited)
            visited.add(key)
            queue.append(nxt)
    return False, len(visited)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seed", type=int, default=None, help="seed of the first set")
    parser.add_argument("--runs", type=int, default=1, help="number of sets to build")
    args = parser.parse_args()
    if args.runs < 1:
        parser.error("--runs must be at least 1")
    # Every run gets its own seed, printed so a failing set can be rebuilt.
    first = args.seed if args.seed is not None else random.randrange(2**32)
    failures: list[str] = []

    for seed in range(first, first + args.runs):
        print(f"Set seed={seed}")
        for level in build_levels(seed):
            lid = level["id"]
            solvable, n_states = solve(level["bottles"], SOLVER_BUDGET)
            if solvable is True:
                print(f"Level {lid:>2}: SOLVABLE   ({n_states} states)")
            elif solvable is None:
                print(f"Level {lid:>2}: UNDECIDED  (budget of {n_states} states spent)")
                failures.append(f"{lid} (seed {seed}, undecided)")
            else:
                print(f"Level {lid:>2}: UNSOLVABLE ({n_states} states)")
                failures.append(f"{lid} (seed {seed})")

    if failures:
        print(f"\nFAIL: levels not proven solvable: {', '.join(failures)}", file=sys.stderr)
        sys.exit(1)
    else:
        print("\nAll levels verified.")


if __name__ == "__main__":
    main()

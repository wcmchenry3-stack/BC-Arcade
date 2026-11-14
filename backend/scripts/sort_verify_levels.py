"""Script asserting every level of the shipped Sort catalog is solvable.

The app plays the fixed catalog (``frontend/src/game/sort/levels.catalog.json``,
#2761). This checks the committed file: each level is decided by
``sort.fast_solver`` (#2764), and its solution is replayed here with
``is_solution``. A manual end-to-end check of what the app ships;
``tests/test_sort_catalog.py`` runs the same check in CI.

The reference pour simulator below (``_moves``, ``_apply``, ``_solved``) and
``bfs_solvable`` are written independently of ``fast_solver``, and mirror
``isValidPour``/``applyPour`` in ``frontend/src/game/sort/engine.ts``:

* ``is_solution`` replays the solver's pours one by one, checking each is a
  legal move, and that the level ends solved: a certificate that doesn't rely
  on the solver's pruning.
* The tests check ``fast_solver`` agrees with ``bfs_solvable``
  (``test_sort_fast_solver.py``).

Run from ``backend/``:
    python scripts/sort_verify_levels.py

Exits with code 1 if any level is proven unsolvable, can't be decided within
the solver's budget, or its solution doesn't replay.
"""

import json
import os
import sys
from collections import deque
from itertools import takewhile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sort.fast_solver import DEPTH, solve
from sort.generate_levels import COLORS_14, SOLVER_BUDGET

MAX_STATES = 300_000

CATALOG_PATH = Path(__file__).resolve().parents[2] / "frontend/src/game/sort/levels.catalog.json"


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
    return all(not (b and (len(b) < DEPTH or len(set(b)) > 1)) for b in state)


def _from_json(bottles: list[list[str]]) -> list[list[str]]:
    """Convert padded JSON bottles ('' = empty slot) to compact variable-length lists."""
    return [[s for s in b if s != ""] for b in bottles]


def is_solution(bottles: list[list[str]], pours: list[tuple[int, int]]) -> bool:
    """True when ``pours`` are legal moves, in order, that leave the level solved.

    ``bottles`` is the level as served (padded with '' or not).
    """
    state = _from_json(bottles)
    for frm, to in pours:
        if (frm, to) not in _moves(state):
            return False
        state = _apply(state, frm, to)
    return _solved(state)


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


def catalog_levels() -> list[tuple[int, list[list[str]]]]:
    """The shipped catalog as ``(level number, bottles)``, level 1 first."""
    levels = json.loads(CATALOG_PATH.read_text())["levels"]
    return [
        (n, [[COLORS_14[ord(ch) - 65] for ch in b] for b in encoded.split(",")])
        for n, (encoded, _par) in enumerate(levels, start=1)
    ]


def main() -> None:
    failures: list[str] = []
    for lid, bottles in catalog_levels():
        solvable, n_states, pours = solve(bottles, SOLVER_BUDGET)
        if solvable is True and pours is not None and is_solution(bottles, pours):
            print(f"Level {lid:>3}: SOLVABLE   ({n_states} states, {len(pours)} pours)")
        elif solvable is True:
            print(f"Level {lid:>3}: BAD PATH   (the solver's pours don't replay)")
            failures.append(f"{lid} (bad path)")
        elif solvable is None:
            print(f"Level {lid:>3}: UNDECIDED  (budget of {n_states} states spent)")
            failures.append(f"{lid} (undecided)")
        else:
            print(f"Level {lid:>3}: UNSOLVABLE ({n_states} states)")
            failures.append(str(lid))

    if failures:
        print(f"\nFAIL: levels not proven solvable: {', '.join(failures)}", file=sys.stderr)
        sys.exit(1)
    print("\nAll levels verified.")


if __name__ == "__main__":
    main()

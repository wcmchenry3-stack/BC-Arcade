"""Fast exhaustive solver for Sort Puzzle levels (#2764).

Decides whether a level can be solved, with a node budget. The rules are the
game's own (``generate_levels._apply``, ``frontend/src/game/sort/engine.ts``):
a pour moves the whole same-colour run on top of the source, or as much of it
as fits, onto an empty bottle or onto the same colour. A level is solved when
every bottle is empty or full of one colour.

Why this is much faster than the plain BFS in ``verify_levels.py``, without
giving up the proof of unsolvability:

* A state is keyed with its bottles sorted, so bottle permutations (two empty
  bottles swapped, a run moved to "the other" empty bottle) are one state.
* A full single-colour bottle is inert (nothing fits in, and pouring it out
  only lands in an empty bottle, a permutation), so it is dropped from the
  state. The search sees fewer bottles as the level fills up.
* Pouring a single-colour bottle into an empty one only permutes bottles, and
  of several empty bottles only the first is tried; neither changes the set of
  reachable states, only avoids generating duplicates.
* Greedy best-first order on ``runs - colours`` (a lower bound on the moves
  left: each pour removes at most one run) finds solutions of solvable levels
  in a few hundred nodes.

The search keeps a visited set over the whole reachable space, so "no
solution" is only returned after every reachable state was expanded: that is
a proof. Running out of budget returns ``None`` (unknown).
"""

from __future__ import annotations

import heapq
import itertools
from collections.abc import Sequence

DEPTH = 4
DEFAULT_BUDGET = 2_000_000

# A state: bottles as strings of one-character colour codes, bottom first,
# sorted, with full single-colour bottles removed.
State = tuple[str, ...]


def encode(bottles: Sequence[Sequence[str]]) -> State:
    """Map API bottles (colour names, '' for an empty slot) to a solver state."""
    codes: dict[str, str] = {}
    out = []
    for bottle in bottles:
        s = "".join(codes.setdefault(c, chr(65 + len(codes))) for c in bottle if c)
        out.append(s)
    return _canon(out)


def _full(s: str) -> bool:
    return len(s) == DEPTH and s.count(s[0]) == DEPTH


def _canon(bottles: list[str]) -> State:
    return tuple(sorted(b for b in bottles if not _full(b)))


def heuristic(state: State) -> int:
    """Runs on top of each other minus colours left: a lower bound on moves."""
    runs = 0
    colours: set[str] = set()
    for s in state:
        if s:
            colours.update(s)
            prev = ""
            for ch in s:
                if ch != prev:
                    runs += 1
                    prev = ch
    return runs - len(colours)


def successors(state: State) -> list[tuple[int, int, State]]:
    """Every distinct state one pour away, as (from, to, state) with indices into ``state``."""
    out = []
    n = len(state)
    first_empty = next((i for i, s in enumerate(state) if not s), -1)
    for i in range(n):
        src = state[i]
        if not src:
            continue
        c = src[-1]
        rest = src.rstrip(c)
        run = len(src) - len(rest)
        uniform = not rest
        for j in range(n):
            if j == i:
                continue
            dst = state[j]
            if dst:
                if dst[-1] != c or len(dst) == DEPTH:
                    continue
            else:
                if uniform or j != first_empty:
                    continue
            k = min(run, DEPTH - len(dst))
            bottles = list(state)
            bottles[i] = src[:-k]
            bottles[j] = dst + c * k
            out.append((i, j, _canon(bottles)))
    return out


def solve(
    bottles: Sequence[Sequence[str]], budget: int = DEFAULT_BUDGET
) -> tuple[bool | None, int]:
    """Decide a level. Returns (verdict, states_seen).

    verdict is True (a solution exists), False (proven: every reachable state
    was expanded and none is solved) or None (the budget of distinct states ran
    out first: unknown).
    """
    start = encode(bottles)
    if not any(start):
        return True, 1
    seen = {start}
    tie = itertools.count()
    frontier = [(heuristic(start), next(tie), start)]
    while frontier:
        _, _, cur = heapq.heappop(frontier)
        for _, _, nxt in successors(cur):
            if nxt in seen:
                continue
            if not any(nxt):
                return True, len(seen) + 1
            seen.add(nxt)
            if len(seen) >= budget:
                return None, len(seen)
            # Negated counter: among equal scores the newest goes first (DFS-like).
            heapq.heappush(frontier, (heuristic(nxt), -next(tie), nxt))
    return False, len(seen)

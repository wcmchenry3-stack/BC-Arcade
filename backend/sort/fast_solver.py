"""Fast exhaustive solver for Sort Puzzle levels (#2764).

Decides whether a level can be solved, with a node budget, and returns the
pours that solve it. ``generate_levels`` deals each level again until this
proves it solvable. The rules are the game's own (``applyPour`` in
``frontend/src/game/sort/engine.ts``, and the reference simulator in
``verify_levels.py``): a pour moves the whole same-colour run on top of the
source, or as much of it as fits, onto an empty bottle or onto the same colour.
A level is solved when every bottle is empty or full of one colour.

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
a proof. Running out of budget returns ``None`` (unknown). A "solvable"
verdict comes with the pours, as indices into the level's own bottles, so it
can be checked by replaying them with an independent simulator
(``verify_levels.is_solution``).
"""

from __future__ import annotations

import functools
import heapq
import itertools
from collections.abc import Sequence
from typing import NamedTuple

# Units per bottle: the single source for the backend. The frontend's
# BOTTLE_DEPTH (frontend/src/game/sort/types.ts) must match it.
DEPTH = 4
DEFAULT_BUDGET = 2_000_000

# A state: bottles as strings of one-character colour codes, bottom first,
# sorted, with full single-colour bottles removed.
State = tuple[str, ...]
Pour = tuple[int, int]


class Result(NamedTuple):
    """A solver verdict.

    ``solvable`` is True, False (proven) or None (budget spent). ``seen`` is the
    number of distinct states visited. ``pours`` is the solution as (from, to)
    bottle indices into the level as given, when ``solvable`` is True.
    """

    solvable: bool | None
    seen: int
    pours: list[Pour] | None = None


def _codes(bottles: Sequence[Sequence[str]]) -> list[str]:
    """Bottles as colour-code strings, in the level's own order."""
    codes: dict[str, str] = {}
    return ["".join(codes.setdefault(c, chr(65 + len(codes))) for c in b if c) for b in bottles]


def encode(bottles: Sequence[Sequence[str]]) -> State:
    """Map API bottles (colour names, '' for an empty slot) to a solver state."""
    return _canon(_codes(bottles))


def _full(s: str) -> bool:
    return len(s) == DEPTH and s.count(s[0]) == DEPTH


def _canon(bottles: list[str]) -> State:
    return tuple(sorted(b for b in bottles if not _full(b)))


@functools.cache
def _runs(s: str) -> int:
    """Same-colour runs in one bottle."""
    return sum(1 for i, ch in enumerate(s) if i == 0 or ch != s[i - 1])


def heuristic(state: State) -> int:
    """Runs on top of each other minus colours left: a lower bound on moves."""
    return sum(map(_runs, state)) - len(set("".join(state)))


def successors(state: State) -> list[tuple[int, int, State]]:
    """Every distinct state one pour away, as (from, to, state) with indices into ``state``."""
    out = []
    # Bottles with room, by top colour: the only places a run can go besides
    # the empty bottle.
    by_top: dict[str, list[int]] = {}
    for j, s in enumerate(state):
        if s and len(s) < DEPTH:
            by_top.setdefault(s[-1], []).append(j)
    # Sorted, so any empty bottle comes first; the others are the same target.
    has_empty = bool(state) and not state[0]
    for i, src in enumerate(state):
        if not src:
            continue
        c = src[-1]
        rest = src.rstrip(c)
        run = len(src) - len(rest)
        targets = [j for j in by_top.get(c, ()) if j != i]
        if has_empty and rest:
            # A single-colour bottle poured into the empty one would only move.
            targets.append(0)
        for j in targets:
            dst = state[j]
            k = min(run, DEPTH - len(dst))
            new_dst = dst + c * k
            bottles = list(state)
            bottles[i] = src[:-k]
            # Only the destination can fill up; a full single-colour bottle is inert.
            if len(new_dst) == DEPTH and new_dst.count(c) == DEPTH:
                del bottles[j]
            else:
                bottles[j] = new_dst
            bottles.sort()
            out.append((i, j, tuple(bottles)))
    return out


def _pour(bottles: list[str], i: int, j: int) -> None:
    src, dst = bottles[i], bottles[j]
    c = src[-1]
    k = min(len(src) - len(src.rstrip(c)), DEPTH - len(dst))
    bottles[i], bottles[j] = src[:-k], dst + c * k


def _to_pours(level: list[str], steps: list[tuple[str, str]]) -> list[Pour]:
    """Map pours between bottle contents onto the level's own bottle indices.

    A state is a multiset of bottles, so any bottle holding the source's
    contents (and any other holding the destination's) is an equivalent choice.
    """
    bottles = list(level)
    pours = []
    for src, dst in steps:
        i = bottles.index(src)
        j = next(n for n, b in enumerate(bottles) if b == dst and n != i)
        _pour(bottles, i, j)
        pours.append((i, j))
    return pours


def solve(bottles: Sequence[Sequence[str]], budget: int = DEFAULT_BUDGET) -> Result:
    """Decide a level; see ``Result``."""
    level = _codes(bottles)
    start = _canon(level)
    if not any(start):
        return Result(True, 1, [])
    # Each state maps to (previous state, source contents, destination contents).
    parent: dict[State, tuple[State, str, str] | None] = {start: None}
    tie = itertools.count()
    frontier = [(heuristic(start), next(tie), start)]
    while frontier:
        _, _, cur = heapq.heappop(frontier)
        for i, j, nxt in successors(cur):
            if nxt in parent:
                continue
            parent[nxt] = (cur, cur[i], cur[j])
            if not any(nxt):
                steps = []
                link = parent[nxt]
                while link is not None:
                    prev, src, dst = link
                    steps.append((src, dst))
                    link = parent[prev]
                return Result(True, len(parent), _to_pours(level, steps[::-1]))
            if len(parent) >= budget:
                return Result(None, len(parent))
            # Negated counter: among equal scores the newest goes first (DFS-like).
            heapq.heappush(frontier, (heuristic(nxt), -next(tie), nxt))
    return Result(False, len(parent))

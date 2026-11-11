"""Build Sort's fixed level catalog (#2761).

Run from ``backend/``::

    python scripts/sort_build_catalog.py

It writes ``frontend/src/game/sort/levels.catalog.json``: the 120 levels every
player gets, in 6 chapters of 20, shipped inside the app (no server call).
``backend/tests/test_sort_catalog.py`` regenerates the catalog in memory and
asserts it equals the committed file byte for byte, and replays every level's
solution with the reference simulator, so the file can't drift or hold an
unsolvable level.

How a level is chosen
---------------------
1. **Specs.** ``CHAPTERS`` below is the difficulty curve: one ``(colours,
   empty bottles)`` spec per level. The *i*-th level that uses a spec gets a
   harder deal of it than the one before (step 4), so each spec ramps up on
   its own as the catalog goes on.
2. **Candidates.** For each spec, ``pool_size`` distinct deals are dealt from
   a seeded RNG with ``sort.generate_levels.deal_level`` (a uniform shuffle
   kept only once ``sort.fast_solver`` proves it solvable, and never already
   solved). Deals equal up to colour relabelling and bottle order are dropped
   (``canonical``), here and across the whole catalog.
3. **Scores.** Every candidate is measured three ways:

   * ``length``: the number of pours in ``fast_solver``'s solution. The solver
     is best-first, not optimal, so this is an upper bound on the shortest
     solution, but it grows with the work a level takes.
   * ``trap``: the share of ``TRAP_RUNS`` seeded random plays (``TRAP_POURS``
     random non-trivial pours each) that end on a board ``fast_solver`` proves
     dead. High means careless pours lose the level.
   * ``openings``: the number of distinct first pours (``fast_solver``'s
     ``successors``, which already folds symmetric pours together).

   ``difficulty`` ranks a candidate within its spec's pool: 60% its trap-rate
   percentile, 40% its length percentile; ties go to fewer openings (fewer
   ways in), then to the order dealt.
4. **Pick.** The *i*-th of the *n* levels using a spec takes the candidate at
   quantile ``(i + 0.5) / n`` of the pool sorted by ``difficulty`` (the
   nearest unused one if that is taken).
5. **Par.** ``par = ceil(length * PAR_SLACK)``. The slack covers the solver's
   path not being the shortest: a careful player can match or beat it, and a
   good-but-not-perfect solve still makes par. Stars (#3687) read it.

The curve
---------
Colours go 3 -> 14 over the six chapters; one empty bottle makes a spec
tight, two relaxed. One empty bottle stops at 9 colours: random 1-empty deals
of 9 colours are ~99% dead, and 10+ would take too many deals. Each chapter
opens on an easier spec than it ends on, and drops back to an easier
("breather") spec now and then; the 9-colour, 1-empty levels in chapters 4-6
are tight spikes between the long 2-empty levels. ``docs/games/sort.md`` has
the table this prints.

Format
------
``{"version", "seed", "legend", "levels"}``. ``legend`` lists the colour
names; letter ``A`` is ``legend[0]``. A level is ``[bottles, par]``, where
``bottles`` is the bottles bottom first, one letter per unit, joined by
``,`` (an empty bottle is an empty string). Raise ``CATALOG_VERSION`` (and
``sort.catalog.CATALOG_VERSION``) whenever the levels change: the app keys
the player's progress and the leaderboard on it.
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import os
import random
import sys
import time
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sort.catalog import CATALOG_VERSION, CHAPTER_SIZE, LEVEL_COUNT
from sort.fast_solver import DEPTH, encode, solve, successors
from sort.generate_levels import COLORS_14, SOLVER_BUDGET, deal_level

CATALOG_PATH = Path(__file__).resolve().parents[2] / "frontend/src/game/sort/levels.catalog.json"

SEED = 2761
TRAP_RUNS = 24
TRAP_POURS = 12
PAR_SLACK = 1.15
# Below this many colours ``canonical`` is exact (every relabelling is tried).
_EXACT_CANON_MAX_COLOURS = 6

# The curve: one "colours/empties" spec per level, 20 per chapter.
CHAPTERS: tuple[tuple[str, str], ...] = (
    (
        "First pours (3-5 colours)",
        "3/2 3/2 3/1 3/1 4/2 4/2 4/1 3/1 4/1 4/1 5/2 5/2 4/1 5/1 5/2 5/1 4/2 5/1 5/1 5/1",
    ),
    (
        "Tight spaces (5-7 colours)",
        "5/2 6/2 5/1 6/2 6/1 6/1 5/2 6/1 6/1 7/2 7/2 6/1 7/1 7/2 7/1 6/2 7/1 7/1 7/1 7/1",
    ),
    (
        "Deep mixes (7-9 colours)",
        "7/2 8/2 7/1 8/2 8/1 7/2 8/1 8/1 9/2 8/1 9/2 8/2 9/1 9/2 8/1 9/1 7/2 9/1 9/1 9/1",
    ),
    (
        "Long hauls (9-11 colours)",
        (
            "9/2 10/2 9/1 10/2 10/2 9/1 10/2 11/2 9/2 10/2 "
            "11/2 9/1 11/2 11/2 10/2 11/2 9/1 11/2 11/2 9/1"
        ),
    ),
    (
        "Crowded shelves (11-13 colours)",
        (
            "11/2 12/2 11/2 12/2 12/2 9/1 12/2 13/2 11/2 12/2 "
            "13/2 13/2 12/2 13/2 9/1 13/2 11/2 13/2 13/2 13/2"
        ),
    ),
    (
        "Full spectrum (12-14 colours)",
        (
            "12/2 13/2 14/2 13/2 14/2 14/2 9/1 14/2 12/2 14/2 "
            "14/2 13/2 14/2 14/2 9/1 14/2 12/2 14/2 14/2 14/2"
        ),
    ),
)

Spec = tuple[int, int]
State = list[list[str]]


def level_specs() -> list[Spec]:
    """Every level's ``(colours, empties)``, level 1 first."""
    specs = []
    for _, line in CHAPTERS:
        row = [tuple(int(n) for n in token.split("/")) for token in line.split()]
        assert len(row) == CHAPTER_SIZE, line
        specs += [(c, e) for c, e in row]
    assert len(specs) == LEVEL_COUNT
    return specs


@dataclass(frozen=True)
class Candidate:
    order: int  # position in the pool's deal order: the last tie-break
    state: tuple[str, ...]  # bottles as letter strings, the catalog's form
    length: int
    trap: float
    openings: int


def _letters(state: State) -> tuple[str, ...]:
    """Bottles as letter strings: ``A`` is ``COLORS_14[0]``."""
    return tuple("".join(chr(65 + COLORS_14.index(c)) for c in b) for b in state)


def canonical(bottles: tuple[str, ...]) -> tuple[str, ...]:
    """A key equal for deals that differ only by colour names and bottle order.

    Exact up to ``_EXACT_CANON_MAX_COLOURS`` colours: every relabelling is
    tried and the smallest sorted form kept. Above that it relabels colours in
    order of first appearance over the bottles sorted by their own pattern
    (each bottle relabelled on its own), which equal deals almost always share;
    a missed duplicate among a few dozen random deals of 7+ colours is
    vanishingly unlikely (there are over 10^13 such deals).
    """
    colours = sorted({c for b in bottles for c in b})
    if len(colours) <= _EXACT_CANON_MAX_COLOURS:
        best: tuple[str, ...] | None = None
        for perm in itertools.permutations(colours):
            table = str.maketrans("".join(perm), "".join(chr(65 + i) for i in range(len(perm))))
            key = tuple(sorted(b.translate(table) for b in bottles))
            if best is None or key < best:
                best = key
        assert best is not None
        return best

    def pattern(b: str) -> str:
        seen: dict[str, str] = {}
        return "".join(seen.setdefault(c, chr(97 + len(seen))) for c in b)

    ordered = sorted(bottles, key=lambda b: (pattern(b), len(b)))
    seen: dict[str, str] = {}
    for c in "".join(ordered):
        seen.setdefault(c, chr(65 + len(seen)))
    table = str.maketrans("".join(seen), "".join(seen.values()))
    return tuple(sorted(b.translate(table) for b in bottles))


def _random_pour(board: State, rng: random.Random) -> bool:
    """One random non-trivial legal pour; False when there is none.

    A pour is trivial when it moves a single-colour bottle into an empty one:
    that only swaps two bottles.
    """
    moves = []
    for i, src in enumerate(board):
        if not src:
            continue
        pure = src.count(src[-1]) == len(src)
        for j, dst in enumerate(board):
            if i == j or len(dst) >= DEPTH:
                continue
            # Onto the same colour, or a mixed bottle's top run into an empty one.
            if (dst and dst[-1] == src[-1]) or (not dst and not pure):
                moves.append((i, j))
    if not moves:
        return False
    i, j = rng.choice(moves)
    src, dst = board[i], board[j]
    run = 1
    while run < len(src) and src[-1 - run] == src[-1]:
        run += 1
    for _ in range(min(run, DEPTH - len(dst))):
        dst.append(src.pop())
    return True


def trap_rate(state: State, rng: random.Random) -> float:
    """Share of random plays that end on a board proven dead."""
    dead = 0
    for _ in range(TRAP_RUNS):
        board = [list(b) for b in state]
        for _ in range(TRAP_POURS):
            if not _random_pour(board, rng):
                break
        dead += solve(board, SOLVER_BUDGET).solvable is False
    return dead / TRAP_RUNS


def measure(order: int, state: State, rng: random.Random) -> Candidate:
    result = solve(state, SOLVER_BUDGET)
    assert result.solvable is True and result.pours is not None
    return Candidate(
        order=order,
        state=_letters(state),
        length=len(result.pours),
        trap=trap_rate(state, rng),
        openings=len(successors(encode(state))),
    )


def pool_size(uses: int) -> int:
    """Candidates dealt for a spec used by ``uses`` levels: enough to spread
    the picks over the difficulty range."""
    return 3 * uses + 6


def build_pool(spec: Spec, uses: int, seed: int, taken: set[tuple[str, ...]]) -> list[Candidate]:
    """``pool_size(uses)`` distinct candidates of ``spec``, easiest first."""
    colours, empties = spec
    rng = random.Random(f"sort-catalog:{seed}:{colours}:{empties}")
    pool: list[Candidate] = []
    keys: set[tuple[str, ...]] = set()
    while len(pool) < pool_size(uses):
        state = deal_level(COLORS_14[:colours], empties, rng)
        key = canonical(_letters(state))
        if key in keys or key in taken:
            continue
        keys.add(key)
        pool.append(measure(len(pool), state, rng))
    return rank(pool)


def _percentiles(values: list[float]) -> list[float]:
    """Each value's percentile in ``values`` (ties share their mean rank), 0-1."""
    ordered = sorted(values)
    n = len(values)
    if n == 1:
        return [0.5]
    out = []
    for v in values:
        lo = ordered.index(v)
        hi = n - 1 - ordered[::-1].index(v)
        out.append((lo + hi) / 2 / (n - 1))
    return out


def difficulty(pool: list[Candidate]) -> list[float]:
    traps = _percentiles([c.trap for c in pool])
    lengths = _percentiles([float(c.length) for c in pool])
    return [0.6 * t + 0.4 * n for t, n in zip(traps, lengths, strict=True)]


def rank(pool: list[Candidate]) -> list[Candidate]:
    """``pool`` easiest first (see the module docstring)."""
    scores = difficulty(pool)
    order = sorted(range(len(pool)), key=lambda i: (scores[i], -pool[i].openings, pool[i].order))
    return [pool[i] for i in order]


def par(length: int) -> int:
    return math.ceil(length * PAR_SLACK - 1e-9)


def pick(pool: list[Candidate], quantile: float, used: set[int]) -> Candidate:
    """The unused candidate nearest ``quantile`` of ``pool`` (lower on a tie)."""
    target = round(quantile * (len(pool) - 1))
    for offset in range(len(pool)):
        for i in (target - offset, target + offset):
            if 0 <= i < len(pool) and i not in used:
                used.add(i)
                return pool[i]
    raise AssertionError("pool exhausted")


@dataclass(frozen=True)
class Level:
    spec: Spec
    candidate: Candidate

    @property
    def par(self) -> int:
        return par(self.candidate.length)


def build_levels(seed: int = SEED) -> list[Level]:
    specs = level_specs()
    uses: dict[Spec, int] = {}
    for spec in specs:
        uses[spec] = uses.get(spec, 0) + 1
    taken: set[tuple[str, ...]] = set()
    pools: dict[Spec, list[Candidate]] = {}
    # Pools are dealt in a fixed order (fewest colours first) so the result
    # doesn't depend on dict ordering.
    for spec in sorted(uses):
        pools[spec] = build_pool(spec, uses[spec], seed, taken)
        taken |= {canonical(c.state) for c in pools[spec]}
    seen_uses: dict[Spec, int] = {}
    used: dict[Spec, set[int]] = {spec: set() for spec in uses}
    levels = []
    for spec in specs:
        i = seen_uses.get(spec, 0)
        seen_uses[spec] = i + 1
        quantile = (i + 0.5) / uses[spec]
        levels.append(Level(spec, pick(pools[spec], quantile, used[spec])))
    return levels


def catalog_of(levels: list[Level], seed: int) -> dict:
    return {
        "version": CATALOG_VERSION,
        "seed": seed,
        "legend": COLORS_14,
        "levels": [[",".join(lv.candidate.state), lv.par] for lv in levels],
    }


def build_catalog(seed: int = SEED) -> dict:
    return catalog_of(build_levels(seed), seed)


def render(catalog: dict) -> str:
    """One level per line, so diffs stay readable."""

    def line(obj: object) -> str:
        return json.dumps(obj, separators=(",", ":"))

    levels = ",\n".join("    " + line(lv) for lv in catalog["levels"])
    return (
        "{\n"
        f'  "version": {line(catalog["version"])},\n'
        f'  "seed": {line(catalog["seed"])},\n'
        f'  "legend": {line(catalog["legend"])},\n'
        f'  "levels": [\n{levels}\n  ]\n'
        "}\n"
    )


def decode(bottles: str) -> State:
    """A catalog level's bottles as colour names (the API's form)."""
    return [[COLORS_14[ord(ch) - 65] for ch in b] for b in bottles.split(",")]


def _report(levels: list[Level]) -> None:
    print("level  spec   len  par  trap  openings")
    for n, lv in enumerate(levels, start=1):
        c = lv.candidate
        print(
            f"{n:>5}  {lv.spec[0]:>2}/{lv.spec[1]}  {c.length:>3}  {lv.par:>3}  "
            f"{c.trap:.2f}  {c.openings:>3}"
        )
    print("\nchapter  colours  empties  par      mean trap")
    for k in range(len(CHAPTERS)):
        chunk = levels[k * CHAPTER_SIZE : (k + 1) * CHAPTER_SIZE]
        cols = [lv.spec[0] for lv in chunk]
        empties = sorted({lv.spec[1] for lv in chunk})
        pars = [lv.par for lv in chunk]
        trap = sum(lv.candidate.trap for lv in chunk) / len(chunk)
        print(
            f"{k + 1:>7}  {min(cols):>2}-{max(cols):<2}    {'/'.join(map(str, empties)):<7}  "
            f"{min(pars):>3}-{max(pars):<3}  {trap:.2f}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--report", action="store_true", help="print every level's scores")
    args = parser.parse_args()
    start = time.monotonic()
    levels = build_levels(args.seed)
    text = render(catalog_of(levels, args.seed))
    CATALOG_PATH.write_text(text)
    if args.report:
        _report(levels)
    print(
        f"wrote {CATALOG_PATH} ({len(text.encode())} bytes, {len(levels)} levels) "
        f"in {time.monotonic() - start:.1f} s"
    )


if __name__ == "__main__":
    main()

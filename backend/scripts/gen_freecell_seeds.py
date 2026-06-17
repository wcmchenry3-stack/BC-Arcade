#!/usr/bin/env python3
"""FreeCell winnable-seed bank generator (#2038).

Writes ``frontend/src/game/freecell/seeds.json`` — a bank of integer
seeds that the TypeScript engine's ``dealGame`` uses to reproduce deals.
Each seed in the bank has been proven winnable by the included DFS
solver, so the live game never serves an unsolvable layout.

Protocol parity with the TS engine
----------------------------------
The Python deal and ``createDeck`` / ``fisherYates`` in
``frontend/src/game/freecell/engine.ts`` share the exact same:

- LCG parameters: ``a=1664525``, ``c=1013904223``, ``m=2**32``
- Fisher-Yates loop direction and ``j = floor(rng * (i+1))`` index math
- Suit order: ``spades, hearts, diamonds, clubs``
- Rank order: ``1..13``
- Layout: 8 columns; cols 0–3 receive 7 cards each; cols 4–7 receive 6 cards each
- All cards face-up (FreeCell has no face-down cards)

Solver design
-------------
Single-card DFS with four optimisations that make the previous 43-minute
run unnecessary:

1. **Safe auto-moves** (Bjarnason criterion): after every move, eagerly
   send any card to its foundation pile when doing so is provably optimal
   (rank ≤ 2, or all lower opposite-colour cards are already on the
   foundation). This collapses huge swaths of the search tree.

2. **Move ordering**: foundation → freecell-to-tableau → tableau-to-tableau
   → tableau-to-freecell. Higher-priority moves are explored first so the
   solver reaches win states quickly on solvable deals.

3. **Canonical transposition key**: free-cell slots are fungible → sort them;
   tableau columns are positionally equivalent → sort them. Equivalent
   board positions share a key and are explored at most once.

4. **Per-seed wall-clock cap** (``--limit-seconds``): one pathological seed
   cannot stall the batch. Combined with a reduced state budget (most
   solvable deals resolve in < 10k states), the generator runs in seconds.

Usage
-----
    python backend/scripts/gen_freecell_seeds.py \\
        --count 500 \\
        --output frontend/src/game/freecell/seeds.json
"""

from __future__ import annotations

import argparse
import heapq
import itertools
import json
import sys
import time
from pathlib import Path
from typing import Iterator

# ---------------------------------------------------------------------------
# Card encoding
# ---------------------------------------------------------------------------
# card_id = suit_idx * 13 + (rank - 1), range 0..51
# Suit order matches engine.ts SUITS array: spades=0, hearts=1, diamonds=2, clubs=3
# rank: 1..13  →  card_id % 13 + 1
# suit: card_id // 13
# color: 0=black (spades=0, clubs=3), 1=red (hearts=1, diamonds=2)
# EMPTY (free-cell slot unoccupied): -1

SUITS = ("spades", "hearts", "diamonds", "clubs")
RANKS = tuple(range(1, 14))
DECK_SIZE = 52
TABLEAU_COLUMNS = 8
FREE_CELLS = 4
EMPTY = -1

_BLACK_SUIT_IDXS = frozenset({0, 3})  # spades, clubs

# Precomputed lookup tables — avoid per-call function dispatch overhead.
# Indexed by card_id (0..51).
_CARD_SUIT: list[int] = [i // 13 for i in range(52)]
_CARD_RANK: list[int] = [(i % 13) + 1 for i in range(52)]
_CARD_COLOR: list[int] = [0 if (i // 13) in _BLACK_SUIT_IDXS else 1 for i in range(52)]
# _CAN_STACK[a][b] == True iff card `a` can be placed on top of card `b`.
_CAN_STACK: list[list[bool]] = [
    [_CARD_COLOR[a] != _CARD_COLOR[b] and _CARD_RANK[a] == _CARD_RANK[b] - 1 for b in range(52)]
    for a in range(52)
]


def _card_suit(cid: int) -> int:
    return _CARD_SUIT[cid]


def _card_rank(cid: int) -> int:
    return _CARD_RANK[cid]


def _card_color(cid: int) -> int:
    return _CARD_COLOR[cid]


# ---------------------------------------------------------------------------
# LCG + deal — mirrors frontend/src/game/freecell/engine.ts exactly
# ---------------------------------------------------------------------------


def lcg(seed: int) -> Iterator[float]:
    """LCG matching createSeededRng in engine.ts. Yields floats in [0, 1)."""
    state = seed & 0xFFFFFFFF
    while True:
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        yield state / 4294967296


def fresh_deck() -> list[int]:
    """52 card IDs in canonical suit×rank order (suits outer, ranks inner)."""
    return [si * 13 + (r - 1) for si in range(4) for r in RANKS]


def fisher_yates(deck: list[int], rng: Iterator[float]) -> list[int]:
    """In-place Fisher-Yates matching the TS engine's direction and index math."""
    for i in range(len(deck) - 1, 0, -1):
        j = int(next(rng) * (i + 1))
        deck[i], deck[j] = deck[j], deck[i]
    return deck


# State tuple layout:
#   (foundations, tableau, freecells)
#   foundations : tuple[int,int,int,int]  — top rank per suit, 0=empty
#   tableau     : tuple[tuple[int,...],…] — 8 columns, each bottom→top
#   freecells   : tuple[int,int,int,int]  — card_id or EMPTY(-1)

FCState = tuple[
    tuple[int, int, int, int],
    tuple[tuple[int, ...], ...],
    tuple[int, int, int, int],
]


def deal(seed: int) -> FCState:
    """Deal a FreeCell game. Returns state tuple."""
    rng = lcg(seed)
    deck = fisher_yates(fresh_deck(), rng)
    cols: list[tuple[int, ...]] = []
    k = 0
    for col in range(TABLEAU_COLUMNS):
        count = 7 if col < 4 else 6
        cols.append(tuple(deck[k : k + count]))
        k += count
    assert k == DECK_SIZE, f"deal consumed {k} cards, expected {DECK_SIZE}"
    return (
        (0, 0, 0, 0),
        tuple(cols),
        (EMPTY, EMPTY, EMPTY, EMPTY),
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_win(foundations: tuple[int, int, int, int]) -> bool:
    return foundations == (13, 13, 13, 13)


def _replace4(t: tuple[int, int, int, int], idx: int, v: int) -> tuple[int, int, int, int]:
    lst = list(t)
    lst[idx] = v
    return (lst[0], lst[1], lst[2], lst[3])


def _can_stack(moving_cid: int, dest_cid: int) -> bool:
    """True if moving_cid can be placed on top of dest_cid (opposite colour, rank-1)."""
    return _CAN_STACK[moving_cid][dest_cid]


# ---------------------------------------------------------------------------
# Safe auto-moves (Bjarnason criterion)
# ---------------------------------------------------------------------------


# Precomputed opposite-suit pairs for _is_safe_to_foundation.
# For black suits (0=spades, 3=clubs): opposite = red (1=hearts, 2=diamonds).
# For red suits (1=hearts, 2=diamonds): opposite = black (0=spades, 3=clubs).
_OPP_SUITS: list[tuple[int, int]] = [(1, 2), (0, 3), (0, 3), (1, 2)]


def _is_safe_to_foundation(cid: int, foundations: tuple[int, int, int, int]) -> bool:
    """Return True when moving cid to its foundation pile is always optimal (Bjarnason criterion)."""
    si = _CARD_SUIT[cid]
    r = _CARD_RANK[cid]
    if foundations[si] != r - 1:
        return False
    if r <= 2:
        return True
    o0, o1 = _OPP_SUITS[si]
    return foundations[o0] >= r - 1 and foundations[o1] >= r - 1


def apply_safe_automoves(state: FCState) -> FCState:
    """Eagerly apply all Bjarnason-safe foundation moves. Returns reduced state."""
    foundations, tableau_tup, freecells_tup = state
    tableau = list(tableau_tup)
    freecells = list(freecells_tup)
    changed = True
    while changed:
        changed = False
        for col in range(TABLEAU_COLUMNS):
            if not tableau[col]:
                continue
            cid = tableau[col][-1]
            if _is_safe_to_foundation(cid, foundations):
                foundations = _replace4(foundations, _card_suit(cid), _card_rank(cid))
                tableau[col] = tableau[col][:-1]
                changed = True
        for fc in range(FREE_CELLS):
            cid = freecells[fc]
            if cid == EMPTY:
                continue
            if _is_safe_to_foundation(cid, foundations):
                foundations = _replace4(foundations, _card_suit(cid), _card_rank(cid))
                freecells[fc] = EMPTY
                changed = True
    return (
        foundations,
        tuple(tableau),
        (freecells[0], freecells[1], freecells[2], freecells[3]),
    )


# ---------------------------------------------------------------------------
# Canonical key for transposition table
# ---------------------------------------------------------------------------


def canonical_key(state: FCState) -> tuple:
    foundations, tableau, freecells = state
    return (foundations, tuple(sorted(freecells)), tuple(sorted(tableau)))


# ---------------------------------------------------------------------------
# Move generation (single-card moves only — sufficient for solvability)
# ---------------------------------------------------------------------------
# Move tuples:
#   ("tf",  col)          tableau-top → foundation
#   ("ff",  fc)           freecell    → foundation
#   ("fct", fc, col)      freecell    → tableau col
#   ("tt",  src, dst)     tableau-top → tableau col
#   ("tfc", col, fc)      tableau-top → freecell fc
#
# Key design principle: limit branching on freecell-parking (tfc) moves.
# With 8 columns, generating all 8 tfc candidates produces exponential
# branching on positions where no tableau-to-tableau moves exist. We score
# each candidate by how useful the card it exposes is, and only emit the
# top _TFC_LIMIT candidates. The canonical transposition key still deduplicates
# equivalent states, but limiting tfc candidates is crucial for performance.

_TFC_LIMIT = 8  # max freecell-parking candidates (no effective cap — all are generated)


def _exposes_useful(tableau: tuple, col: int, foundations: tuple) -> int:
    """Score 0-20 measuring how useful the card UNDER tableau[col][-1] is."""
    if len(tableau[col]) < 2:
        return 0
    under = tableau[col][-2]
    if foundations[_card_suit(under)] == _card_rank(under) - 1:
        return 20  # directly foundationable
    for tc in range(TABLEAU_COLUMNS):
        if tc != col and tableau[tc] and _can_stack(under, tableau[tc][-1]):
            return 10  # stackable on another column
    # 2-level lookahead: if we park the top, does any freecell card or
    # another tableau top then become stackable on 'under'?
    for tc in range(TABLEAU_COLUMNS):
        if tc != col and tableau[tc] and _can_stack(tableau[tc][-1], under):
            return 5  # something in the tableau can build on the exposed card
    return 0


def _legal_moves(state: FCState) -> list[tuple]:
    foundations, tableau, freecells = state
    moves: list[tuple] = []

    empty_fc = next((i for i, c in enumerate(freecells) if c == EMPTY), None)
    first_empty_col = next((i for i, c in enumerate(tableau) if not c), None)

    # 1. Foundation moves (always generate all — always good progress).
    for col in range(TABLEAU_COLUMNS):
        if not tableau[col]:
            continue
        cid = tableau[col][-1]
        if foundations[_card_suit(cid)] == _card_rank(cid) - 1:
            moves.append(("tf", col))
    for fc in range(FREE_CELLS):
        cid = freecells[fc]
        if cid != EMPTY and foundations[_card_suit(cid)] == _card_rank(cid) - 1:
            moves.append(("ff", fc))

    # 2. Freecell → non-empty tableau (always generate — frees up freecells).
    for fc in range(FREE_CELLS):
        cid = freecells[fc]
        if cid == EMPTY:
            continue
        for col in range(TABLEAU_COLUMNS):
            if tableau[col] and _can_stack(cid, tableau[col][-1]):
                moves.append(("fct", fc, col))

    # 3. Tableau → non-empty tableau.
    for src in range(TABLEAU_COLUMNS):
        if not tableau[src]:
            continue
        cid = tableau[src][-1]
        for dst in range(TABLEAU_COLUMNS):
            if dst != src and tableau[dst] and _can_stack(cid, tableau[dst][-1]):
                moves.append(("tt", src, dst))

    # 4. Freecell → first empty column (canonical: all empty cols are equivalent).
    if first_empty_col is not None:
        for fc in range(FREE_CELLS):
            if freecells[fc] != EMPTY:
                moves.append(("fct", fc, first_empty_col))

    # 5. Tableau top → first empty column.
    if first_empty_col is not None:
        for src in range(TABLEAU_COLUMNS):
            if src == first_empty_col or not tableau[src]:
                continue
            # Only generate if src column has more than one card — moving
            # a single card to an empty col produces a canonically equivalent
            # state (sorted columns) that the transposition table will
            # immediately prune when popped.
            if len(tableau[src]) > 1:
                moves.append(("tt", src, first_empty_col))

    # 6. Tableau → freecell (last resort). Score each candidate and only
    #    emit the top _TFC_LIMIT to avoid exponential branching on positions
    #    where no better move is available.
    if empty_fc is not None:
        scored: list[tuple[int, tuple]] = []
        for col in range(TABLEAU_COLUMNS):
            if not tableau[col]:
                continue
            expose_score = _exposes_useful(tableau, col, foundations)
            # Prefer parking higher-rank cards: they stay on freecell longer
            # before returning to foundation, so they're less "valuable" to
            # keep accessible than low-rank cards.
            rank_score = _card_rank(tableau[col][-1])
            scored.append((expose_score * 100 + rank_score, ("tfc", col, empty_fc)))
        scored.sort(reverse=True)
        moves.extend(m for _, m in scored[:_TFC_LIMIT])

    return moves


# ---------------------------------------------------------------------------
# Apply move
# ---------------------------------------------------------------------------


def _apply_move(state: FCState, m: tuple) -> FCState:
    foundations, tableau_tup, freecells_tup = state
    tableau = list(tableau_tup)
    freecells = list(freecells_tup)
    kind = m[0]

    if kind == "tf":
        col = m[1]
        cid = tableau[col][-1]
        foundations = _replace4(foundations, _card_suit(cid), _card_rank(cid))
        tableau[col] = tableau[col][:-1]

    elif kind == "ff":
        fc = m[1]
        cid = freecells[fc]
        foundations = _replace4(foundations, _card_suit(cid), _card_rank(cid))
        freecells[fc] = EMPTY

    elif kind == "fct":
        fc, col = m[1], m[2]
        cid = freecells[fc]
        freecells[fc] = EMPTY
        tableau[col] = tableau[col] + (cid,)

    elif kind == "tt":
        src, dst = m[1], m[2]
        cid = tableau[src][-1]
        tableau[src] = tableau[src][:-1]
        tableau[dst] = tableau[dst] + (cid,)

    elif kind == "tfc":
        col, fc = m[1], m[2]
        cid = tableau[col][-1]
        tableau[col] = tableau[col][:-1]
        freecells[fc] = cid

    return (
        foundations,
        tuple(tableau),
        (freecells[0], freecells[1], freecells[2], freecells[3]),
    )


# ---------------------------------------------------------------------------
# Solver — DFS with heuristic-ordered children
# ---------------------------------------------------------------------------
# Pure DFS (LIFO stack) is O(1) push/pop and avoids the O(log n) overhead of
# a priority queue. Children are sorted by a foundation-progress heuristic so
# the best move is explored first, preserving the greedy benefit without the
# heap.  The transposition table deduplicates canonically-equivalent boards.


def _h(state: FCState) -> int:
    """Priority score for a state: lower = explored first.

    Primary:   cards remaining for foundation (fewest = best progress).
    Secondary: freecells occupied (fewer = more flexibility).
    Tertiary:  accessible-but-not-yet-placed cards on tableau/freecells that
               are adjacent to the next foundation target — penalises states
               where "almost ready" cards are buried (buried means longer path).
    """
    foundations, tableau, freecells = state
    f0, f1, f2, f3 = foundations
    remaining = (13 - f0) + (13 - f1) + (13 - f2) + (13 - f3)
    fc_used = sum(1 for c in freecells if c != EMPTY)

    # Bonus: each tableau top or freecell card that is immediately playable
    # to the foundation reduces the estimated effort.
    ready = 0
    for col in tableau:
        if col:
            cid = col[-1]
            si = _CARD_SUIT[cid]
            if foundations[si] == _CARD_RANK[cid] - 1:
                ready += 1
    for cid in freecells:
        if cid != EMPTY:
            si = _CARD_SUIT[cid]
            if foundations[si] == _CARD_RANK[cid] - 1:
                ready += 1

    return remaining * 200 + fc_used * 10 - ready * 50


def solve(
    initial: FCState,
    state_budget: int = 200_000,
    limit_seconds: float = 8.0,
) -> bool:
    """DFS solver with heuristic-sorted children and a transposition table.

    Safe auto-moves are applied after every transition.  Children are pushed
    in REVERSE heuristic order so that the stack (LIFO) pops the best child
    first, giving greedy-first behaviour at O(1) cost.

    Returns True iff a winning sequence exists within budget/time caps.
    """
    initial = apply_safe_automoves(initial)
    if _is_win(initial[0]):
        return True

    seen: set[tuple] = set()
    stack: list[FCState] = [initial]
    explored = 0
    deadline = time.monotonic() + limit_seconds

    while stack:
        s = stack.pop()

        if _is_win(s[0]):
            return True

        key = canonical_key(s)
        if key in seen:
            continue
        seen.add(key)

        explored += 1
        if explored > state_budget:
            return False
        if explored % 5000 == 0 and time.monotonic() > deadline:
            return False

        children: list[tuple[int, FCState]] = []
        for m in _legal_moves(s):
            ns = apply_safe_automoves(_apply_move(s, m))
            if canonical_key(ns) not in seen:
                children.append((_h(ns), ns))

        # Sort descending (worst first) so the stack pops best first.
        children.sort(key=lambda x: x[0], reverse=True)
        for _, ns in children:
            stack.append(ns)

    return False


def is_solvable(seed: int, state_budget: int, limit_seconds: float) -> bool:
    return solve(deal(seed), state_budget=state_budget, limit_seconds=limit_seconds)


def _worker(args: tuple[int, int, float]) -> bool:
    """Multiprocessing worker: (seed, state_budget, limit_seconds) → bool."""
    seed, state_budget, limit_seconds = args
    return is_solvable(seed, state_budget, limit_seconds)


# ---------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------


def generate(
    count: int,
    start_seed: int,
    max_attempts: int,
    state_budget: int,
    limit_seconds: float,
    verbose: bool,
    workers: int = 1,
) -> list[int]:
    """Test seeds in parallel (workers > 1) to stay within the 5-minute wall-clock target."""
    if workers > 1:
        return _generate_parallel(
            count, start_seed, max_attempts, state_budget, limit_seconds, verbose, workers
        )

    seeds: list[int] = []
    seed = start_seed
    attempts = 0
    while len(seeds) < count and attempts < max_attempts:
        if is_solvable(seed, state_budget, limit_seconds):
            seeds.append(seed)
            if verbose:
                print(f"  +{seed} ({len(seeds)}/{count})", file=sys.stderr)
        seed += 1
        attempts += 1
    return seeds


def _generate_parallel(
    count: int,
    start_seed: int,
    max_attempts: int,
    state_budget: int,
    limit_seconds: float,
    verbose: bool,
    workers: int,
) -> list[int]:
    """Parallel variant using multiprocessing.Pool."""
    from multiprocessing import Pool

    seeds: list[int] = []
    seed = start_seed
    attempts = 0
    batch = workers * 8  # seeds per pool.map call

    with Pool(processes=workers) as pool:
        while len(seeds) < count and attempts < max_attempts:
            end = min(seed + batch, start_seed + max_attempts)
            candidates = list(range(seed, end))
            args = [(s, state_budget, limit_seconds) for s in candidates]
            results = pool.map(_worker, args)
            for s, ok in zip(candidates, results):
                if ok and len(seeds) < count:
                    seeds.append(s)
                    if verbose:
                        print(f"  +{s} ({len(seeds)}/{count})", file=sys.stderr)
            attempts += len(candidates)
            seed = end

    return seeds


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=500)
    parser.add_argument(
        "--start-seed",
        type=int,
        default=1,
        help="First seed to test. Re-running with the same value produces the same bank.",
    )
    parser.add_argument(
        "--max-attempts",
        type=int,
        default=3_000,
        help="Hard cap on seeds tested before giving up. With 50%% solver pass-rate and "
        "4 workers, 3000 attempts fits well inside the 5-minute wall-clock target.",
    )
    parser.add_argument(
        "--state-budget",
        type=int,
        default=200_000,
        help="Max distinct states explored per seed.",
    )
    parser.add_argument(
        "--limit-seconds",
        type=float,
        default=0.3,
        help="Per-seed wall-clock cap. Seeds exceeding this are skipped; with --workers "
        "the batch finishes in well under 5 minutes.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Parallel worker processes (0 = auto = cpu_count). Use 1 for serial mode.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "game"
        / "freecell"
        / "seeds.json",
    )
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    import os

    workers = args.workers if args.workers > 0 else (os.cpu_count() or 1)

    t0 = time.time()
    seeds = generate(
        count=args.count,
        start_seed=args.start_seed,
        max_attempts=args.max_attempts,
        state_budget=args.state_budget,
        limit_seconds=args.limit_seconds,
        verbose=args.verbose,
        workers=workers,
    )
    elapsed = time.time() - t0

    if len(seeds) < args.count:
        print(
            f"WARNING: only found {len(seeds)}/{args.count} seeds within "
            f"--max-attempts={args.max_attempts}. "
            f"Increase --max-attempts or decrease --count.",
            file=sys.stderr,
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps({"seeds": seeds}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {len(seeds)} seeds to {args.output} in {elapsed:.1f}s",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Klondike Solitaire solver + provably-solvable seed generator (#593).

Writes ``frontend/src/game/solitaire/seeds.json`` — a bank of integer
seeds that the TypeScript engine's ``dealGame`` uses to reproduce deals.
Each seed in the bank has been proven winnable by the included DFS
solver, so the live game never serves an unsolvable layout.

Protocol parity with the TS engine
----------------------------------
The Python deal in this script and ``createDeck`` / ``fisherYates`` in
``frontend/src/game/solitaire/engine.ts`` share the *exact* same:

- LCG parameters: ``a=1664525``, ``c=1013904223``, ``m=2**32``
- Fisher-Yates loop direction and ``j = floor(rng * (i + 1))`` index math
- Suit order: ``spades, hearts, diamonds, clubs``
- Rank order: ``1..13``
- Layout: column ``i`` gets ``i+1`` cards (only top face-up); remaining
  24 go to the stock.

Any drift between the two implementations will cause seed-specific
deals to diverge. The ``tests/test_gen_solitaire_seeds.py`` suite
exercises the LCG + shuffle to lock in the invariants.

Scaling up
----------
The generator is deterministic and resumable: given a fixed
``--start-seed``, it produces the same (seed, solvable?) classification
every run. To grow the bank, bump ``--count-draw1`` / ``--count-draw3``
or extend ``--start-seed`` range and re-run. Discarded seeds are
skipped, not re-searched.

Usage
-----
    python backend/scripts/gen_solitaire_seeds.py \\
        --count-draw1 50 --count-draw3 50 \\
        --output frontend/src/game/solitaire/seeds.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

# ---------------------------------------------------------------------------
# Deck + deal (mirrors frontend/src/game/solitaire/engine.ts exactly)
# ---------------------------------------------------------------------------

SUITS = ("spades", "hearts", "diamonds", "clubs")
RED_SUITS = frozenset({"hearts", "diamonds"})
RANKS = tuple(range(1, 14))
DECK_SIZE = 52
TABLEAU_COLUMNS = 7

# Card encoded as int: (suit_idx << 4) | rank. faceUp carried separately.
# suit_idx: 0=spades 1=hearts 2=diamonds 3=clubs. rank 1..13.
# Negative means face-down; we keep faceUp as a bit in a parallel structure
# at the State level so the Card int itself only encodes identity.


@dataclass(frozen=True)
class Card:
    suit: str
    rank: int
    face_up: bool

    @property
    def color(self) -> str:
        return "red" if self.suit in RED_SUITS else "black"


def lcg(seed: int):
    """LCG matching createSeededRng in engine.ts. Yields floats in [0, 1)."""
    state = seed & 0xFFFFFFFF
    while True:
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        yield state / 4294967296


def fresh_deck() -> list[Card]:
    """52 cards in canonical order (SUITS x RANKS), all face-down."""
    return [Card(suit=s, rank=r, face_up=False) for s in SUITS for r in RANKS]


def fisher_yates(deck: list[Card], rng: Iterator[float]) -> list[Card]:
    """In-place Fisher-Yates. Returns the same list for convenience.

    The iteration order (i from len-1 down to 1) and j computation
    (``floor(rng() * (i+1))``) must match the TS engine line-for-line or
    seeds diverge across the language boundary.
    """
    for i in range(len(deck) - 1, 0, -1):
        j = int(next(rng) * (i + 1))
        deck[i], deck[j] = deck[j], deck[i]
    return deck


def deal(seed: int) -> State:
    rng = lcg(seed)
    deck = fisher_yates(fresh_deck(), rng)
    tableau: list[tuple[Card, ...]] = []
    k = 0
    for col in range(TABLEAU_COLUMNS):
        pile: list[Card] = []
        for i in range(col + 1):
            c = deck[k]
            k += 1
            pile.append(Card(c.suit, c.rank, face_up=(i == col)))
        tableau.append(tuple(pile))
    stock: list[Card] = []
    while k < DECK_SIZE:
        c = deck[k]
        k += 1
        stock.append(Card(c.suit, c.rank, face_up=False))
    return State(
        draw_mode=1,  # overridden by caller
        tableau=tuple(tableau),
        foundations=((), (), (), ()),
        stock=tuple(stock),
        waste=(),
        recycle_count=0,
    )


# ---------------------------------------------------------------------------
# State + move application (solver-only; scoring/undo are irrelevant here)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class State:
    draw_mode: int  # 1 or 3
    tableau: tuple[tuple[Card, ...], ...]  # 7 columns
    foundations: tuple[tuple[Card, ...], ...]  # 4 piles in SUITS order
    stock: tuple[Card, ...]
    waste: tuple[Card, ...]
    recycle_count: int

    def key(self) -> tuple:
        """Hashable key for the transposition table. Omits draw_mode and
        recycle_count since they don't change what's reachable."""
        return (self.tableau, self.foundations, self.stock, self.waste)


def is_win(s: State) -> bool:
    total = sum(len(p) for p in s.foundations)
    return total == DECK_SIZE


def top(tup: tuple[Card, ...]) -> Card | None:
    return tup[-1] if tup else None


def can_stack_tableau(mover: Card, dest: Card | None) -> bool:
    if dest is None:
        return mover.rank == 13
    return mover.color != dest.color and mover.rank == dest.rank - 1


def can_stack_foundation(mover: Card, pile: tuple[Card, ...]) -> bool:
    if not pile:
        return mover.rank == 1
    t = pile[-1]
    return mover.suit == t.suit and mover.rank == t.rank + 1


def suit_index(suit: str) -> int:
    return SUITS.index(suit)


def reveal_top(pile: tuple[Card, ...]) -> tuple[Card, ...]:
    """If the current top is face-down, flip it. Used after a tableau move."""
    if not pile:
        return pile
    t = pile[-1]
    if t.face_up:
        return pile
    return pile[:-1] + (Card(t.suit, t.rank, face_up=True),)


def first_face_up_index(pile: tuple[Card, ...]) -> int:
    """Lowest index of a face-up card in *pile*, or ``len(pile)`` if none."""
    for i, c in enumerate(pile):
        if c.face_up:
            return i
    return len(pile)


def tableau_run_valid(run: tuple[Card, ...]) -> bool:
    """Alternating color + descending rank run of face-up cards."""
    if not run or not run[0].face_up:
        return False
    for i in range(1, len(run)):
        prev = run[i - 1]
        curr = run[i]
        if not curr.face_up:
            return False
        if prev.color == curr.color:
            return False
        if curr.rank != prev.rank - 1:
            return False
    return True


# Move is a tuple (kind, ...args). Keep small + hashable.
# Kinds: 'wt' waste->tableau, 'wf' waste->foundation,
# 'tt' tableau->tableau (fc, fi, tc), 'tf' tableau->foundation (fc),
# 'draw', 'recycle'.


def legal_moves(s: State) -> list[tuple]:
    moves: list[tuple] = []
    # Foundation-bound moves first (highest-priority for solver).
    wt = top(s.waste)
    if wt is not None and can_stack_foundation(wt, s.foundations[suit_index(wt.suit)]):
        moves.append(("wf",))
    for col, pile in enumerate(s.tableau):
        t = top(pile)
        if t is None or not t.face_up:
            continue
        if can_stack_foundation(t, s.foundations[suit_index(t.suit)]):
            moves.append(("tf", col))

    # Tableau-to-tableau moves (move any face-up run).
    for fc, src in enumerate(s.tableau):
        if not src:
            continue
        start = first_face_up_index(src)
        for fi in range(start, len(src)):
            run = src[fi:]
            if not tableau_run_valid(run):
                continue
            head = run[0]
            for tc, dst in enumerate(s.tableau):
                if tc == fc:
                    continue
                # Skip moves that dump the same rank onto an equivalent empty
                # column (noise in transposition search).
                if not can_stack_tableau(head, top(dst)):
                    continue
                # Skip moving a top-face-up-only run to another col unless it
                # reveals a face-down card or empties the column for a King.
                if fi == 0 and not dst:
                    # Moving entire column to another empty column — pointless.
                    continue
                moves.append(("tt", fc, fi, tc))

    # Waste -> tableau.
    if wt is not None:
        for tc, dst in enumerate(s.tableau):
            if can_stack_tableau(wt, top(dst)):
                moves.append(("wt", tc))

    # Draw from stock (flip up to draw_mode cards).
    if s.stock:
        moves.append(("draw",))
    elif s.waste:
        # No stock + has waste → recycle (counted so we limit retries).
        moves.append(("recycle",))
    return moves


def apply_move(s: State, m: tuple) -> State:
    kind = m[0]
    if kind == "wf":
        c = s.waste[-1]
        fi = suit_index(c.suit)
        new_foundations = _replace_tuple(
            s.foundations, fi, s.foundations[fi] + (Card(c.suit, c.rank, True),)
        )
        return State(
            draw_mode=s.draw_mode,
            tableau=s.tableau,
            foundations=new_foundations,
            stock=s.stock,
            waste=s.waste[:-1],
            recycle_count=s.recycle_count,
        )
    if kind == "tf":
        fc = m[1]
        src = s.tableau[fc]
        c = src[-1]
        si = suit_index(c.suit)
        new_src = reveal_top(src[:-1])
        new_foundations = _replace_tuple(s.foundations, si, s.foundations[si] + (c,))
        new_tableau = _replace_tuple(s.tableau, fc, new_src)
        return State(
            draw_mode=s.draw_mode,
            tableau=new_tableau,
            foundations=new_foundations,
            stock=s.stock,
            waste=s.waste,
            recycle_count=s.recycle_count,
        )
    if kind == "tt":
        fc, fi, tc = m[1], m[2], m[3]
        src = s.tableau[fc]
        dst = s.tableau[tc]
        run = src[fi:]
        new_src = reveal_top(src[:fi])
        new_dst = dst + run
        nt = list(s.tableau)
        nt[fc] = new_src
        nt[tc] = new_dst
        return State(
            draw_mode=s.draw_mode,
            tableau=tuple(nt),
            foundations=s.foundations,
            stock=s.stock,
            waste=s.waste,
            recycle_count=s.recycle_count,
        )
    if kind == "wt":
        tc = m[1]
        c = s.waste[-1]
        new_waste = s.waste[:-1]
        new_dst = s.tableau[tc] + (Card(c.suit, c.rank, True),)
        return State(
            draw_mode=s.draw_mode,
            tableau=_replace_tuple(s.tableau, tc, new_dst),
            foundations=s.foundations,
            stock=s.stock,
            waste=new_waste,
            recycle_count=s.recycle_count,
        )
    if kind == "draw":
        n = min(s.draw_mode, len(s.stock))
        drawn = tuple(Card(c.suit, c.rank, True) for c in reversed(s.stock[len(s.stock) - n :]))
        return State(
            draw_mode=s.draw_mode,
            tableau=s.tableau,
            foundations=s.foundations,
            stock=s.stock[: len(s.stock) - n],
            waste=s.waste + drawn,
            recycle_count=s.recycle_count,
        )
    if kind == "recycle":
        new_stock = tuple(Card(c.suit, c.rank, False) for c in reversed(s.waste))
        return State(
            draw_mode=s.draw_mode,
            tableau=s.tableau,
            foundations=s.foundations,
            stock=new_stock,
            waste=(),
            recycle_count=s.recycle_count + 1,
        )
    raise ValueError(f"unknown move: {m!r}")


def _replace_tuple(t: tuple, idx: int, value) -> tuple:
    return t[:idx] + (value,) + t[idx + 1 :]


# ---------------------------------------------------------------------------
# DFS solver
# ---------------------------------------------------------------------------


def solve(state: State, state_budget: int = 150_000, recycle_limit: int = 3) -> bool:
    """Return ``True`` iff a winning sequence exists within budget.

    ``state_budget`` is a hard cap on distinct states explored per game;
    ``recycle_limit`` bounds how many times the solver will cycle the
    waste back to stock. Both keep runtime bounded on pathological deals.
    """
    seen: set[tuple] = set()
    stack: list[State] = [state]
    explored = 0
    while stack:
        s = stack.pop()
        if is_win(s):
            return True
        if s.recycle_count > recycle_limit:
            continue
        key = s.key()
        if key in seen:
            continue
        seen.add(key)
        explored += 1
        if explored > state_budget:
            return False
        # Append in reverse order so highest-priority moves come off the
        # stack first (moves are already ordered by legal_moves).
        for m in reversed(legal_moves(s)):
            stack.append(apply_move(s, m))
    return False


def is_solvable(seed: int, draw_mode: int, state_budget: int) -> bool:
    s0 = deal(seed)
    s0 = State(
        draw_mode=draw_mode,
        tableau=s0.tableau,
        foundations=s0.foundations,
        stock=s0.stock,
        waste=s0.waste,
        recycle_count=0,
    )
    return solve(s0, state_budget=state_budget)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def generate(
    count_draw1: int,
    count_draw3: int,
    start_seed: int,
    max_attempts: int,
    state_budget: int,
    verbose: bool,
) -> tuple[list[int], list[int]]:
    draw1: list[int] = []
    draw3: list[int] = []
    attempts = 0
    seed = start_seed
    while (len(draw1) < count_draw1 or len(draw3) < count_draw3) and attempts < max_attempts:
        attempts += 1
        if len(draw1) < count_draw1 and is_solvable(seed, 1, state_budget):
            draw1.append(seed)
            if verbose:
                print(f"  draw1 +{seed} ({len(draw1)}/{count_draw1})", file=sys.stderr)
        if len(draw3) < count_draw3 and is_solvable(seed, 3, state_budget):
            draw3.append(seed)
            if verbose:
                print(f"  draw3 +{seed} ({len(draw3)}/{count_draw3})", file=sys.stderr)
        seed += 1
    return draw1, draw3


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count-draw1", type=int, default=50)
    parser.add_argument("--count-draw3", type=int, default=50)
    parser.add_argument(
        "--start-seed",
        type=int,
        default=1,
        help="First seed to test. Deterministic: re-running with the same value "
        "produces the same bank.",
    )
    parser.add_argument(
        "--max-attempts",
        type=int,
        default=200_000,
        help="Hard cap on seeds considered before giving up.",
    )
    parser.add_argument(
        "--state-budget",
        type=int,
        default=150_000,
        help="Max distinct states the DFS solver explores per seed.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "game"
        / "solitaire"
        / "seeds.json",
    )
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    t0 = time.time()
    draw1, draw3 = generate(
        count_draw1=args.count_draw1,
        count_draw3=args.count_draw3,
        start_seed=args.start_seed,
        max_attempts=args.max_attempts,
        state_budget=args.state_budget,
        verbose=args.verbose,
    )
    elapsed = time.time() - t0

    if len(draw1) < args.count_draw1 or len(draw3) < args.count_draw3:
        print(
            f"WARNING: only found {len(draw1)}/{args.count_draw1} draw1 and "
            f"{len(draw3)}/{args.count_draw3} draw3 within max_attempts",
            file=sys.stderr,
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps({"draw1": draw1, "draw3": draw3}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {len(draw1)} draw1 + {len(draw3)} draw3 seeds to {args.output} "
        f"in {elapsed:.1f}s",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

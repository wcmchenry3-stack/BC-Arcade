"""Shared pieces of the card-game seed-bank generators (#2972).

``gen_freecell_seeds.py`` and ``gen_solitaire_seeds.py`` both reproduce the
TypeScript engines' deal (``createSeededRng`` + ``fisherYates``), so the LCG,
the shuffle and the deck constants live here once. Changing ``lcg`` or
``fisher_yates`` breaks parity with ``frontend/src/game/*/engine.ts``;
``tests/test_gen_*_seeds.py`` lock that.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import TypeVar

SUITS = ("spades", "hearts", "diamonds", "clubs")
RANKS = tuple(range(1, 14))
DECK_SIZE = 52

_T = TypeVar("_T")


def lcg(seed: int) -> Iterator[float]:
    """LCG matching createSeededRng in engine.ts. Yields floats in [0, 1)."""
    state = seed & 0xFFFFFFFF
    while True:
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        yield state / 4294967296


def fisher_yates(deck: list[_T], rng: Iterator[float]) -> list[_T]:
    """In-place Fisher-Yates. Returns the same list for convenience.

    The iteration order (i from len-1 down to 1) and j computation
    (``floor(rng() * (i+1))``) must match the TS engine line-for-line or
    seeds diverge across the language boundary.
    """
    for i in range(len(deck) - 1, 0, -1):
        j = int(next(rng) * (i + 1))
        deck[i], deck[j] = deck[j], deck[i]
    return deck


def seed_bank_argparser(
    game: str,
    *,
    description: str | None,
    max_attempts: int,
    max_attempts_help: str,
    state_budget: int,
    state_budget_help: str,
) -> argparse.ArgumentParser:
    """Parser holding the flags both generators share.

    ``--start-seed``, ``--max-attempts``, ``--state-budget``, ``--output``
    (default ``frontend/src/game/<game>/seeds.json``) and ``--verbose``.
    Callers add their own flags (``--count*``, ``--workers`` ...) afterwards.
    """
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--start-seed",
        type=int,
        default=1,
        help="First seed to test. Deterministic: re-running with the same value "
        "produces the same bank.",
    )
    parser.add_argument("--max-attempts", type=int, default=max_attempts, help=max_attempts_help)
    parser.add_argument("--state-budget", type=int, default=state_budget, help=state_budget_help)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "game"
        / game
        / "seeds.json",
    )
    parser.add_argument("--verbose", action="store_true")
    return parser


def write_seed_bank(output: Path, bank: dict[str, list[int]], summary: str, elapsed: float) -> None:
    """Write ``bank`` as indented JSON (trailing newline) and log ``summary``."""
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(bank, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {summary} to {output} in {elapsed:.1f}s", file=sys.stderr)

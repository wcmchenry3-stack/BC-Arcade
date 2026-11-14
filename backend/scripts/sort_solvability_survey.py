"""Measure how often raw random Sort shuffles are unsolvable (#2764).

Run from ``backend/``:

    # Raw random shuffles of one configuration, no generator filters: the
    # rate that is inherent to (colours, empty bottles) at depth 4.
    python scripts/sort_solvability_survey.py config --colors 14 --empty 2 --deals 2000

Every deal is decided by ``sort.fast_solver.solve``: "unsolvable" means the
whole reachable state space was searched, "unknown" means the node budget ran
out first. Work is spread over processes (``--workers``).
"""

from __future__ import annotations

import argparse
import os
import random
import sys
import time
from collections import Counter
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sort.fast_solver import DEFAULT_BUDGET, DEPTH, solve

_BUDGET = DEFAULT_BUDGET


def _init(budget: int) -> None:
    global _BUDGET
    _BUDGET = budget


def _raw_deal(args: tuple[int, int, int]) -> tuple[bool | None, int]:
    n_colors, n_empty, seed = args
    rng = random.Random(seed)
    units = [chr(97 + c) for c in range(n_colors) for _ in range(DEPTH)]
    rng.shuffle(units)
    bottles = [units[i * DEPTH : (i + 1) * DEPTH] for i in range(n_colors)]
    bottles += [[] for _ in range(n_empty)]
    verdict, seen, _ = solve(bottles, _BUDGET)
    return verdict, seen


def _pct(n: int, d: int) -> str:
    return f"{100 * n / d:5.1f}%" if d else "  n/a"


def run_config(args: argparse.Namespace) -> None:
    jobs = [(args.colors, args.empty, args.first + i) for i in range(args.deals)]
    t0 = time.time()
    counts: Counter = Counter()
    with Pool(args.workers, initializer=_init, initargs=(args.budget,)) as pool:
        for verdict, _ in pool.imap_unordered(_raw_deal, jobs, chunksize=16):
            counts[verdict] += 1
    n = args.deals
    print(
        f"{args.colors} colours, {args.empty} empty, {n} raw shuffles: "
        f"unsolvable {counts[False]} ({_pct(counts[False], n).strip()}), "
        f"unknown {counts[None]}, solvable {counts[True]} "
        f"[{time.time() - t0:.1f}s]"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--budget", type=int, default=DEFAULT_BUDGET)
    parser.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    parser.add_argument("--first", type=int, default=0, help="first seed")
    sub = parser.add_subparsers(dest="mode", required=True)
    config = sub.add_parser("config", help="raw random shuffles of one configuration")
    config.add_argument("--colors", type=int, required=True)
    config.add_argument("--empty", type=int, required=True)
    config.add_argument("--deals", type=int, default=1000)
    args = parser.parse_args()
    run_config(args)


if __name__ == "__main__":
    main()

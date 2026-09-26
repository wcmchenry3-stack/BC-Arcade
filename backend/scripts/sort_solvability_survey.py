"""Measure how often Sort's served levels are unsolvable (#2764).

Two modes, both run from ``backend/``:

    # Deal N full sets with build_levels(seed) and decide every level.
    python scripts/sort_solvability_survey.py deals --seeds 300

    # Raw random shuffles of one configuration, no generator filters: the
    # rate that is inherent to (colours, empty bottles) at depth 4.
    python scripts/sort_solvability_survey.py config --colors 14 --empty 2 --deals 2000

Every level is decided by ``sort.fast_solver.solve``: "unsolvable" means the
whole reachable state space was searched, "unknown" means the node budget ran
out first. Work is spread over processes (``--workers``).
"""

from __future__ import annotations

import argparse
import os
import random
import sys
import time
from collections import Counter, defaultdict
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sort.fast_solver import DEFAULT_BUDGET, solve
from sort.generate_levels import DEPTH, LEVEL_SPECS, build_levels

_BUDGET = DEFAULT_BUDGET


def _init(budget: int) -> None:
    global _BUDGET
    _BUDGET = budget


def _survey_seed(seed: int) -> tuple[int, list[tuple[int, bool | None, int]]]:
    out = []
    for level in build_levels(seed):
        verdict, seen = solve(level["bottles"], _BUDGET)
        out.append((level["id"], verdict, seen))
    return seed, out


def _raw_deal(args: tuple[int, int, int]) -> tuple[bool | None, int]:
    n_colors, n_empty, seed = args
    rng = random.Random(seed)
    units = [chr(97 + c) for c in range(n_colors) for _ in range(DEPTH)]
    rng.shuffle(units)
    bottles = [units[i * DEPTH : (i + 1) * DEPTH] for i in range(n_colors)]
    bottles += [[] for _ in range(n_empty)]
    return solve(bottles, _BUDGET)


def _pct(n: int, d: int) -> str:
    return f"{100 * n / d:5.1f}%" if d else "  n/a"


def run_deals(args: argparse.Namespace) -> None:
    seeds = range(args.first, args.first + args.seeds)
    per_level: dict[int, Counter] = defaultdict(Counter)
    max_seen: dict[int, int] = defaultdict(int)
    bad_sets = 0
    unknown_sets = 0
    failures: list[tuple[int, int]] = []
    t0 = time.time()
    with Pool(args.workers, initializer=_init, initargs=(args.budget,)) as pool:
        for seed, results in pool.imap_unordered(_survey_seed, seeds, chunksize=2):
            verdicts = [v for _, v, _ in results]
            bad_sets += False in verdicts
            unknown_sets += None in verdicts and False not in verdicts
            for lid, verdict, seen in results:
                per_level[lid][verdict] += 1
                max_seen[lid] = max(max_seen[lid], seen)
                if verdict is False:
                    failures.append((seed, lid))
    elapsed = time.time() - t0
    n = len(seeds)
    print(f"{n} sets (seeds {args.first}..{args.first + n - 1}), budget {args.budget:,} states")
    print(f"sets with >=1 proven-unsolvable level: {bad_sets} ({_pct(bad_sets, n).strip()})")
    print(f"sets with an unknown level and no unsolvable one: {unknown_sets}")
    print()
    print("level colours empty  unsolvable        unknown   max states")
    for lid, colors, n_empty in LEVEL_SPECS:
        c = per_level[lid]
        print(
            f"{lid:>5} {len(colors):>7} {n_empty:>5}  {c[False]:>4} {_pct(c[False], n)}"
            f"  {c[None]:>4} {_pct(c[None], n)}  {max_seen[lid]:>10,}"
        )
    print()
    print("unsolvable (seed, level):", sorted(failures))
    print(f"elapsed {elapsed:.1f}s with {args.workers} workers")


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
    deals = sub.add_parser("deals", help="survey build_levels(seed) sets")
    deals.add_argument("--seeds", type=int, default=300)
    config = sub.add_parser("config", help="raw random shuffles of one configuration")
    config.add_argument("--colors", type=int, required=True)
    config.add_argument("--empty", type=int, required=True)
    config.add_argument("--deals", type=int, default=1000)
    args = parser.parse_args()
    if args.mode == "deals":
        run_deals(args)
    else:
        run_config(args)


if __name__ == "__main__":
    main()

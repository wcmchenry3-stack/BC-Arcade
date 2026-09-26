"""
Check Locust CSV output against SLOs defined in thresholds.json.

Usage:
    python perf/check_thresholds.py [--csv perf-results]

Reads <prefix>_stats.csv produced by `locust --csv <prefix>` and fails
(exit code 1) if any endpoint breaches its p95 or error-rate threshold.

The name mapping from Locust request names to threshold scenario keys is
done by matching on endpoint path substrings — see ENDPOINT_TO_SCENARIO.
"""

import argparse
import csv
import json
import sys
from pathlib import Path

# Map Locust request name substrings → threshold scenario key.
# Order matters: more specific patterns first.
ENDPOINT_TO_SCENARIO: list[tuple[str, str]] = [
    ("/games/leaderboard/", "leaderboard"),
    ("/yacht/new", "game_flow"),
    ("/yacht/roll", "game_flow"),
    ("/yacht/score", "game_flow"),
    ("/yacht/state", "stateless_reads"),
    ("/yacht/possible-scores", "stateless_reads"),
]


def scenario_for(name: str) -> str | None:
    for fragment, scenario in ENDPOINT_TO_SCENARIO:
        if fragment in name:
            return scenario
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default="perf-results", help="Locust --csv prefix")
    args = parser.parse_args()

    stats_file = Path(f"{args.csv}_stats.csv")
    thresholds_file = Path(__file__).parent / "thresholds.json"

    if not stats_file.exists():
        print(f"ERROR: {stats_file} not found. Run Locust with --csv {args.csv} first.")
        return 1

    thresholds = json.loads(thresholds_file.read_text())["scenarios"]
    failures: list[str] = []

    with stats_file.open(newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            name = row.get("Name", "")
            if name == "Aggregated":
                continue

            scenario = scenario_for(name)
            if scenario is None:
                continue

            slo = thresholds[scenario]

            # p95 check (column: "95%")
            p95_raw = row.get("95%", "").strip()
            if p95_raw and p95_raw != "N/A":
                p95_ms = float(p95_raw)
                limit = slo["p95_ms"]
                if p95_ms > limit:
                    failures.append(f"[{scenario}] {name}: p95={p95_ms:.0f}ms > limit {limit}ms")

            # Error rate check
            req_count_raw = row.get("Request Count", "0").strip()
            fail_count_raw = row.get("Failure Count", "0").strip()
            if req_count_raw and req_count_raw != "0":
                req_count = float(req_count_raw)
                fail_count = float(fail_count_raw or "0")
                error_pct = (fail_count / req_count) * 100
                limit = slo["error_rate_pct"]
                if error_pct > limit:
                    failures.append(
                        f"[{scenario}] {name}: error_rate={error_pct:.1f}% > limit {limit}%"
                    )

    if failures:
        print("PERFORMANCE THRESHOLD BREACHES:")
        for f in failures:
            print(f"  {f}")
        return 1

    print("All performance thresholds passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

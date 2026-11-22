#!/usr/bin/env python3
"""Decide whether tonight's nightly run plays the heavy jobs (#4054).

Usage (from the repo root, as .github/workflows/nightly.yml runs it):

    python3 tools/nightly/gate.py --head <sha> [--last-green <sha>] [--weekday 1-7] [--force true|false]

Prints ``key=value`` lines for ``$GITHUB_OUTPUT``:

- ``run``: ``true`` or ``false``.
- ``reason``: one line saying why, e.g. ``skipped, dev unchanged``.
- ``last_green``: the last-green SHA, or empty when the tag does not exist yet. The summary
  (report.py) shows the commit range from it.

The rules (issue #4054):

1. ``--force true`` (the workflow_dispatch input) always runs.
2. No ``nightly/last-green`` tag yet: run.
3. ``dev`` HEAD differs from the last-green SHA: run. A red night never moves the tag, so an
   unchanged ``dev`` after a red night re-runs the next night (it re-tests flakes).
4. Monday (UTC, ISO weekday 1): run even when ``dev`` is unchanged (a weekly signal).
5. Otherwise skip: "skipped, dev unchanged". A skipped night is not a green one.

Stdlib only, so the gate job needs no install step.
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from dataclasses import dataclass

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
MONDAY = 1
SKIP_UNCHANGED = "skipped, dev unchanged"


@dataclass(frozen=True)
class Decision:
    run: bool
    reason: str


def decide(head: str, last_green: str, weekday: int, force: bool) -> Decision:
    """Apply the rules in the module docstring. ``last_green`` is "" when there is no tag."""
    if force:
        return Decision(True, "forced (workflow_dispatch force=true)")
    if not last_green:
        return Decision(True, "no nightly/last-green tag yet")
    if head != last_green:
        return Decision(True, "dev changed since the last green night")
    if weekday == MONDAY:
        return Decision(True, "Monday: weekly run although dev is unchanged")
    return Decision(False, SKIP_UNCHANGED)


def outputs(head: str, last_green: str, weekday: int, force: bool) -> list[str]:
    decision = decide(head, last_green, weekday, force)
    return [
        f"run={'true' if decision.run else 'false'}",
        f"reason={decision.reason}",
        f"last_green={last_green}",
    ]


def _sha(value: str, *, optional: bool) -> str:
    value = value.strip().lower()
    if optional and not value:
        return ""
    if not SHA_RE.match(value):
        raise argparse.ArgumentTypeError(f"not a 40-character hex SHA: {value!r}")
    return value


def _bool(value: str) -> bool:
    lowered = value.strip().lower()
    if lowered in ("true", "1", "yes"):
        return True
    if lowered in ("", "false", "0", "no"):
        return False
    raise argparse.ArgumentTypeError(f"not a boolean: {value!r}")


def _weekday(value: str) -> int:
    day = int(value)
    if not 1 <= day <= 7:
        raise argparse.ArgumentTypeError(f"ISO weekday must be 1-7, got {day}")
    return day


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--head", required=True, type=lambda v: _sha(v, optional=False))
    parser.add_argument("--last-green", default="", type=lambda v: _sha(v, optional=True))
    parser.add_argument(
        "--weekday",
        type=_weekday,
        default=None,
        help="ISO weekday (1 = Monday); default: today in UTC",
    )
    parser.add_argument("--force", default="false", type=_bool)
    args = parser.parse_args(argv)
    weekday = args.weekday or dt.datetime.now(dt.UTC).isoweekday()
    print("\n".join(outputs(args.head, args.last_green, weekday, args.force)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

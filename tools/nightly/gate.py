#!/usr/bin/env python3
"""Decide whether tonight's nightly run plays the heavy jobs (#4054).

Usage (from the repo root, as .github/workflows/nightly.yml runs it):

    python3 tools/nightly/gate.py --head <sha> [--last-green <sha>] [--weekday 1-7] [--force true|false] \\
        [--event <github.event_name>] [--runs runs.json --run-id <id>]

Prints ``key=value`` lines for ``$GITHUB_OUTPUT``:

- ``run``: ``true`` or ``false``.
- ``reason``: one line saying why, e.g. ``skipped, dev unchanged``.
- ``last_green``: the last-green SHA, or empty when the tag does not exist yet. The summary
  (report.py) shows the commit range from it.
- ``trigger_missed`` and ``duplicate`` (only for ``--event schedule``): see rule 0.

The rules (issues #4054, #4056):

0. On a ``schedule`` event (the late GitHub fallback; the real trigger is the Render cron, which
   dispatches at 08:00 UTC): if another ``nightly.yml`` run was dispatched (``workflow_dispatch``: the Render cron or a manual run) in the last 20 hours, skip
   with "skipped, already ran today (external trigger)" (``duplicate=true``). The runs API is used
   rather than the last-green tag, because a red night does not move the tag. If none exists the
   external trigger was missed: the rules below apply and ``trigger_missed=true`` (the report
   subject says so). If the runs list could not be read, the rules below apply and nothing is
   flagged (fail open: a duplicate night is cheaper than a missed one).
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
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
MONDAY = 1
SKIP_UNCHANGED = "skipped, dev unchanged"
SKIP_DUPLICATE = "skipped, already ran today (external trigger)"
# Only dispatched runs dedupe a fallback: an earlier fallback (``schedule``) run that itself did
# nothing must not hide a missed Render trigger. The window is 20 h: the fallback fires between
# 08:37 UTC (on time) and about 08:00 + 10.6 h (late). Yesterday's 08:00 dispatch is at least
# 24 h 37 m before it and must stay outside the window; today's 08:00 dispatch is at most
# 10.6 h before it and must stay inside.
DEDUPE_HOURS = 20
DEDUPE_EVENT = "workflow_dispatch"


@dataclass(frozen=True)
class Decision:
    run: bool
    reason: str
    trigger_missed: bool = False
    duplicate: bool = False


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


def _created(value) -> dt.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.UTC)


def recent_other_runs(
    runs: list[dict],
    current_run_id: str,
    now: dt.datetime,
    hours: int = DEDUPE_HOURS,
    branch: str = "",
) -> int:
    """Count dispatched runs (not the current one) created within ``hours`` of ``now``, edge
    inclusive. With ``branch``, only runs on that branch count: a dispatch on a feature branch
    tests another SHA and must not stand in for the default-branch nightly (Codex, #4070)."""
    cutoff = now - dt.timedelta(hours=hours)
    count = 0
    for run in runs:
        if str(run.get("id")) == str(current_run_id) or run.get("event") != DEDUPE_EVENT:
            continue
        if branch and run.get("head_branch") != branch:
            continue
        created = _created(run.get("created_at"))
        if created is not None and cutoff <= created <= now:
            count += 1
    return count


def decide_scheduled(
    head: str, last_green: str, weekday: int, force: bool, other_runs: int | None
) -> Decision:
    """The rules for a ``schedule`` event. ``other_runs`` is None when it could not be read."""
    if other_runs:
        return Decision(False, SKIP_DUPLICATE, duplicate=True)
    base = decide(head, last_green, weekday, force)
    if other_runs is None:
        return base
    return Decision(base.run, base.reason, trigger_missed=True)


def outputs(
    head: str,
    last_green: str,
    weekday: int,
    force: bool,
    event: str = "workflow_dispatch",
    other_runs: int | None = None,
) -> list[str]:
    if event == "schedule":
        decision = decide_scheduled(head, last_green, weekday, force, other_runs)
    else:
        decision = decide(head, last_green, weekday, force)
    lines = [
        f"run={'true' if decision.run else 'false'}",
        f"reason={decision.reason}",
        f"last_green={last_green}",
    ]
    if event == "schedule":
        lines += [
            f"trigger_missed={'true' if decision.trigger_missed else 'false'}",
            f"duplicate={'true' if decision.duplicate else 'false'}",
        ]
    return lines


def _load_runs(path: str | None) -> list[dict] | None:
    """``[{id, created_at}]`` from the runs API (trimmed with --jq), or None when unreadable."""
    if not path:
        return None
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, list):
        return None
    return [item for item in data if isinstance(item, dict)]


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
    parser.add_argument("--event", default="workflow_dispatch", help="github.event_name")
    parser.add_argument(
        "--runs", help="JSON list of recent nightly.yml runs ({id, created_at, event, head_branch})"
    )
    parser.add_argument("--run-id", default="", help="this run's id, excluded from the count")
    parser.add_argument(
        "--branch", default="", help="only runs on this branch count (the default branch)"
    )
    args = parser.parse_args(argv)
    now = dt.datetime.now(dt.UTC)
    weekday = args.weekday or now.isoweekday()
    runs = _load_runs(args.runs)
    other_runs = (
        None if runs is None else recent_other_runs(runs, args.run_id, now, branch=args.branch)
    )
    print(
        "\n".join(outputs(args.head, args.last_green, weekday, args.force, args.event, other_runs))
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Build the nightly run summary (markdown) from the run's job results (#4054).

Usage (from the repo root, as the ``summary`` job of .github/workflows/nightly.yml runs it):

    python3 tools/nightly/report.py --needs needs.json --sha <sha> \\
        [--jobs jobs.jsonl] [--compare compare.json] [--last-green <sha>] \\
        [--gate-reason <text>] [--run-url <url>]

- ``--needs``: ``${{ toJSON(needs) }}`` of the summary job: ``{job_id: {result, outputs}}``.
- ``--jobs``: one JSON object per line from the Actions API
  (``gh api .../actions/runs/<id>/attempts/<n>/jobs --paginate --jq '.jobs[]'``), used for
  durations only. A called workflow's jobs are named ``<caller job id> / <inner name>``, so a
  nightly job's duration spans every API job whose name is its id or starts with ``<id> / ``.
- ``--compare``: ``{"total_commits": n, "commits": [{"sha", "message"}]}`` (the compare API,
  trimmed with ``--jq``) for the commit range since the last green night.

Missing or unreadable optional files leave that part out; the report never fails the job.
Story 2 (#4053) builds the email from ``build_report`` and ``overall``.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

# Jobs that are bookkeeping, not checks: they do not decide whether the night is green.
NON_HEAVY = frozenset({"gate", "tag-last-green"})
MAX_COMMITS = 50
HEADLINES = {"green": "✅ green", "red": "❌ red", "skipped": "⏭️ skipped, dev unchanged"}
ICONS = {
    "success": "✅ success",
    "failure": "❌ failure",
    "cancelled": "⛔ cancelled",
    "skipped": "⏭️ skipped",
}


def overall(needs: dict) -> str:
    """``skipped`` (dev unchanged), ``green`` (every heavy job succeeded) or ``red``.

    A failed or missing gate is red: nothing was tested, and nothing says why. So is a failed
    ``tag-last-green``: every check passed, but ``nightly/last-green`` did not move, so the next
    night would test the same range again.
    """
    gate = needs.get("gate") or {}
    if gate.get("result") != "success":
        return "red"
    if (gate.get("outputs") or {}).get("run") != "true":
        return "skipped"
    heavy = [v.get("result") for k, v in needs.items() if k not in NON_HEAVY]
    if (needs.get("tag-last-green") or {}).get("result") == "failure":
        return "red"
    return "green" if heavy and all(r == "success" for r in heavy) else "red"


def tag_line(needs: dict, sha: str) -> str:
    """Whether ``nightly/last-green`` moved, from the ``tag-last-green`` result."""
    result = (needs.get("tag-last-green") or {}).get("result")
    if result == "success":
        return f"moved to `{sha[:12]}`"
    if result == "failure":
        return "**not moved: `tag-last-green` failed** (every check passed; re-run that job)"
    return "not moved"


def _parse_time(value) -> dt.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return dt.datetime.fromisoformat(value)
    except ValueError:
        return None


def duration_seconds(job_id: str, api_jobs: list[dict]) -> int | None:
    """Wall-clock from the first matching API job's start to the last one's end."""
    starts, ends = [], []
    for job in api_jobs:
        name = job.get("name") or ""
        if name != job_id and not name.startswith(f"{job_id} / "):
            continue
        start, end = _parse_time(job.get("started_at")), _parse_time(job.get("completed_at"))
        if start and end:
            starts.append(start)
            ends.append(end)
    if not starts:
        return None
    return max(0, int((max(ends) - min(starts)).total_seconds()))


def format_duration(seconds: int | None) -> str:
    if seconds is None:
        return "—"
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    if hours:
        return f"{hours}h {minutes:02d}m"
    if minutes:
        return f"{minutes}m {secs:02d}s"
    return f"{secs}s"


def _note(info: dict) -> str:
    outputs = info.get("outputs") or {}
    retried = str(outputs.get("passed-on-retry") or "0").strip()
    if retried.isdigit() and int(retried) > 0:
        return f"{retried} flow(s) passed on retry"
    return ""


def _commit_lines(compare: dict | None, last_green: str) -> list[str]:
    if not last_green:
        return ["No `nightly/last-green` tag yet: this is the first tracked night."]
    if not compare:
        return ["_(commit list unavailable)_"]
    commits = compare.get("commits") or []
    total = compare.get("total_commits", len(commits))
    lines = [f"{total} commit(s) since the last green night:", ""]
    for commit in commits[-MAX_COMMITS:][::-1]:
        sha = str(commit.get("sha", ""))[:7]
        subject = str(commit.get("message", "")).splitlines()[0] if commit.get("message") else ""
        subject = subject.replace("<", "&lt;")[:100]
        lines.append(f"- `{sha}` {subject}")
    if total > MAX_COMMITS:
        lines.append(f"- …and {total - MAX_COMMITS} older")
    return lines


def build_report(
    *,
    sha: str,
    needs: dict,
    api_jobs: list[dict] | None = None,
    compare: dict | None = None,
    last_green: str = "",
    gate_reason: str = "",
    run_url: str = "",
) -> str:
    headline = HEADLINES[overall(needs)]
    range_text = f"`{last_green[:12]}..{sha[:12]}`" if last_green else "—"
    out = [
        f"## Nightly dev checks: {headline}",
        "",
        f"- **SHA:** `{sha}`",
        f"- **Commit range since last green:** {range_text}",
        f"- **nightly/last-green:** {tag_line(needs, sha)}",
    ]
    if gate_reason:
        out.append(f"- **Gate:** {gate_reason}")
    if run_url:
        out.append(f"- **Run:** {run_url}")
    out += ["", "### Commits", "", *_commit_lines(compare, last_green), ""]
    out += ["### Jobs", "", "| Job | Result | Duration | Notes |", "|---|---|---|---|"]
    for job_id, info in needs.items():
        result = info.get("result") or "unknown"
        out.append(
            f"| `{job_id}` | {ICONS.get(result, result)} | "
            f"{format_duration(duration_seconds(job_id, api_jobs or []))} | {_note(info)} |"
        )
    out.append("")
    return "\n".join(out)


def _load_json(path: str | None):
    if not path:
        return None
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _load_jsonl(path: str | None) -> list[dict]:
    if not path:
        return []
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError:
        return []
    jobs = []
    for line in text.splitlines():
        try:
            item = json.loads(line)
        except ValueError:
            continue
        if isinstance(item, dict):
            jobs.append(item)
    return jobs


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--needs", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--jobs")
    parser.add_argument("--compare")
    parser.add_argument("--last-green", default="")
    parser.add_argument("--gate-reason", default="")
    parser.add_argument("--run-url", default="")
    args = parser.parse_args(argv)
    needs = _load_json(args.needs)
    if not isinstance(needs, dict):
        needs = {}
    compare = _load_json(args.compare)
    print(
        build_report(
            sha=args.sha,
            needs=needs,
            api_jobs=_load_jsonl(args.jobs),
            compare=compare if isinstance(compare, dict) else None,
            last_green=args.last_green,
            gate_reason=args.gate_reason,
            run_url=args.run_url,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

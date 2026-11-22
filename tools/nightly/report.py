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

Email (#4055): ``--email-out payload.json --to <address> [--trigger-missed true] [--date YYYY-MM-DD]``
also writes the Resend request body (``from``, ``to``, ``subject``, plain ``text``) built by
``email_subject`` and ``build_email_text``. send_email.py posts it. The body is plain text, so
untrusted commit subjects need no HTML escaping. Repo, run and commit metadata only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

# Jobs that are bookkeeping, not checks: they do not decide whether the night is green.
NON_HEAVY = frozenset({"gate", "tag-last-green"})
EMAIL_FROM = "BC Arcade nightly <nightly@mail.buffingchi.com>"
MAX_EMAIL_COMMITS = 30
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

    A failed or missing gate is red: nothing was tested, and nothing says why. So is a failed or
    cancelled ``tag-last-green``: every check passed, but ``nightly/last-green`` did not move, so the next
    night would test the same range again.
    """
    gate = needs.get("gate") or {}
    if gate.get("result") != "success":
        return "red"
    if (gate.get("outputs") or {}).get("run") != "true":
        return "skipped"
    heavy = [v.get("result") for k, v in needs.items() if k not in NON_HEAVY]
    if (needs.get("tag-last-green") or {}).get("result") in ("failure", "cancelled"):
        return "red"
    return "green" if heavy and all(r == "success" for r in heavy) else "red"


def tag_line(needs: dict, sha: str) -> str:
    """Whether ``nightly/last-green`` moved, from the ``tag-last-green`` result."""
    result = (needs.get("tag-last-green") or {}).get("result")
    if result == "success":
        return f"moved to `{sha[:12]}`"
    if result == "failure":
        return "**not moved: `tag-last-green` failed** (every check passed; re-run that job)"
    if result == "cancelled":
        return "**not moved: `tag-last-green` was cancelled** (every check passed; re-run that job)"
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


_MARKDOWN_SPECIALS = re.compile(r"([\\`*_\[\]()!|#~])")


def _inline_text(text: str) -> str:
    """Render untrusted text (a commit subject) as plain text in markdown.

    HTML-escapes ``& < >`` and backslash-escapes markdown syntax, so a subject can't add a
    link, an image, a code span or a table cell to the run summary (security review, #4064).
    """
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return _MARKDOWN_SPECIALS.sub(r"\\\1", text)


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
        lines.append(f"- `{sha}` {_inline_text(subject[:100])}")
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


DEPENDABOT_SUBJECT = re.compile(r"^(?:Bump |(?:chore|build)\(deps)", re.IGNORECASE)
PR_NUMBER = re.compile(r"\(#(\d+)\)\s*$")


def dependabot_prs(compare: dict | None) -> list[tuple[str, str]]:
    """``[(pr number, subject)]`` for Dependabot merges in the range, newest first.

    A Dependabot squash-merge subject starts with ``Bump `` or ``chore(deps…)`` / ``build(deps…)``
    and ends with ``(#NNNN)``.
    """
    found = []
    for commit in reversed((compare or {}).get("commits") or []):
        message = str(commit.get("message", ""))
        subject = message.splitlines()[0] if message else ""
        pr = PR_NUMBER.search(subject)
        if pr and DEPENDABOT_SUBJECT.match(subject):
            found.append((pr.group(1), subject[:100]))
    return found


def email_subject(*, needs: dict, sha: str, date: str, trigger_missed: bool = False) -> str:
    """``[BC Arcade nightly] GREEN|RED|SKIPPED <date> <short sha>``, plus a missed-trigger note."""
    subject = f"[BC Arcade nightly] {overall(needs).upper()} {date} {sha[:7]}"
    if trigger_missed:
        subject += " (external trigger missed)"
    return subject


def build_email_text(  # noqa: PLR0913 - one keyword per input, like build_report
    *,
    sha: str,
    needs: dict,
    api_jobs: list[dict] | None = None,
    compare: dict | None = None,
    last_green: str = "",
    gate_reason: str = "",
    run_url: str = "",
    trigger_missed: bool = False,
) -> str:
    """Plain-text email body: SHA, range, Dependabot merges, per-job results, retries, links."""
    out = [f"Nightly dev checks: {overall(needs).upper()}", ""]
    if trigger_missed:
        out.append(
            "The external trigger (Render cron) did not start a run in the last 26 hours; this is "
            "the late GitHub fallback run. Check the Render cron job bc-arcade-nightly-trigger "
            "(docs/RENDER.md)."
        )
        out.append("")
    out.append(f"SHA: {sha}")
    out.append(
        f"Commit range since last green: {last_green[:12] + '..' + sha[:12] if last_green else '-'}"
    )
    out.append(f"nightly/last-green: {tag_line(needs, sha).replace('`', '').replace('**', '')}")
    if gate_reason:
        out.append(f"Gate: {gate_reason}")
    if run_url:
        out.append(f"Run: {run_url}")
    out += ["", "Dependabot merges in the range:"]
    bots = dependabot_prs(compare)
    out += [f"  #{pr} {subject}" for pr, subject in bots] or ["  none"]
    out += ["", "Commits:"]
    if not last_green:
        out.append("  first tracked night (no nightly/last-green tag yet)")
    elif not compare:
        out.append("  (commit list unavailable)")
    else:
        commits = compare.get("commits") or []
        total = compare.get("total_commits", len(commits))
        out.append(f"  {total} commit(s) since the last green night")
        for commit in commits[-MAX_EMAIL_COMMITS:][::-1]:
            message = str(commit.get("message", ""))
            subject = message.splitlines()[0] if message else ""
            out.append(f"  {str(commit.get('sha', ''))[:7]} {subject[:100]}")
        if total > MAX_EMAIL_COMMITS:
            out.append(f"  ...and {total - MAX_EMAIL_COMMITS} older")
    out += ["", "Jobs:"]
    for job_id, info in needs.items():
        result = info.get("result") or "unknown"
        duration = format_duration(duration_seconds(job_id, api_jobs or []))
        note = _note(info)
        out.append(f"  {job_id}: {result}, {duration}" + (f" ({note})" if note else ""))
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
    parser.add_argument("--email-out", help="write the Resend request body (JSON) here")
    parser.add_argument("--to", default="", help="email recipient (NIGHTLY_REPORT_TO)")
    parser.add_argument("--trigger-missed", default="false")
    parser.add_argument(
        "--date", default="", help="YYYY-MM-DD for the subject (default: today UTC)"
    )
    args = parser.parse_args(argv)
    needs = _load_json(args.needs)
    if not isinstance(needs, dict):
        needs = {}
    compare = _load_json(args.compare)
    compare = compare if isinstance(compare, dict) else None
    if args.email_out:
        missed = args.trigger_missed.strip().lower() == "true"
        date = args.date or dt.datetime.now(dt.UTC).date().isoformat()
        payload = {
            "from": EMAIL_FROM,
            "to": args.to.strip(),
            "subject": email_subject(needs=needs, sha=args.sha, date=date, trigger_missed=missed),
            "text": build_email_text(
                sha=args.sha,
                needs=needs,
                api_jobs=_load_jsonl(args.jobs),
                compare=compare,
                last_green=args.last_green,
                gate_reason=args.gate_reason,
                run_url=args.run_url,
                trigger_missed=missed,
            ),
        }
        Path(args.email_out).write_text(json.dumps(payload), encoding="utf-8")
    print(
        build_report(
            sha=args.sha,
            needs=needs,
            api_jobs=_load_jsonl(args.jobs),
            compare=compare,
            last_green=args.last_green,
            gate_reason=args.gate_reason,
            run_url=args.run_url,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

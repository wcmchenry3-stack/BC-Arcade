"""pytest suite for tools/nightly/report.py (#4054): the nightly run summary."""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / "report.py"
_spec = importlib.util.spec_from_file_location("nightly_report", SCRIPT)
report = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(report)

SHA = "c" * 40
LAST = "a" * 40


def gate(run="true", result="success"):
    return {"result": result, "outputs": {"run": run}}


def test_overall_green_red_skipped():
    green = {"gate": gate(), "cascade-sim": {"result": "success"}}
    assert report.overall(green) == "green"
    red = {"gate": gate(), "cascade-sim": {"result": "failure"}}
    assert report.overall(red) == "red"
    cancelled = {"gate": gate(), "cascade-sim": {"result": "cancelled"}}
    assert report.overall(cancelled) == "red"
    skipped = {"gate": gate("false"), "cascade-sim": {"result": "skipped"}}
    assert report.overall(skipped) == "skipped"


def test_overall_ignores_bookkeeping_jobs_and_fails_without_gate():
    needs = {"gate": gate(), "perf": {"result": "success"}, "tag-last-green": {"result": "skipped"}}
    assert report.overall(needs) == "green"
    assert report.overall({"gate": gate(result="failure")}) == "red"
    assert report.overall({}) == "red"
    # A run with no heavy job at all is not green.
    assert report.overall({"gate": gate()}) == "red"


def test_duration_spans_called_workflow_jobs():
    jobs = [
        {
            "name": "yacht-sim / Bands (self-play)",
            "started_at": "2026-11-22T08:00:00Z",
            "completed_at": "2026-11-22T08:30:00Z",
        },
        {
            "name": "yacht-sim / Regret (EV-loss vs oracle)",
            "started_at": "2026-11-22T08:01:00Z",
            "completed_at": "2026-11-22T08:45:10Z",
        },
        {
            "name": "yacht-simulator / other",
            "started_at": "2026-11-22T07:00:00Z",
            "completed_at": "2026-11-22T09:00:00Z",
        },
        {"name": "yacht-sim / queued", "started_at": None, "completed_at": None},
    ]
    assert report.duration_seconds("yacht-sim", jobs) == 45 * 60 + 10
    assert report.duration_seconds("perf", jobs) is None


def test_format_duration():
    assert report.format_duration(None) == "—"
    assert report.format_duration(42) == "42s"
    assert report.format_duration(12 * 60 + 5) == "12m 05s"
    assert report.format_duration(3600 + 2 * 60 + 59) == "1h 02m"


def test_report_lists_sha_range_and_every_job():
    needs = {
        "gate": gate(),
        "maestro-android": {"result": "success", "outputs": {"passed-on-retry": "2"}},
        "cascade-sim": {"result": "failure", "outputs": {}},
        "tag-last-green": {"result": "skipped"},
    }
    api_jobs = [
        {
            "name": "cascade-sim / Cascade sim (full suite, 60 and 120 Hz)",
            "started_at": "2026-11-22T08:00:00Z",
            "completed_at": "2026-11-22T08:50:00Z",
        }
    ]
    compare = {
        "total_commits": 2,
        "commits": [
            {"sha": "1" * 40, "message": "feat: older\n\nbody"},
            {"sha": "2" * 40, "message": "fix: <b>newer</b>"},
        ],
    }
    md = report.build_report(
        sha=SHA,
        needs=needs,
        api_jobs=api_jobs,
        compare=compare,
        last_green=LAST,
        gate_reason="dev changed since the last green night",
        run_url="https://example.test/run/1",
    )
    assert md.startswith("## Nightly dev checks: ❌ red")
    assert f"`{SHA}`" in md
    assert f"`{LAST[:12]}..{SHA[:12]}`" in md
    assert "2 commit(s) since the last green night" in md
    # Newest first, first line only, HTML neutralised.
    assert md.index("`2222222` fix: &lt;b&gt;newer&lt;/b&gt;") < md.index("`1111111` feat: older")
    assert "body" not in md
    assert "| `cascade-sim` | ❌ failure | 50m 00s |  |" in md
    assert "| `maestro-android` | ✅ success | — | 2 flow(s) passed on retry |" in md
    assert "| `tag-last-green` | ⏭️ skipped | — |  |" in md
    assert "| `gate` | ✅ success |" in md


def test_report_for_a_skipped_night():
    needs = {"gate": gate("false"), "perf": {"result": "skipped"}}
    md = report.build_report(
        sha=SHA, needs=needs, last_green=SHA, gate_reason="skipped, dev unchanged"
    )
    assert md.startswith("## Nightly dev checks: ⏭️ skipped, dev unchanged")


def test_report_without_tag_or_compare():
    md = report.build_report(sha=SHA, needs={"gate": gate()})
    assert "No `nightly/last-green` tag yet" in md
    assert "**Commit range since last green:** —" in md
    md = report.build_report(sha=SHA, needs={"gate": gate()}, last_green=LAST)
    assert "_(commit list unavailable)_" in md


def test_report_caps_long_commit_lists():
    commits = [{"sha": f"{i:040x}", "message": f"c{i}"} for i in range(60)]
    md = report.build_report(
        sha=SHA,
        needs={"gate": gate()},
        compare={"total_commits": 300, "commits": commits},
        last_green=LAST,
    )
    assert md.count("\n- `") == report.MAX_COMMITS
    assert "…and 250 older" in md
    assert "c59" in md and "c9\n" not in md


def test_cli_tolerates_missing_and_bad_files(tmp_path):
    needs = tmp_path / "needs.json"
    needs.write_text(json.dumps({"gate": gate(), "perf": {"result": "success"}}))
    jobs = tmp_path / "jobs.jsonl"
    jobs.write_text(
        '{"name": "perf / Lighthouse CI", "started_at": "2026-11-22T08:00:00Z",'
        ' "completed_at": "2026-11-22T08:00:30Z"}\nnot json\n[]\n'
    )
    bad = tmp_path / "compare.json"
    bad.write_text("{")
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--needs",
            str(needs),
            "--sha",
            SHA,
            "--jobs",
            str(jobs),
            "--compare",
            str(bad),
            "--last-green",
            LAST,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    assert "## Nightly dev checks: ✅ green" in proc.stdout
    assert "| `perf` | ✅ success | 30s |  |" in proc.stdout
    assert "_(commit list unavailable)_" in proc.stdout


def test_cli_with_missing_needs_file_reports_red(tmp_path):
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "--needs", str(tmp_path / "nope.json"), "--sha", SHA],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0
    assert "❌ red" in proc.stdout


def test_failed_tag_job_makes_the_night_red_and_says_so():
    needs = {
        "gate": gate(),
        "perf": {"result": "success"},
        "tag-last-green": {"result": "failure"},
    }
    assert report.overall(needs) == "red"
    md = report.build_report(sha=SHA, needs=needs, last_green=LAST)
    assert md.startswith("## Nightly dev checks: ❌ red")
    assert "**nightly/last-green:** **not moved: `tag-last-green` failed**" in md


def test_tag_line_for_moved_and_not_moved():
    assert (
        report.tag_line({"tag-last-green": {"result": "success"}}, SHA) == f"moved to `{SHA[:12]}`"
    )
    assert report.tag_line({"tag-last-green": {"result": "skipped"}}, SHA) == "not moved"
    assert report.tag_line({}, SHA) == "not moved"


def test_cancelled_tag_job_makes_the_night_red_and_says_so():
    needs = {
        "gate": gate(),
        "perf": {"result": "success"},
        "tag-last-green": {"result": "cancelled"},
    }
    assert report.overall(needs) == "red"
    md = report.build_report(sha=SHA, needs=needs, last_green=LAST)
    assert md.startswith("## Nightly dev checks: ❌ red")
    assert "**nightly/last-green:** **not moved: `tag-last-green` was cancelled**" in md


def test_commit_subjects_cannot_inject_markdown():
    """Security review (#4064): a commit subject renders as plain text in the summary."""
    compare = {
        "total_commits": 1,
        "commits": [
            {
                "sha": "3" * 40,
                "message": "x ![img](https://evil.test/a.png) [click](https://evil.test) `code` | cell & more",
            }
        ],
    }
    md = report.build_report(
        sha=SHA,
        needs={"gate": {"result": "success", "outputs": {"run": "true"}}},
        api_jobs=[],
        compare=compare,
        last_green=LAST,
        gate_reason="dev changed since the last green night",
        run_url="https://example.test/run/1",
    )
    line = next(l for l in md.splitlines() if l.startswith("- `3333333`"))
    assert "](" not in line.replace("\\](", "").replace("\\]\\(", "")
    assert "\\!\\[img\\]\\(https://evil.test/a.png\\)" in line
    assert "\\[click\\]\\(https://evil.test\\)" in line
    assert "\\`code\\`" in line
    assert "\\| cell &amp; more" in line


# ---- Email (#4055) ---------------------------------------------------------------------------

NEEDS_GREEN = {
    "gate": gate(),
    "perf": {"result": "success"},
    "tag-last-green": {"result": "success"},
}
NEEDS_RED = {"gate": gate(), "perf": {"result": "failure"}}
NEEDS_SKIPPED = {"gate": gate("false"), "perf": {"result": "skipped"}}
DEP_COMPARE = {
    "total_commits": 4,
    "commits": [
        {"sha": "1" * 40, "message": "feat: thing (#10)"},
        {"sha": "2" * 40, "message": "chore(deps): bump zod from 3 to 4 (#4001)"},
        {"sha": "3" * 40, "message": "Bump actions/checkout from 6 to 7 (#4002)"},
        {"sha": "4" * 40, "message": "chore(deps-dev): bump x (not a PR number)"},
    ],
}


def test_email_subject_for_green_red_skipped_and_missed():
    kw = {"sha": SHA, "date": "2026-11-22"}
    head = "[BC Arcade nightly]"
    assert report.email_subject(needs=NEEDS_GREEN, **kw) == f"{head} GREEN 2026-11-22 ccccccc"
    assert report.email_subject(needs=NEEDS_RED, **kw) == f"{head} RED 2026-11-22 ccccccc"
    assert report.email_subject(needs=NEEDS_SKIPPED, **kw) == f"{head} SKIPPED 2026-11-22 ccccccc"
    assert (
        report.email_subject(needs=NEEDS_RED, trigger_missed=True, **kw)
        == f"{head} RED 2026-11-22 ccccccc (external trigger missed)"
    )
    cancelled = {"gate": gate(), "perf": {"result": "cancelled"}}
    assert " RED " in report.email_subject(needs=cancelled, **kw)


def test_dependabot_prs_by_number_newest_first():
    assert report.dependabot_prs(DEP_COMPARE) == [
        ("4002", "Bump actions/checkout from 6 to 7 (#4002)"),
        ("4001", "chore(deps): bump zod from 3 to 4 (#4001)"),
    ]
    assert report.dependabot_prs(None) == []
    assert report.dependabot_prs({"commits": [{"sha": "1", "message": ""}]}) == []


def test_email_text_has_sha_range_dependabot_jobs_retries_and_links():
    needs = {
        "gate": gate(),
        "maestro-ios": {"result": "success", "outputs": {"passed-on-retry": "3"}},
        "perf": {"result": "failure"},
    }
    api_jobs = [
        {
            "name": "perf / Lighthouse",
            "started_at": "2026-11-22T08:00:00Z",
            "completed_at": "2026-11-22T08:10:00Z",
        }
    ]
    text = report.build_email_text(
        sha=SHA,
        needs=needs,
        api_jobs=api_jobs,
        compare=DEP_COMPARE,
        last_green=LAST,
        gate_reason="dev changed since the last green night",
        run_url="https://example.test/run/1",
    )
    assert text.startswith("Nightly dev checks: RED")
    assert f"SHA: {SHA}" in text
    assert f"Commit range since last green: {LAST[:12]}..{SHA[:12]}" in text
    assert "  #4001 chore(deps): bump zod from 3 to 4 (#4001)" in text
    assert "Run: https://example.test/run/1" in text
    assert "  perf: failure, 10m 00s" in text
    assert "  maestro-ios: success, — (3 flow(s) passed on retry)" in text
    assert "4 commit(s) since the last green night" in text
    assert "did not start a run" not in text


def test_email_text_says_when_the_trigger_was_missed_and_when_no_dependabot():
    text = report.build_email_text(sha=SHA, needs=NEEDS_GREEN, trigger_missed=True)
    assert "did not start a run in the last 26 hours" in text
    assert "bc-arcade-nightly-trigger" in text
    assert "Dependabot merges in the range:\n  none" in text
    assert "first tracked night" in text


def test_email_text_is_plain_text_with_untrusted_subjects_verbatim():
    compare = {"total_commits": 1, "commits": [{"sha": "5" * 40, "message": "<b>x</b> & [y](z)"}]}
    text = report.build_email_text(sha=SHA, needs=NEEDS_GREEN, compare=compare, last_green=LAST)
    assert "5555555 <b>x</b> & [y](z)" in text  # text/plain: no HTML to inject into


def test_cli_writes_the_resend_payload(tmp_path):
    needs = tmp_path / "needs.json"
    needs.write_text(json.dumps(NEEDS_RED))
    out = tmp_path / "email.json"
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--needs",
            str(needs),
            "--sha",
            SHA,
            "--to",
            "owner@example.test",
            "--email-out",
            str(out),
            "--date",
            "2026-11-22",
            "--trigger-missed",
            "true",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(out.read_text())
    assert payload["from"] == "BC Arcade nightly <nightly@mail.buffingchi.com>"
    assert payload["to"] == "owner@example.test"
    assert payload["subject"] == (
        "[BC Arcade nightly] RED 2026-11-22 ccccccc (external trigger missed)"
    )
    assert payload["text"].startswith("Nightly dev checks: RED")

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
    assert md.index("`2222222` fix: &lt;b>newer&lt;/b>") < md.index("`1111111` feat: older")
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

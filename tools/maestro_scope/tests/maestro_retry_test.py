"""pytest suite for the nightly Maestro retry (#4054): e2e/maestro/retry.py picks the failed
flows to re-run once and decides the result, and e2e/maestro/summarize.py shows "PASS on retry"
separately (and leaves the table unchanged when nothing was retried)."""

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
MAESTRO = ROOT / "e2e" / "maestro"
WORKFLOWS = ROOT / ".github" / "workflows"


def load(name):
    spec = importlib.util.spec_from_file_location(name, MAESTRO / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


retry = load("retry")
summarize = load("summarize")


def junit(path, cases=(), suite_failures=None):
    """Write a Maestro-style junit report. cases: (name, failed) pairs."""
    path.parent.mkdir(parents=True, exist_ok=True)
    body = "".join(
        f'<testcase name="{n}">{"<failure>boom</failure>" if f else ""}</testcase>'
        for n, f in cases
    )
    failures = suite_failures if suite_failures is not None else sum(f for _, f in cases)
    path.write_text(
        f'<testsuites><testsuite name="s" failures="{failures}">{body}</testsuite></testsuites>'
    )


@pytest.fixture
def ws(tmp_path, monkeypatch):
    """A workspace with flows e2e/maestro/flows/{home,yacht}/*.yaml, cwd set to it."""
    for d, names in {"home": ["smoke", "nav"], "yacht": ["smoke"]}.items():
        for n in names:
            f = tmp_path / "e2e" / "maestro" / "flows" / d / f"{n}.yaml"
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text("appId: x\n---\n")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("GITHUB_OUTPUT", raising=False)
    return tmp_path


def test_plan_lists_only_the_failed_flows(ws):
    junit(ws / "maestro-results/home/report.xml", [("smoke", False), ("nav", True)])
    assert retry.plan("home") == [("e2e/maestro/flows/home/nav.yaml", "maestro-retry/home/nav.xml")]


def test_plan_is_empty_when_everything_passed(ws):
    junit(ws / "maestro-results/home/report.xml", [("smoke", False), ("nav", False)])
    assert retry.plan("home") == []


@pytest.mark.parametrize(
    "setup",
    [
        lambda _ws: None,  # no report: a parse error or crashed runner
        lambda ws: (ws / "maestro-results/home").mkdir(parents=True)
        or (ws / "maestro-results/home/report.xml").write_text("<oops"),
        lambda ws: junit(ws / "maestro-results/home/report.xml", [], suite_failures=1),
        lambda ws: junit(ws / "maestro-results/home/report.xml", [("Renamed flow", True)]),
        lambda ws: junit(ws / "maestro-results/home/report.xml", [("../../etc", True)]),
    ],
)
def test_plan_falls_back_to_the_whole_directory(ws, setup):
    setup(ws)
    assert retry.plan("home") == [("e2e/maestro/flows/home/", "maestro-retry/home/__all__.xml")]


def test_plan_rejects_unsafe_directory_names():
    assert retry.plan("home; rm -rf /") == []
    assert retry.plan("../x") == []


def test_verdict_passes_when_the_retry_clears_every_failure(ws):
    junit(ws / "maestro-results/home/report.xml", [("smoke", False), ("nav", True)])
    junit(ws / "maestro-results/yacht/report.xml", [("smoke", False)])
    junit(ws / "maestro-retry/home/nav.xml", [("nav", False)])
    assert retry.remaining_failures(["home", "yacht"]) == []
    assert retry.main(["verdict", "home", "yacht"]) == 0


def test_verdict_fails_when_a_flow_fails_twice(ws, capsys):
    junit(ws / "maestro-results/home/report.xml", [("smoke", True), ("nav", True)])
    junit(ws / "maestro-retry/home/nav.xml", [("nav", False)])
    junit(ws / "maestro-retry/home/smoke.xml", [("smoke", True)])
    assert retry.remaining_failures(["home"]) == ["home/smoke"]
    assert retry.main(["verdict", "home"]) == 1
    assert "::error::Maestro flow home/smoke failed" in capsys.readouterr().out


def test_verdict_fails_when_a_failure_was_never_retried(ws):
    junit(ws / "maestro-results/home/report.xml", [("nav", True)])
    assert retry.remaining_failures(["home"]) == ["home/nav"]


def test_verdict_for_a_directory_without_report(ws):
    assert retry.remaining_failures(["yacht"]) == ["yacht"]
    junit(ws / "maestro-retry/yacht/__all__.xml", [("smoke", False)])
    assert retry.remaining_failures(["yacht"]) == []


def test_unreadable_retry_report_does_not_count_as_a_pass(ws):
    junit(ws / "maestro-results/home/report.xml", [], suite_failures=1)
    (ws / "maestro-retry/home").mkdir(parents=True)
    (ws / "maestro-retry/home/__all__.xml").write_text("<oops")
    assert retry.remaining_failures(["home"]) == ["home"]


def test_plan_cli_prints_path_pairs(ws):
    junit(ws / "maestro-results/home/report.xml", [("nav", True), ("smoke", True)])
    proc = subprocess.run(
        [sys.executable, str(MAESTRO / "retry.py"), "plan", "home"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.splitlines() == [
        "e2e/maestro/flows/home/nav.yaml maestro-retry/home/nav.xml",
        "e2e/maestro/flows/home/smoke.yaml maestro-retry/home/smoke.xml",
    ]


def test_summary_without_retry_is_unchanged(ws):
    junit(ws / "maestro-results/home/report.xml", [("smoke", False), ("nav", True)])
    assert summarize.build_rows(["home", "yacht"]) == [
        "| `home/smoke` | ✅ PASS |\n",
        "| `home/nav` | ❌ FAIL |\n",
        "| `yacht` | ❌ FAIL _(no report: flow parse error or runner crash)_ |\n",
    ]


def test_summary_marks_passed_on_retry_and_counts_it(ws, monkeypatch):
    junit(ws / "maestro-results/home/report.xml", [("smoke", True), ("nav", True)])
    junit(ws / "maestro-retry/home/nav.xml", [("nav", False)])
    junit(ws / "maestro-retry/home/smoke.xml", [("smoke", True)])
    junit(ws / "maestro-retry/yacht/__all__.xml", [("smoke", False)])
    summary, output = ws / "summary.md", ws / "output"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    summarize.main("Android", "full suite", ["home", "yacht"])
    text = summary.read_text()
    assert "| `home/smoke` | ❌ FAIL |" in text
    assert "| `home/nav` | 🔁 PASS on retry |" in text
    assert "| `yacht` | 🔁 PASS on retry _(no report" in text
    assert "**Passed on retry:** 2 flow(s)" in text
    assert output.read_text() == "passed_on_retry=2\n"


def test_summary_writes_zero_when_nothing_was_retried(ws, monkeypatch):
    junit(ws / "maestro-results/home/report.xml", [("smoke", False)])
    summary, output = ws / "summary.md", ws / "output"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    summarize.main("iOS", "full suite", ["home"])
    assert "Passed on retry" not in summary.read_text()
    assert output.read_text() == "passed_on_retry=0\n"


@pytest.mark.parametrize("name", ["mobile-smoke-android.yml", "mobile-smoke-ios.yml"])
def test_smoke_workflows_retry_only_when_called_by_the_nightly(name):
    data = yaml.safe_load((WORKFLOWS / name).read_text())
    call = data[True]["workflow_call"]
    assert call["inputs"]["nightly"]["default"] is False
    assert "passed-on-retry" in call["outputs"]
    job = next(j for j in data["jobs"].values() if "MAESTRO_RETRY" in (j.get("env") or {}))
    assert job["env"]["MAESTRO_RETRY"] == "${{ inputs.nightly && 'true' || 'false' }}"
    text = (WORKFLOWS / name).read_text()
    assert "e2e/maestro/retry.py plan" in text and "e2e/maestro/retry.py verdict" in text


def test_nonzero_exit_without_a_failed_case_reruns_the_directory(ws):
    junit(ws / "maestro-results/home/report.xml", [("smoke", False), ("nav", False)])
    (ws / "maestro-results/home/maestro-failed").write_text("")
    assert retry.plan("home") == [("e2e/maestro/flows/home/", "maestro-retry/home/__all__.xml")]
    assert retry.remaining_failures(["home"]) == ["home"]
    junit(ws / "maestro-retry/home/__all__.xml", [("smoke", False), ("nav", False)])
    assert retry.remaining_failures(["home"]) == []


def test_report_with_no_test_case_fails_even_with_exit_zero(ws):
    junit(ws / "maestro-results/home/report.xml", [], suite_failures=0)
    assert retry.plan("home") == [("e2e/maestro/flows/home/", "maestro-retry/home/__all__.xml")]
    assert retry.remaining_failures(["home"]) == ["home"]
    # An empty retry report is not a pass either.
    junit(ws / "maestro-retry/home/__all__.xml", [], suite_failures=0)
    assert retry.remaining_failures(["home"]) == ["home"]


def test_retry_with_nonzero_exit_and_a_clean_report_is_not_a_pass(ws):
    junit(ws / "maestro-results/home/report.xml", [("smoke", False), ("nav", True)])
    (ws / "maestro-results/home/maestro-failed").write_text("")
    junit(ws / "maestro-retry/home/nav.xml", [("nav", False)])
    (ws / "maestro-retry/home/nav.xml.failed").write_text("")
    assert retry.remaining_failures(["home"]) == ["home/nav"]


def test_case_failure_with_exit_marker_still_retries_only_that_flow(ws):
    junit(ws / "maestro-results/home/report.xml", [("smoke", False), ("nav", True)])
    (ws / "maestro-results/home/maestro-failed").write_text("")
    assert retry.plan("home") == [("e2e/maestro/flows/home/nav.yaml", "maestro-retry/home/nav.xml")]


@pytest.mark.parametrize("name", ["mobile-smoke-android.yml", "mobile-smoke-ios.yml"])
def test_smoke_workflows_record_nonzero_exits(name):
    text = (WORKFLOWS / name).read_text()
    assert 'FAIL=1; touch "maestro-results/$d/maestro-failed";' in text
    assert '< /dev/null || touch "$O.failed"' in text


def android_script_lines():
    data = yaml.safe_load((WORKFLOWS / "mobile-smoke-android.yml").read_text())
    step = next(
        s
        for s in data["jobs"]["maestro-android"]["steps"]
        if str(s.get("uses", "")).startswith("reactivecircus/android-emulator-runner")
    )
    return step["with"]["script"].splitlines()


def test_android_off_nightly_exits_with_the_loop_result():
    lines = android_script_lines()
    loop = next(ln for ln in lines if ln.startswith("FAIL=0; for d in $MAESTRO_PROJECTS"))
    assert loop.endswith('; done; if [ "$MAESTRO_RETRY" != "true" ]; then exit $FAIL; fi')
    retry_line = lines[lines.index(loop) + 1]
    assert retry_line.startswith('if [ "$MAESTRO_RETRY" = "true" ]; then ')
    assert retry_line.endswith("; fi")
    # Off the nightly the retry line is a no-op (the emulator action runs each line in sh -c).
    proc = subprocess.run(
        ["sh", "-c", retry_line],
        env={"MAESTRO_RETRY": "false", "PATH": "/usr/bin:/bin"},
        capture_output=True,
        text=True,
        check=False,
    )
    assert (proc.returncode, proc.stdout) == (0, "")


def ios_retry_tail():
    data = yaml.safe_load((WORKFLOWS / "mobile-smoke-ios.yml").read_text())
    step = next(
        s
        for s in data["jobs"]["maestro-ios"]["steps"]
        if s.get("name") == "Run Maestro flows on iOS Simulator"
    )
    run = step["run"]
    marker = 'if [ "$MAESTRO_RETRY" != "true" ]; then exit $FAIL; fi'
    assert run.count(marker) == 1
    return run[run.index(marker) :]


@pytest.mark.parametrize("fail", ["0", "1"])
def test_ios_off_nightly_exits_with_the_loop_result(fail, tmp_path):
    proc = subprocess.run(
        ["bash", "-e", "-c", f"FAIL={fail}\n{ios_retry_tail()}"],
        env={"MAESTRO_RETRY": "false", "PATH": "/usr/bin:/bin"},
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == int(fail)
    assert proc.stdout == ""


def test_android_job_timeout_is_60_off_the_nightly():
    data = yaml.safe_load((WORKFLOWS / "mobile-smoke-android.yml").read_text())
    job = data["jobs"]["maestro-android"]
    assert job["timeout-minutes"] == "${{ inputs.nightly && 90 || 60 }}"
    # No step-level limit that would cut the nightly retry short.
    assert all("timeout-minutes" not in s for s in job["steps"])


def summary_of(ws, monkeypatch, projects):
    summary, output = ws / "summary.md", ws / "output"
    for f in (summary, output):
        f.write_text("")
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    summarize.main("Android", "full suite", projects)
    return summary.read_text(), output.read_text()


EXIT_NOTE = "_(maestro exited non-zero, but no case in the report failed)_"


def test_summary_nonzero_exit_all_pass_report_and_failed_retry_is_a_fail(ws, monkeypatch):
    junit(ws / "maestro-results/home/report.xml", [("smoke", False), ("nav", False)])
    (ws / "maestro-results/home/maestro-failed").write_text("")
    junit(ws / "maestro-retry/home/__all__.xml", [("smoke", False), ("nav", True)])
    text, output = summary_of(ws, monkeypatch, ["home"])
    assert f"| `home` | ❌ FAIL {EXIT_NOTE} |" in text
    assert "| `home/smoke` | ✅ PASS |" in text  # the first round's own rows stay
    assert output == "passed_on_retry=0\n"
    assert retry.remaining_failures(["home"]) == ["home"]  # agrees with the verdict


def test_summary_nonzero_exit_all_pass_report_and_passing_retry(ws, monkeypatch):
    junit(ws / "maestro-results/home/report.xml", [("smoke", False), ("nav", False)])
    (ws / "maestro-results/home/maestro-failed").write_text("")
    junit(ws / "maestro-retry/home/__all__.xml", [("smoke", False), ("nav", False)])
    text, output = summary_of(ws, monkeypatch, ["home"])
    assert f"| `home` | 🔁 PASS on retry {EXIT_NOTE} |" in text
    assert "**Passed on retry:** 1 flow(s)" in text
    assert output == "passed_on_retry=1\n"
    assert retry.remaining_failures(["home"]) == []


def test_summary_nonzero_exit_off_the_nightly_is_not_green(ws):
    junit(ws / "maestro-results/home/report.xml", [("smoke", False)])
    (ws / "maestro-results/home/maestro-failed").write_text("")
    assert summarize.build_rows(["home"]) == [
        "| `home/smoke` | ✅ PASS |\n",
        f"| `home` | ❌ FAIL {EXIT_NOTE} |\n",
    ]


@pytest.mark.parametrize("retry_passes", [False, True])
def test_summary_zero_case_report(ws, monkeypatch, retry_passes):
    junit(ws / "maestro-results/home/report.xml", [], suite_failures=0)
    if retry_passes:
        junit(ws / "maestro-retry/home/__all__.xml", [("smoke", False), ("nav", False)])
    text, output = summary_of(ws, monkeypatch, ["home"])
    status = "🔁 PASS on retry" if retry_passes else "❌ FAIL"
    assert f"| `home` | {status} _(no test case in the report)_ |" in text
    assert "| `home` | ✅ PASS |" not in text
    assert output == f"passed_on_retry={int(retry_passes)}\n"
    assert (retry.remaining_failures(["home"]) == []) is retry_passes


def test_summary_suite_level_failure_row_is_unchanged(ws):
    junit(ws / "maestro-results/home/report.xml", [], suite_failures=1)
    assert summarize.build_rows(["home"]) == ["| `home` | ❌ FAIL |\n"]

"""Structure checks for .github/workflows/nightly.yml and what it calls (#4054).

Parses the workflow files (no Actions run): the pinned SHA, the gate wiring, the tag-on-green
condition, the summary's needs, the called workflows' `nightly` input and concurrency groups,
and the one Playwright full-suite list."""

import json
import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = ROOT / ".github" / "workflows"
NIGHTLY = yaml.safe_load((WORKFLOWS / "nightly.yml").read_text())
JOBS = NIGHTLY["jobs"]
BOOKKEEPING = {"gate", "tag-last-green", "summary"}
HEAVY = sorted(set(JOBS) - BOOKKEEPING)
CALLED_LOCAL = {
    "mobile-smoke-android.yml",
    "mobile-smoke-ios.yml",
    "cascade-sim-gate.yml",
    "hearts-sim-gate.yml",
    "yacht-sim-gate.yml",
    "perf.yml",
}


def load(name):
    return yaml.safe_load((WORKFLOWS / name).read_text())


def required_contexts():
    rules = json.loads((ROOT / ".github/rulesets/protect-main-dev.json").read_text())["rules"]
    rule = next(r for r in rules if r["type"] == "required_status_checks")
    return [c["context"] for c in rule["parameters"]["required_status_checks"]]


def test_trigger_concurrency_and_permissions():
    on = NIGHTLY[True]
    assert on["workflow_dispatch"]["inputs"]["force"]["default"] is False
    assert "schedule" not in on  # story 3 of #4053 adds it
    assert NIGHTLY["concurrency"] == {"group": "nightly-dev", "cancel-in-progress": False}
    assert NIGHTLY["permissions"] == {"contents": "read"}
    writers = [j for j, job in JOBS.items() if "write" in (job.get("permissions") or {}).values()]
    # Maestro's callers grant pull-requests: write only because comment-media declares it.
    assert sorted(writers) == ["maestro-android", "maestro-ios", "tag-last-green"]
    assert JOBS["tag-last-green"]["permissions"] == {"contents": "write"}
    for job in ("maestro-android", "maestro-ios"):
        assert JOBS[job]["permissions"] == {"contents": "read", "pull-requests": "write"}


def test_expected_heavy_jobs():
    assert (
        sorted(
            [
                "playwright-full",
                "maestro-android",
                "maestro-ios",
                "cascade-sim",
                "hearts-sim",
                "yacht-sim",
                "ios-build",
                "android-build",
                "android-release-smoke-forced",
                "perf",
            ]
        )
        == HEAVY
    )


@pytest.mark.parametrize("job", HEAVY)
def test_heavy_jobs_need_the_gate(job):
    assert JOBS[job]["needs"] == "gate"
    assert JOBS[job]["if"] == "needs.gate.outputs.run == 'true'"


def test_every_checkout_pins_the_run_sha():
    text = (WORKFLOWS / "nightly.yml").read_text()
    assert not re.search(r"^\s*ref: dev\b", text, flags=re.MULTILINE)
    for job_id, job in JOBS.items():
        for step in job.get("steps", []):
            if str(step.get("uses", "")).startswith("actions/checkout"):
                assert step["with"]["ref"] == "${{ github.sha }}", job_id


def test_local_reusables_get_nightly_true():
    for job_id, job in JOBS.items():
        uses = job.get("uses", "")
        if uses.startswith("./.github/workflows/"):
            assert Path(uses).name in CALLED_LOCAL, job_id
            assert job["with"]["nightly"] is True, job_id
    called = {Path(j["uses"]).name for j in JOBS.values() if j.get("uses", "").startswith("./")}
    assert called == CALLED_LOCAL


def test_local_reusables_get_no_secrets():
    """Security review (#4064): none of the local workflows reads a secret, so the nightly
    passes them none. A callee that starts needing one gets it by name, not `inherit`."""
    for job_id, job in JOBS.items():
        if job.get("uses", "").startswith("./"):
            assert "secrets" not in job, job_id
    for name in CALLED_LOCAL:
        assert "secrets." not in (WORKFLOWS / name).read_text(), name


@pytest.mark.parametrize("job", ["ios-build", "android-build"])
def test_org_build_checks_match_ci(job):
    ci = load("ci.yml")["jobs"][f"{job}-check"]
    assert JOBS[job]["uses"] == ci["uses"]
    assert JOBS[job]["with"] == ci["with"]
    assert JOBS[job]["secrets"] == "inherit"


def test_tag_moves_only_when_every_heavy_job_succeeded():
    tag = JOBS["tag-last-green"]
    assert sorted(tag["needs"]) == sorted(["gate", *HEAVY])
    cond = tag["if"]
    for clause in (
        "!cancelled()",
        "needs.gate.outputs.run == 'true'",
        "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
        "!contains(needs.*.result, 'failure')",
        "!contains(needs.*.result, 'cancelled')",
        "!contains(needs.*.result, 'skipped')",
    ):
        assert clause in cond
    run = "\n".join(s.get("run", "") for s in tag["steps"])
    assert 'git tag -f nightly/last-green "$SHA"' in run
    assert "git push -f origin refs/tags/nightly/last-green" in run


def test_summary_always_runs_after_everything():
    summary = JOBS["summary"]
    assert summary["if"] == "always()"
    assert sorted(summary["needs"]) == sorted(set(JOBS) - {"summary"})
    assert summary["permissions"] == {"contents": "read", "actions": "read"}
    run = "\n".join(s.get("run", "") for s in summary["steps"])
    assert "tools/nightly/report.py" in run


def test_gate_runs_the_script():
    run = "\n".join(s.get("run", "") for s in JOBS["gate"]["steps"])
    assert "tools/nightly/gate.py" in run
    assert "git/ref/tags/nightly/last-green" in run
    assert set(JOBS["gate"]["outputs"]) == {"run", "reason", "last_green"}


def test_no_nightly_job_reuses_a_required_check_name():
    leads = {c.split(" / ", 1)[0] for c in required_contexts()}
    for job_id, job in JOBS.items():
        assert job_id not in leads, job_id
        assert job.get("name") not in leads, job_id


def test_artifacts_from_nightly_jobs_keep_7_days():
    for job in JOBS.values():
        for step in job.get("steps", []):
            if str(step.get("uses", "")).startswith("actions/upload-artifact"):
                assert step["with"]["retention-days"] == 7


@pytest.mark.parametrize("name", sorted(CALLED_LOCAL))
def test_called_workflow_has_nightly_input_and_keeps_other_triggers(name):
    data = load(name)
    on = data[True]
    nightly = on["workflow_call"]["inputs"]["nightly"]
    assert nightly == {
        "description": nightly["description"],
        "type": "boolean",
        "required": False,
        "default": False,
    }
    assert "workflow_dispatch" in on and "schedule" in on


@pytest.mark.parametrize("name", sorted(CALLED_LOCAL - {"perf.yml"}))
def test_called_workflow_concurrency_is_separate_for_the_nightly(name):
    group = load(name)["concurrency"]["group"]
    prefix = "${{ inputs.nightly && format('nightly-{0}-', github.run_id) || '' }}"
    assert group.startswith(prefix), group


def test_perf_has_no_concurrency_group():
    assert "concurrency" not in load("perf.yml")


@pytest.mark.parametrize("name", sorted(CALLED_LOCAL))
def test_called_workflow_artifacts_are_7_days_for_the_nightly(name):
    text = (WORKFLOWS / name).read_text()
    for line in re.findall(r"(?:retention-days|artifact-retention-days): .*", text):
        value = line.split(":", 1)[1].split("#", 1)[0].strip()
        # Maestro's results artifact is already 7 days for every run.
        assert value == "7" or value.startswith("${{ inputs.nightly && 7 ||"), (name, line)


def test_playwright_full_suite_list_matches_the_config():
    listed = (ROOT / "e2e/full-suite-projects.txt").read_text()
    projects = " ".join(ln for ln in listed.splitlines() if not ln.startswith("#")).split()
    config = (ROOT / "e2e/playwright.config.ts").read_text()
    names = re.findall(r'^\s+name: "([^"]+)",$', config, flags=re.MULTILINE)
    assert names, "no project names found in playwright.config.ts"
    assert sorted(projects) == sorted(names)
    assert len(projects) == len(set(projects))


def test_ci_and_nightly_read_the_same_full_suite_list():
    scope = next(
        s for s in load("ci.yml")["jobs"]["detect-e2e-scope"]["steps"] if s.get("id") == "scope"
    )
    assert "e2e/full-suite-projects.txt" in scope["run"]
    run = "\n".join(s.get("run", "") for s in JOBS["playwright-full"]["steps"])
    assert "full-suite-projects.txt" in run


def test_android_release_smoke_keeps_its_ci_job_and_shares_the_action():
    job = load("ci.yml")["jobs"]["android-release-smoke"]
    assert "name" not in job  # the required context is the job id
    assert job["if"] == "github.event_name == 'pull_request'"
    assert job["needs"] == ["test-python", "test-frontend"]
    assert job["timeout-minutes"] == 30
    action_steps = [
        s for s in job["steps"] if s.get("uses") == "./.github/actions/android-release-smoke"
    ]
    assert len(action_steps) == 1
    assert action_steps[0]["if"] == "steps.changes.outputs.should_run == 'true'"
    forced = JOBS["android-release-smoke-forced"]["steps"]
    action = [s for s in forced if s.get("uses") == "./.github/actions/android-release-smoke"]
    assert len(action) == 1 and "if" not in action[0]


def test_composite_action_sets_working_directory_on_every_run_step():
    action = yaml.safe_load((ROOT / ".github/actions/android-release-smoke/action.yml").read_text())
    assert action["runs"]["using"] == "composite"
    for step in action["runs"]["steps"]:
        if "run" in step:
            assert step["shell"] == "bash"
            assert step["working-directory"] == "frontend"

"""Static regression guards for CI configuration (#2084).

Does NOT require DATABASE_URL — parses config files directly.

Tests:
  test_gradle_jvmargs_xmx_present — -Xmx is explicitly set in gradle.properties
  test_gradle_jvmargs_max_metaspace_sufficient — MaxMetaspaceSize >= 1024m
  test_android_release_smoke_has_timeout — timeout-minutes present on the job
  test_android_release_smoke_timeout_is_reasonable — timeout-minutes <= 30
"""

from __future__ import annotations

import pathlib
import re

import yaml

REPO_ROOT = pathlib.Path(__file__).parent.parent.parent
GRADLE_PROPS = REPO_ROOT / "frontend" / "android" / "gradle.properties"
CI_YML = REPO_ROOT / ".github" / "workflows" / "ci.yml"


def _gradle_jvmargs() -> str:
    text = GRADLE_PROPS.read_text(encoding="utf-8")
    m = re.search(r"^org\.gradle\.jvmargs\s*=\s*(.+)$", text, re.MULTILINE)
    assert m, "org.gradle.jvmargs not found in gradle.properties"
    return m.group(1)


def _metaspace_mb(jvmargs: str) -> int:
    m = re.search(r"-XX:MaxMetaspaceSize=(\d+)([mg]?)", jvmargs, re.IGNORECASE)
    assert m, f"-XX:MaxMetaspaceSize not found in jvmargs: {jvmargs!r}"
    value, unit = int(m.group(1)), m.group(2).lower()
    if unit == "g":
        return value * 1024
    if unit == "m":
        return value
    raise ValueError(f"Unexpected unit {unit!r} in jvmargs: {jvmargs!r}")


def _ci_job(name: str) -> dict:
    data = yaml.safe_load(CI_YML.read_text(encoding="utf-8"))
    jobs = data.get("jobs", {})
    assert name in jobs, f"Job {name!r} not found in ci.yml"
    return jobs[name]


def test_gradle_jvmargs_xmx_present():
    args = _gradle_jvmargs()
    assert "-Xmx" in args, f"-Xmx not set in org.gradle.jvmargs: {args!r}"


def test_gradle_jvmargs_max_metaspace_sufficient():
    mb = _metaspace_mb(_gradle_jvmargs())
    assert mb >= 1024, f"MaxMetaspaceSize is {mb}m — must be >= 1024m to avoid R8 OOM"


def test_android_release_smoke_has_timeout():
    job = _ci_job("android-release-smoke")
    assert "timeout-minutes" in job, (
        "android-release-smoke has no timeout-minutes; "
        "an R8 OOM will zombie the runner for 6 hours"
    )


def test_android_release_smoke_timeout_is_reasonable():
    job = _ci_job("android-release-smoke")
    timeout = job.get("timeout-minutes", 0)
    assert timeout <= 30, (
        f"android-release-smoke timeout-minutes={timeout} is too long; "
        "a single-ABI assembleRelease should finish in < 20 min"
    )


SECURITY_YML = REPO_ROOT / ".github" / "workflows" / "security.yml"
TRIVYIGNORE = REPO_ROOT / ".trivyignore"


def _security_workflow() -> dict:
    data = yaml.safe_load(SECURITY_YML.read_text(encoding="utf-8"))
    # PyYAML parses the bare key `on` as boolean True.
    data["on"] = data.pop(True, data.get("on"))
    return data


def _trivy_step() -> dict:
    wf = _security_workflow()
    for job in wf["jobs"].values():
        for step in job["steps"]:
            if str(step.get("uses", "")).startswith("aquasecurity/trivy-action@"):
                return step
    raise AssertionError("No trivy-action step in security.yml")


def test_security_workflow_triggers():
    on = _security_workflow()["on"]
    assert on["schedule"], "security.yml must run on a weekly schedule"
    assert "workflow_dispatch" in on
    pr = on["pull_request"]
    assert set(pr["branches"]) == {"main", "dev"}
    assert "frontend/package-lock.json" in pr["paths"]
    assert "backend/requirements*.txt" in pr["paths"]


def test_security_workflow_permissions_read_only():
    wf = _security_workflow()
    assert wf["permissions"] == {"contents": "read"}


def test_security_workflow_trivy_fails_on_high_or_critical():
    with_ = _trivy_step()["with"]
    assert with_["scan-type"] == "fs"
    assert str(with_["exit-code"]) == "1"
    assert set(with_["severity"].split(",")) == {"CRITICAL", "HIGH"}
    assert with_["trivyignores"] == ".trivyignore"
    assert with_["ignore-unfixed"] is True


def test_security_workflow_scans_every_backend_requirements_file():
    # Trivy's pip analyzer only matches "requirements.txt" by default.
    pattern = _trivy_step()["env"]["TRIVY_FILE_PATTERNS"]
    analyzer, regex = pattern.split(":", 1)
    assert analyzer == "pip"
    for req in sorted((REPO_ROOT / "backend").glob("requirements*.txt")):
        if req.name != "requirements.txt":
            assert re.search(regex, req.name), f"{req.name} not covered by {pattern!r}"


def test_security_workflow_skips_drafts():
    wf = _security_workflow()
    job = next(iter(wf["jobs"].values()))
    assert "pull_request.draft" in job["if"]
    assert "converted_to_draft" in wf["on"]["pull_request"]["types"]


def test_security_workflow_covers_all_node_manifests():
    paths = _security_workflow()["on"]["pull_request"]["paths"]
    for p in ("e2e/package.json", "e2e/package-lock.json", "frontend/package.json"):
        assert p in paths


# trivy-action release outside GHSA-69fq-xp46-6x23's affected range (v0.36.0).
APPROVED_TRIVY_ACTION_SHA = "ed142fd0673e97e23eac54620cfb913e5ce36c25"


def test_security_workflow_trivy_action_is_pinned_to_approved_sha():
    step = _trivy_step()
    uses = str(step["uses"])
    assert uses == f"aquasecurity/trivy-action@{APPROVED_TRIVY_ACTION_SHA}"
    assert re.fullmatch(r"v\d+\.\d+\.\d+", str(step["with"]["version"])), "pin the Trivy binary"


def test_security_workflow_checkout_is_pinned_without_credentials():
    wf = _security_workflow()
    for job in wf["jobs"].values():
        for step in job["steps"]:
            if str(step.get("uses", "")).startswith("actions/checkout@"):
                assert re.search(r"@[0-9a-f]{40}$", step["uses"])
                assert step["with"]["persist-credentials"] is False


def test_trivyignore_entries_have_reason_tracking_link_and_expiry():
    lines = [ln.strip() for ln in TRIVYIGNORE.read_text(encoding="utf-8").splitlines()]
    entries = [i for i, ln in enumerate(lines) if ln and not ln.startswith("#")]
    assert entries
    for i in entries:
        block = []
        j = i - 1
        while j >= 0 and lines[j].startswith("#"):
            block.append(lines[j])
            j -= 1
        text = "\n".join(block)
        assert "Tracking:" in text and "http" in text, f"{lines[i]} lacks a tracking link"
        assert len(block) >= 2, f"{lines[i]} lacks a reason"
        id_, *fields = lines[i].split()
        if id_.startswith("GHSA-"):
            assert "no CVE" in text, f"{id_}: GHSA ids need a comment saying no CVE exists"
        else:
            assert id_.startswith("CVE-"), f"{id_}: use the CVE id Trivy reports"
        assert any(re.fullmatch(r"exp:\d{4}-\d{2}-\d{2}", f) for f in fields), f"{id_} lacks exp:"


def test_test_postgres_runs_migration_round_trip():
    """#3446: Postgres CI runs upgrade, check, downgrade -1, upgrade, in that order."""
    runs = [s["run"] for s in _ci_job("test-postgres")["steps"] if "run" in s]
    step_cmds = [
        [ln.strip() for ln in run.splitlines() if ln.strip().startswith("alembic ")] for run in runs
    ]
    assert [
        "alembic upgrade head",
        "alembic check",
        "alembic downgrade -1",
        "alembic upgrade head",
    ] in step_cmds


def test_test_postgres_migration_round_trip_is_advisory_and_isolated():
    job = _ci_job("test-postgres")
    assert job.get("continue-on-error") is True
    step = next(s for s in job["steps"] if "alembic downgrade -1" in s.get("run", ""))
    assert step["env"]["DATABASE_URL"].endswith("/bcarcade_migrations")

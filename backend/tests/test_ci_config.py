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


def test_security_marker_runs_as_its_own_ci_job():
    """`pytest -m security` is a named CI job (#3445); exit code 5 on zero tests fails it."""
    job = _ci_job("test-python-security")
    steps = job.get("steps", [])
    assert any(
        "-m security" in str(s.get("run", "")) for s in steps
    ), "test-python-security does not run `pytest -m security`"
    assert job.get("permissions") == {"contents": "read"}
    assert "continue-on-error" not in job, "the security group must not be advisory"


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

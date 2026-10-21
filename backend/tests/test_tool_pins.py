"""Lint tool versions in CI match the local dev pins (#3456).

Dependabot bumps `backend/requirements-dev.txt` but not the `ruff-version` inputs in
`.github/workflows/ci.yml`; this fails the bump PR until both move together.
"""

from __future__ import annotations

import pathlib
import re

import yaml

REPO_ROOT = pathlib.Path(__file__).parent.parent.parent
CI_YML = REPO_ROOT / ".github" / "workflows" / "ci.yml"
DEV_REQS = REPO_ROOT / "backend" / "requirements-dev.txt"


def _dev_pin(package: str) -> str:
    for line in DEV_REQS.read_text(encoding="utf-8").splitlines():
        m = re.match(rf"^{package}==(\S+)", line.strip())
        if m:
            return m.group(1)
    raise AssertionError(f"{package} is not pinned in requirements-dev.txt")


def test_ci_ruff_versions_match_requirements_dev():
    jobs = yaml.safe_load(CI_YML.read_text(encoding="utf-8"))["jobs"]
    pinned = {
        name: str(job["with"]["ruff-version"])
        for name, job in jobs.items()
        if "ruff-version" in (job.get("with") or {})
    }
    assert set(pinned) >= {"lint-python", "lint-python-tools"}
    assert set(pinned.values()) == {_dev_pin("ruff")}, pinned

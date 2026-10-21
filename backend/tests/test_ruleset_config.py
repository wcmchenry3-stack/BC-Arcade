"""Guards for the repository ruleset file (#3447).

Does NOT require DATABASE_URL: parses config files directly.

Every required status check in .github/rulesets/protect-main-dev.json must map
to a job in .github/workflows/ that exists on every PR into main and dev.
"""

from __future__ import annotations

import json
import pathlib

import pytest
import yaml

REPO_ROOT = pathlib.Path(__file__).parent.parent.parent
RULESET = REPO_ROOT / ".github" / "rulesets" / "protect-main-dev.json"
CODEOWNERS = REPO_ROOT / ".github" / "CODEOWNERS"
WORKFLOWS = REPO_ROOT / ".github" / "workflows"
SEP = " / "


def _ruleset() -> dict:
    return json.loads(RULESET.read_text(encoding="utf-8"))


def _required_contexts() -> list[str]:
    for rule in _ruleset()["rules"]:
        if rule["type"] == "required_status_checks":
            return [c["context"] for c in rule["parameters"]["required_status_checks"]]
    raise AssertionError("ruleset has no required_status_checks rule")


def _pr_jobs() -> dict[str, tuple[str, str, dict]]:
    """Map job id and job name -> (workflow file, job id, job dict).

    Only workflows that run on every PR into main and dev (no path filter).
    """
    found: dict[str, tuple[str, str, dict]] = {}
    for path in sorted(WORKFLOWS.glob("*.yml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        on = data.get(True, data.get("on")) or {}
        if not isinstance(on, dict) or "pull_request" not in on:
            continue
        pr = on["pull_request"] or {}
        if "paths" in pr or "paths-ignore" in pr:
            continue
        branches = pr.get("branches")
        if branches is not None and not {"main", "dev"} <= set(branches):
            continue
        for job_id, job in data["jobs"].items():
            entry = (path.name, job_id, job)
            found.setdefault(job_id, entry)
            if isinstance(job.get("name"), str):
                found.setdefault(job["name"], entry)
    return found


def test_ruleset_is_valid_and_targets_main_and_dev():
    rs = _ruleset()
    assert rs["target"] == "branch"
    assert rs["enforcement"] == "active"
    assert rs["conditions"]["ref_name"]["include"] == ["refs/heads/main", "refs/heads/dev"]
    types = {r["type"] for r in rs["rules"]}
    assert {"deletion", "non_fast_forward", "pull_request", "required_status_checks"} <= types


def test_required_contexts_are_unique_and_nonempty():
    contexts = _required_contexts()
    assert contexts
    assert len(contexts) == len(set(contexts))


@pytest.mark.parametrize("context", _required_contexts())
def test_required_check_maps_to_always_on_pr_job(context: str):
    jobs = _pr_jobs()
    lead = context.split(SEP, 1)[0]
    assert lead in jobs, (
        f"{context!r}: no job id or name {lead!r} in a PR workflow without a path filter "
        "under .github/workflows/"
    )
    _, job_id, job = jobs[lead]
    assert job.get("continue-on-error") is not True, f"{context!r} is continue-on-error"
    if SEP in context:
        assert (
            "uses" in job
        ), f"{context!r} has an inner job name but {job_id!r} is not a reusable-workflow call"


def test_codeowners_has_default_owner():
    lines = [
        ln.split()
        for ln in CODEOWNERS.read_text(encoding="utf-8").splitlines()
        if ln.strip() and not ln.lstrip().startswith("#")
    ]
    assert any(parts[0] == "*" and len(parts) >= 2 for parts in lines)
    assert all(owner.startswith("@") for parts in lines for owner in parts[1:])

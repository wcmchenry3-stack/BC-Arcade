"""Guards for the production deploy path (#505).

`deploy.yml` failed on every push for months — GitHub reported "workflow file
issue" and, because a push-event run is not a required check, nobody noticed
until the prod deploy was next in line. These tests pin the properties that
broke it so they cannot regress silently.
"""

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
WORKFLOWS = REPO_ROOT / ".github" / "workflows"


def _load(path: Path) -> dict:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    # PyYAML reads the bare key `on:` as boolean True.
    if True in data:
        data["on"] = data.pop(True)
    return data


def test_deploy_workflow_calls_ci_in_this_repo() -> None:
    """The CI job must call this repo's ci.yml, not a stale repo-name reference
    (it pointed at the pre-rename `gaming_app`)."""
    deploy = _load(WORKFLOWS / "deploy.yml")
    ref = deploy["jobs"]["ci"]["uses"]
    assert ref.startswith("./.github/workflows/"), ref

    target = REPO_ROOT / ref.removeprefix("./")
    assert target.is_file(), f"{ref} does not exist"
    assert "workflow_call" in _load(target)["on"], f"{ref} is not callable (no workflow_call)"


def test_deploy_workflow_grants_the_ci_call_what_ci_needs() -> None:
    """A called workflow cannot exceed its caller's permissions, and the repo
    default token is read-only — a job in ci.yml that asks for more makes the
    whole call invalid unless the caller grants it."""
    deploy = _load(WORKFLOWS / "deploy.yml")
    granted = deploy["jobs"]["ci"].get("permissions", {})
    ci = _load(WORKFLOWS / "ci.yml")

    wanted: dict[str, str] = {}
    for job in ci["jobs"].values():
        if isinstance(job.get("permissions"), dict):
            wanted.update(job["permissions"])

    rank = {"none": 0, "read": 1, "write": 2}
    short = {
        scope: level
        for scope, level in wanted.items()
        if rank[granted.get(scope, "none")] < rank[level]
    }
    assert short == {}, f"ci.yml jobs need permissions deploy.yml's ci job does not grant: {short}"


def test_deploy_workflow_never_reads_secrets_in_a_call_input() -> None:
    """`secrets` is not an available context in a reusable-workflow call's
    `with:`; referencing it there invalidates the whole file."""
    deploy = _load(WORKFLOWS / "deploy.yml")
    offenders = [
        f"{name}.with.{key}"
        for name, job in deploy["jobs"].items()
        for key, value in (job.get("with") or {}).items()
        if "secrets." in str(value)
    ]
    assert offenders == [], offenders


def test_prod_services_deploy_only_through_the_ci_gated_workflow() -> None:
    """Render's own autoDeploy would ship every push to main before CI finishes
    and skip the post-deploy ZAP scan; deploy.yml is the only deploy path."""
    config = yaml.safe_load((REPO_ROOT / "render.yaml").read_text(encoding="utf-8"))
    prod = [s for s in config["services"] if s.get("branch") == "main"]
    assert prod, "no prod (branch: main) services found in render.yaml"
    assert [s["name"] for s in prod if s.get("autoDeploy") is not False] == []

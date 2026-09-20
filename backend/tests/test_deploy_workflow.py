"""Guards for the production deploy path (#505).

`deploy.yml` failed on every push for months — GitHub reported "workflow file
issue" and, because a push-event run is not a required check, nobody noticed
until the prod deploy was next in line. These tests pin the properties that
broke it so they cannot regress silently.
"""

import re
from collections.abc import Iterable
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
WORKFLOWS = REPO_ROOT / ".github" / "workflows"

_RANK = {"none": 0, "read": 1, "write": 2}


def _load(path: Path) -> dict:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    # PyYAML reads the bare key `on:` as boolean True.
    if True in data:
        data["on"] = data.pop(True)
    return data


def _levels(perms: object) -> dict[str, str]:
    """Normalise a `permissions:` value to {scope: level}. `read-all` /
    `write-all` become the wildcard scope "*"."""
    if perms is None:
        return {}
    if isinstance(perms, str):
        return {"*": {"read-all": "read", "write-all": "write"}[perms]}
    return dict(perms)  # type: ignore[call-overload]


def _strongest(blocks: Iterable[object]) -> dict[str, str]:
    """Merge permission blocks keeping, per scope, the strongest level requested."""
    merged: dict[str, str] = {}
    for block in blocks:
        for scope, level in _levels(block).items():
            if _RANK[level] > _RANK[merged.get(scope, "none")]:
                merged[scope] = level
    return merged


def _shortfall(wanted: dict[str, str], granted: dict[str, str]) -> dict[str, str]:
    """Scopes in `wanted` that `granted` does not cover (a granted "*" covers any)."""
    blanket = _RANK[granted.get("*", "none")]
    return {
        scope: level
        for scope, level in wanted.items()
        if max(_RANK[granted.get(scope, "none")], blanket) < _RANK[level]
    }


def _reads_secrets(value: object) -> bool:
    """True if a `${{ … }}` expression in `value` references the secrets context —
    dot or bracket form, alone or inside a function call."""
    expressions = re.findall(r"\$\{\{(.*?)\}\}", str(value), flags=re.DOTALL)
    return any(re.search(r"\bsecrets\b", expression) for expression in expressions)


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
    granted = _levels(deploy["jobs"]["ci"].get("permissions"))
    ci = _load(WORKFLOWS / "ci.yml")

    wanted = _strongest(
        [ci.get("permissions"), *(job.get("permissions") for job in ci["jobs"].values())]
    )
    short = _shortfall(wanted, granted)
    assert short == {}, f"ci.yml jobs need permissions deploy.yml's ci job does not grant: {short}"


def test_permission_helpers_keep_the_strongest_request() -> None:
    """The first version overwrote per scope, so a later job asking for `read`
    masked an earlier one asking for `write` — and the test passed while the real
    call was rejected."""
    wanted = _strongest([{"pull-requests": "write"}, {"pull-requests": "read"}, "read-all", None])
    assert wanted == {"pull-requests": "write", "*": "read"}

    assert _shortfall(wanted, {"pull-requests": "read"}) == wanted
    assert _shortfall(wanted, {"pull-requests": "write", "*": "read"}) == {}
    assert _shortfall({"contents": "read", "issues": "write"}, {"*": "write"}) == {}
    assert _shortfall({"issues": "write"}, {"*": "read", "issues": "read"}) == {"issues": "write"}


def test_deploy_workflow_never_reads_secrets_in_a_call_input() -> None:
    """`secrets` is not an available context in a reusable-workflow call's
    `with:`; referencing it there invalidates the whole file."""
    deploy = _load(WORKFLOWS / "deploy.yml")
    offenders = [
        f"{name}.with.{key}"
        for name, job in deploy["jobs"].items()
        for key, value in (job.get("with") or {}).items()
        if _reads_secrets(value)
    ]
    assert offenders == [], offenders


def test_secrets_detector_catches_every_expression_form() -> None:
    assert _reads_secrets("${{ secrets.RENDER_PROD_API_SERVICE_ID }}")
    assert _reads_secrets("${{ secrets['RENDER_PROD_API_SERVICE_ID'] }}")
    assert _reads_secrets("${{ format('{0}', secrets.X) }}")
    assert not _reads_secrets("${{ vars.RENDER_PROD_API_SERVICE_ID }}")
    assert not _reads_secrets("bc-arcade-api")


def test_prod_deploys_are_serialised() -> None:
    """Two overlapping runs must not deploy at once. The shared deploy workflow
    tells Render to deploy `main`'s *current* HEAD, so the older run would ship
    the newer commit before that commit's own CI finished; with a queue the
    newer run waits behind it. In-flight runs are never cancelled — that could
    kill a deploy half-way."""
    concurrency = _load(WORKFLOWS / "deploy.yml").get("concurrency")
    assert concurrency, "deploy.yml needs a workflow-level concurrency group"
    assert concurrency["cancel-in-progress"] is False


def test_an_unset_deploy_target_is_flagged_not_silent() -> None:
    """A deploy job is skipped while its service-ID variable is unset (so
    promoting before the prod services exist is not a red run). With autoDeploy
    off, a mistyped or blank variable would then mean a green run and no deploy —
    so a preflight job must raise a warning annotation for every guarded variable."""
    deploy = _load(WORKFLOWS / "deploy.yml")
    guarded = {
        name
        for job in deploy["jobs"].values()
        if "called-deploy-render" in job.get("uses", "")
        for name in re.findall(r"vars\.(\w+)", str(job.get("if", "")))
    }
    assert guarded, "no deploy job is guarded by a repository variable"

    preflight = str(deploy["jobs"]["preflight"])
    assert "::warning" in preflight
    missing = sorted(name for name in guarded if name not in preflight)
    assert missing == [], f"guarded variables the preflight does not check: {missing}"


def test_prod_services_deploy_only_through_the_ci_gated_workflow() -> None:
    """Render's own autoDeploy would ship every push to main before CI finishes
    and skip the post-deploy ZAP scan; deploy.yml is the only deploy path."""
    config = yaml.safe_load((REPO_ROOT / "render.yaml").read_text(encoding="utf-8"))
    prod = [s for s in config["services"] if s.get("branch") == "main"]
    assert prod, "no prod (branch: main) services found in render.yaml"
    assert [s["name"] for s in prod if s.get("autoDeploy") is not False] == []

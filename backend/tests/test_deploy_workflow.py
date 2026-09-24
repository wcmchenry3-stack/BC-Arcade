"""Guards for the production deploy path (#505).

Prod is deployed by Render's own auto-deploy of `main`, gated on the commit's CI
checks; `post-deploy-scan.yml` then ZAP-scans each prod service once Render
reports the commit live. The earlier `deploy.yml` failed silently twice — first
as an invalid file, then by skipping every deploy job because its service IDs
were read from the wrong context — and a push-event run is not a required check,
so nobody noticed. These tests pin the properties that keep the scan honest.
"""

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
WORKFLOWS = REPO_ROOT / ".github" / "workflows"
SCAN = WORKFLOWS / "post-deploy-scan.yml"


def _load(path: Path) -> dict:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    # PyYAML reads the bare key `on:` as boolean True.
    if True in data:
        data["on"] = data.pop(True)
    return data


def _prod_services() -> list[dict]:
    config = yaml.safe_load((REPO_ROOT / "render.yaml").read_text(encoding="utf-8"))
    prod = [s for s in config["services"] if s.get("branch") == "main"]
    assert prod, "no prod (branch: main) services found in render.yaml"
    return prod


def test_prod_services_auto_deploy_only_after_ci_passes() -> None:
    """Render's default trigger ships every push to main before CI finishes;
    `checksPass` makes it wait for the commit's checks."""
    wrong = {s["name"]: s.get("autoDeployTrigger") for s in _prod_services()}
    assert {n: t for n, t in wrong.items() if t != "checksPass"} == {}
    assert [s["name"] for s in _prod_services() if s.get("autoDeploy") is False] == []


def test_scan_runs_after_ci_on_main_not_on_push() -> None:
    """A push-triggered job would be one of the checks Render waits for, while
    itself waiting for Render's deploy — a deadlock. `workflow_run` avoids it."""
    on = _load(SCAN)["on"]
    assert "push" not in on
    ci_name = _load(WORKFLOWS / "ci.yml")["name"]
    assert on["workflow_run"]["workflows"] == [ci_name]
    assert on["workflow_run"]["branches"] == ["main"]
    assert on["workflow_run"]["types"] == ["completed"]


def test_scan_waits_for_the_ci_validated_commit() -> None:
    """Scanning before the deploy lands would scan the previous commit."""
    steps = _load(SCAN)["jobs"]["scan"]["steps"]
    wait = next(s for s in steps if s.get("id") == "wait")
    assert wait["env"]["SHA"] == "${{ github.event.workflow_run.head_sha }}"
    zap = next(s for s in steps if "zaproxy/" in s.get("uses", ""))
    assert zap["if"] == "steps.wait.outputs.scan == 'true'"


def test_scan_covers_every_prod_service_by_its_secret() -> None:
    """One matrix entry per prod service in render.yaml, each naming a service-ID
    secret (the owner stored them as secrets; reading `vars` is what skipped
    every deploy on Sep 22)."""
    job = _load(SCAN)["jobs"]["scan"]
    entries = job["strategy"]["matrix"]["include"]
    assert {e["service"] for e in entries} == {s["name"] for s in _prod_services()}
    assert all(e["id_secret"].startswith("RENDER_PROD_") for e in entries)
    assert all(e["url"].startswith("https://") for e in entries)
    wait = next(s for s in job["steps"] if s.get("id") == "wait")
    # Each secret is referenced statically; a dynamic `secrets[...]` index
    # exposes every repo and org secret to the runner.
    for e in entries:
        name = e["id_secret"]
        assert wait["env"][name] == f"${{{{ secrets.{name} }}}}"
    assert wait["env"]["ID_SECRET"] == "${{ matrix.id_secret }}"
    assert 'SERVICE_ID="${!ID_SECRET}"' in wait["run"]
    assert "${{ secrets[" not in SCAN.read_text(encoding="utf-8")
    assert "vars." not in SCAN.read_text(encoding="utf-8")


def test_scan_never_files_public_issues_or_writes() -> None:
    """The ZAP action's default files findings as a GitHub issue, which would
    publish them on this public repo."""
    scan = _load(SCAN)
    assert scan["permissions"] == {"contents": "read"}
    zap = next(s for s in scan["jobs"]["scan"]["steps"] if "zaproxy/" in s.get("uses", ""))
    assert zap["with"]["allow_issue_writing"] is False


def test_no_workflow_deploys_prod_itself() -> None:
    """Render auto-deploy is the one deploy path; a second one would double-deploy."""
    callers = [
        p.name
        for p in WORKFLOWS.glob("*.yml")
        if "called-deploy-render" in p.read_text(encoding="utf-8")
    ]
    assert callers == []


def test_scan_checks_the_headers_the_dashboard_can_drift() -> None:
    """Prod headers are set in the Render dashboard, not from render.yaml; the
    Sep 23 scan found the frontend CSP pasted with its quotes and no HSTS."""
    steps = _load(SCAN)["jobs"]["scan"]["steps"]
    check = next(s for s in steps if s.get("name") == "Check security headers")
    assert check["if"] == "steps.wait.outputs.scan == 'true'"
    assert "strict-transport-security" in check["run"]
    assert "content-security-policy" in check["run"]


def test_every_static_site_sends_hsts() -> None:
    config = yaml.safe_load((REPO_ROOT / "render.yaml").read_text(encoding="utf-8"))
    static = [s for s in config["services"] if s.get("runtime") == "static"]
    assert static
    missing = [
        s["name"]
        for s in static
        if not any(h["name"] == "Strict-Transport-Security" for h in s.get("headers", []))
    ]
    assert missing == []


def test_header_check_targets_a_real_route() -> None:
    """The API has no `/` route; checking `/` there gets a 404 (review of #2521)."""
    entries = _load(SCAN)["jobs"]["scan"]["strategy"]["matrix"]["include"]
    api = next(e for e in entries if e["service"] == "bc-arcade-api")
    assert api["header_path"] == "/health"
    assert all(e["header_path"].startswith("/") for e in entries)


def test_known_red_smoke_legs_do_not_gate_prod_deploys() -> None:
    """Render's "After CI Checks Pass" waits for every check on a `main` commit.
    The Maestro legs have never passed (#2347, #2400), so while they ran on
    push to main no prod deploy could happen (#2522 sat undeployed)."""
    for name in ("mobile-smoke-ios.yml", "mobile-smoke-android.yml"):
        on = _load(WORKFLOWS / name)["on"]
        assert "push" not in on, f"{name} runs on push again - is it green now?"
        assert "workflow_dispatch" in on

"""pytest suite for the Maestro demo-flow wiring (#3801, extends #3705).

Runs the real `scope` step script of .github/workflows/detect-maestro-scope.yml under bash
with mocked env and a temp GITHUB_OUTPUT, and checks that the two smoke workflows offer the
same `flows` options, that every `<game>-demo` option has demo-tagged flows in its directory,
and that no other flow is tagged `demo`."""

import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = ROOT / ".github" / "workflows"
FLOWS = ROOT / "e2e" / "maestro" / "flows"
FULL_SUITE = "blackjack cascade daily-word freecell hearts home mahjong offline"


def load(name):
    return yaml.safe_load((WORKFLOWS / name).read_text())


def dispatch_flows(name):
    # PyYAML reads the bare `on:` key as boolean True.
    return load(name)[True]["workflow_dispatch"]["inputs"]["flows"]


def scope_script():
    steps = load("detect-maestro-scope.yml")["jobs"]["detect"]["steps"]
    return next(s for s in steps if s.get("id") == "scope")["run"]


def run_scope(tmp_path, **env):
    out = tmp_path / "out"
    out.write_text("")
    summary = tmp_path / "summary"
    summary.write_text("")
    base = {
        "EVENT_NAME": "workflow_dispatch",
        "BASE_REF": "",
        "PLATFORM": "android",
        "FLOWS": "",
        "FULL_SUITE": FULL_SUITE,
        "GITHUB_OUTPUT": str(out),
        "GITHUB_STEP_SUMMARY": str(summary),
        "PATH": "/usr/bin:/bin",
    }
    base.update(env)
    proc = subprocess.run(
        ["bash", "-e", "-c", scope_script()],
        env=base,
        capture_output=True,
        text=True,
        check=False,
    )
    pairs = dict(line.split("=", 1) for line in out.read_text().splitlines() if "=" in line)
    return proc.returncode, pairs, proc.stdout + proc.stderr


def header(path):
    return yaml.safe_load(path.read_text().split("\n---\n")[0])


@pytest.mark.parametrize("platform", ["android", "ios"])
@pytest.mark.parametrize(
    "flows,game",
    [("cascade-demo", "cascade"), ("mahjong-demo", "mahjong")],
)
def test_demo_dispatch_runs_only_that_game_with_demo_tag(tmp_path, platform, flows, game):
    code, out, log = run_scope(tmp_path, FLOWS=flows, PLATFORM=platform)
    assert code == 0, log
    assert out["projects"] == game
    assert out["demo"] == "true"
    assert flows in out["label"]


@pytest.mark.parametrize("flows", ["", "full"])
def test_full_and_empty_flows_are_not_demo(tmp_path, flows):
    code, out, log = run_scope(tmp_path, FLOWS=flows)
    assert code == 0, log
    assert out["projects"] == FULL_SUITE
    assert "demo" not in out


def test_unknown_flows_value_is_rejected(tmp_path):
    code, _, log = run_scope(tmp_path, FLOWS="mahjong-demo; echo pwned")
    assert code == 1
    assert "unknown flows" in log


def test_both_workflows_offer_the_same_flows_options():
    android = dispatch_flows("mobile-smoke-android.yml")
    ios = dispatch_flows("mobile-smoke-ios.yml")
    assert android["options"] == ios["options"]
    assert android["options"][0] == "full"
    assert "cascade-demo" in android["options"]
    assert "mahjong-demo" in android["options"]


@pytest.mark.parametrize("name", ["mobile-smoke-android.yml", "mobile-smoke-ios.yml"])
def test_tag_arg_and_media_upload_follow_the_demo_output(name):
    text = (WORKFLOWS / name).read_text()
    assert "needs.detect-maestro-scope.outputs.demo == 'true' && '--include-tags=demo'" in text
    assert "|| '--exclude-tags=demo'" in text
    assert (
        "if-no-files-found: ${{ needs.detect-maestro-scope.outputs.demo == 'true' && 'error'"
        in text
    )


@pytest.mark.parametrize(
    "option",
    [o for o in dispatch_flows("mobile-smoke-android.yml")["options"] if o.endswith("-demo")],
)
def test_each_demo_option_has_demo_tagged_flows(option):
    game = option.removesuffix("-demo")
    flows = sorted((FLOWS / game).glob("demo-*.yaml"))
    assert flows, f"{option} has no {game}/demo-*.yaml"
    for path in flows:
        assert header(path)["tags"] == ["demo"], path


def test_only_demo_files_are_tagged_demo():
    for path in FLOWS.rglob("*.yaml"):
        tags = header(path).get("tags") or []
        assert ("demo" in tags) == path.name.startswith("demo-"), path


def test_mahjong_demo_flows_screenshots_and_no_hint_tap():
    expected = {"demo-open.yaml": "mahjong-demo-open", "demo-zoom.yaml": "mahjong-demo-zoom"}
    for name, shot in expected.items():
        text = (FLOWS / "mahjong" / name).read_text()
        assert f"takeScreenshot: {shot}" in text
        assert "mahjong-hint-button" not in text

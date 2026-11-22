"""Maestro scope on PRs into dev (#4057).

Evaluates the real `.github/paths/game-paths.yml` against a list of changed files (a small
picomatch-style matcher standing in for dorny/paths-filter), feeds the resulting filter
outputs to the real `scope` step of `.github/workflows/detect-maestro-scope.yml`, and checks
which Maestro projects would run."""

import re
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
TABLE = ROOT / ".github" / "paths" / "game-paths.yml"
WORKFLOW = ROOT / ".github" / "workflows" / "detect-maestro-scope.yml"
FLOWS = ROOT / "e2e" / "maestro" / "flows"
FULL_SUITE = "blackjack cascade daily-word freecell hearts home mahjong offline solitaire sort starswarm sudoku twenty48 yacht"
DRAG = "solitaire freecell"
MAESTRO_KEYS = ("maestro_infra", "maestro_drag", "native_ios", "native_android")


def table():
    return yaml.safe_load(TABLE.read_text())


def flatten(patterns):
    for item in patterns:
        if isinstance(item, list):
            yield from flatten(item)
        else:
            yield item


def glob_to_re(pattern):
    out, i = "", 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
        elif pattern.startswith("**", i):
            out += ".*"
            i += 2
        elif pattern[i] == "*":
            out += "[^/]*"
            i += 1
        else:
            out += re.escape(pattern[i])
            i += 1
    return re.compile(out + r"\Z")


def matches(key, files):
    regexes = [glob_to_re(p) for p in flatten(table()[key])]
    return any(r.match(f) for f in files for r in regexes)


def scope_script():
    steps = yaml.safe_load(WORKFLOW.read_text())["jobs"]["detect"]["steps"]
    return next(s for s in steps if s.get("id") == "scope")["run"]


def run_scope(tmp_path, files=(), event="pull_request", base="dev", platform="android"):
    out = tmp_path / "out"
    out.write_text("")
    summary = tmp_path / "summary"
    summary.write_text("")
    env = {
        "EVENT_NAME": event,
        "BASE_REF": base,
        "PLATFORM": platform,
        "FLOWS": "",
        "FULL_SUITE": FULL_SUITE,
        "GITHUB_OUTPUT": str(out),
        "GITHUB_STEP_SUMMARY": str(summary),
        "PATH": "/usr/bin:/bin",
    }
    for key in MAESTRO_KEYS:
        env["F_" + key.upper()] = "true" if matches(key, files) else "false"
    proc = subprocess.run(
        ["bash", "-e", "-c", scope_script()],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    pairs = dict(line.split("=", 1) for line in out.read_text().splitlines() if "=" in line)
    return pairs["projects"]


# --- the path table ---------------------------------------------------------------------


def test_maestro_shared_is_drag_plus_maestro_own_files_not_all_of_shared():
    patterns = list(flatten(table()["maestro_shared"]))
    assert "frontend/src/game/_shared/drag/**" in patterns
    assert "frontend/src/game/_shared/**" not in patterns
    assert "e2e/maestro/**" in patterns
    assert ".github/workflows/detect-maestro-scope.yml" in patterns
    assert ".github/paths/**" in patterns
    assert "frontend/src/i18n/locales/en/common.json" in patterns
    # Only drag code under src/game; no game's own directory.
    assert [p for p in patterns if p.startswith("frontend/src/game/")] == [
        "frontend/src/game/_shared/drag/**"
    ]


def test_maestro_drag_is_only_the_shared_drag_directory():
    assert list(flatten(table()["maestro_drag"])) == ["frontend/src/game/_shared/drag/**"]


def test_scope_step_reads_no_per_game_or_shared_app_filter():
    script = scope_script()
    for key in ("shared_app", "yacht", "mahjong", "cascade", "solitaire", "freecell"):
        assert f"filter.outputs.{key}" not in WORKFLOW.read_text()
    assert "F_SHARED_APP" not in script
    assert "F_MAHJONG" not in script
    assert "F_MAESTRO_SHARED" not in script


def test_playwright_keys_are_unchanged():
    t = table()
    # `shared` still pulls in shared_app (Playwright's full-suite trigger) and the workflows.
    assert "frontend/App.tsx" in list(flatten(t["shared"]))
    assert ".github/workflows/**" in list(flatten(t["shared"]))
    assert list(flatten(t["playwright_shared"])) == ["e2e/**"]
    for game in ("mahjong", "cascade", "solitaire", "freecell", "yacht", "daily_word"):
        assert t[game]


# --- acceptance: which projects run on a PR into dev ---------------------------------------


@pytest.mark.parametrize(
    "files",
    [
        ["frontend/src/game/_shared/replay/recorder.ts"],  # replay-only PR
        ["frontend/assets/images/old-banner.png"],  # asset deletion
        ["frontend/src/game/mahjong/engine.ts"],
        ["frontend/src/screens/MahjongScreen.tsx", "frontend/src/components/mahjong/Tile.tsx"],
        ["frontend/src/game/cascade/engine.ts"],
        ["frontend/src/game/yacht/engine.ts", "frontend/src/game/solitaire/engine.ts"],
        ["frontend/src/theme/colors.ts"],  # shared_app no longer forces the suite
        ["frontend/App.tsx"],
        ["backend/main.py"],
        [".github/workflows/ci.yml"],
        ["docs/MAESTRO.md"],
        ["frontend/src/i18n/locales/fr/common.json"],
    ],
)
@pytest.mark.parametrize("platform", ["android", "ios"])
def test_pr_into_dev_runs_no_maestro(tmp_path, files, platform):
    assert run_scope(tmp_path, files, platform=platform) == ""


def test_drag_pr_runs_the_solitaire_and_freecell_directories_only(tmp_path):
    files = ["frontend/src/game/_shared/drag/useDrag.ts"]
    assert run_scope(tmp_path, files) == DRAG


def test_drag_directories_hold_the_drag_flows():
    # The tooling selects whole directories, so these must contain the drag flows.
    assert sorted(p.name for p in (FLOWS / "solitaire").glob("drag*.yaml"))
    assert sorted(p.name for p in (FLOWS / "freecell").glob("drag*.yaml"))
    assert (FLOWS / "_shared" / "assert-drag-ok.yaml").exists()


@pytest.mark.parametrize(
    "files",
    [
        ["frontend/android/app/build.gradle"],
        ["frontend/package.json"],  # Expo / React Native bump
        ["frontend/package-lock.json"],
        ["frontend/app.json"],
    ],
)
def test_native_or_expo_bump_runs_full_suite_on_android(tmp_path, files):
    assert run_scope(tmp_path, files) == FULL_SUITE


@pytest.mark.parametrize(
    "files",
    [["frontend/ios/Podfile.lock"], ["frontend/package.json"], ["frontend/app.json"]],
)
def test_native_change_runs_full_suite_on_ios(tmp_path, files):
    assert run_scope(tmp_path, files, platform="ios") == FULL_SUITE


def test_android_native_change_does_not_skip_ios_gate_logic(tmp_path):
    # frontend/android/** is not a native_ios path: iOS stays skipped.
    assert run_scope(tmp_path, ["frontend/android/app/build.gradle"], platform="ios") == ""


@pytest.mark.parametrize(
    "files",
    [
        ["e2e/maestro/flows/mahjong/smoke.yaml"],
        [".github/workflows/mobile-smoke-android.yml"],
        [".github/paths/game-paths.yml"],
        ["frontend/src/i18n/locales/en/common.json"],
    ],
)
def test_maestro_own_files_run_full_suite_on_android(tmp_path, files):
    assert run_scope(tmp_path, files) == FULL_SUITE


def test_drag_pr_is_skipped_on_ios_by_the_native_gate(tmp_path):
    assert run_scope(tmp_path, ["frontend/src/game/_shared/drag/x.ts"], platform="ios") == ""


@pytest.mark.parametrize("platform", ["android", "ios"])
@pytest.mark.parametrize(
    "event,base",
    [
        ("pull_request", "main"),
        ("push", ""),
        ("schedule", ""),
        ("workflow_dispatch", ""),
    ],
)
def test_other_events_still_run_the_full_suite(tmp_path, event, base, platform):
    # Nothing matched at all: still the full suite.
    assert run_scope(tmp_path, [], event=event, base=base, platform=platform) == FULL_SUITE
    assert (
        run_scope(tmp_path, ["frontend/src/game/mahjong/engine.ts"], event=event, base=base)
        == FULL_SUITE
    )


# --- the stale-list guard -----------------------------------------------------------------


def guard_script():
    steps = yaml.safe_load(WORKFLOW.read_text())["jobs"]["detect"]["steps"]
    return next(s for s in steps if s.get("id") == "guard")["run"]


def run_guard(tmp_path, flow_dirs):
    work = tmp_path / "repo"
    for d in flow_dirs:
        (work / "e2e" / "maestro" / "flows" / d).mkdir(parents=True)
    out = tmp_path / "guard_out"
    out.write_text("")
    proc = subprocess.run(
        ["bash", "-e", "-c", guard_script()],
        cwd=work,
        env={"GITHUB_OUTPUT": str(out), "PATH": "/usr/bin:/bin"},
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.returncode, out.read_text(), proc.stdout + proc.stderr


def test_guard_passes_for_the_real_flow_directories(tmp_path):
    dirs = ["_shared"] + [p.name for p in FLOWS.iterdir() if p.is_dir() and p.name != "_shared"]
    code, out, log = run_guard(tmp_path, dirs)
    assert code == 0, log
    assert out.strip() == "full_suite=" + FULL_SUITE


def test_guard_catches_a_new_flow_directory_missing_from_the_list(tmp_path):
    dirs = ["_shared", *FULL_SUITE.split(), "newgame"]
    code, _, log = run_guard(tmp_path, dirs)
    assert code == 1
    assert "newgame" in log

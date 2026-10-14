"""Guards for native project file detection in CI (#3213).

Does NOT require DATABASE_URL. Builds throwaway git repos and runs
scripts/detect-native-file-changes.sh against sample diffs.
"""

from __future__ import annotations

import pathlib
import subprocess

import pytest
import yaml

REPO_ROOT = pathlib.Path(__file__).parent.parent.parent
SCRIPT = REPO_ROOT / "scripts" / "detect-native-file-changes.sh"
CI_YML = REPO_ROOT / ".github" / "workflows" / "ci.yml"


def _git(cwd: pathlib.Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=t", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _detect(tmp_path: pathlib.Path, files: list[str]) -> dict[str, str]:
    _git(tmp_path, "init", "-q")
    (tmp_path / "README.md").write_text("x")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-qm", "base")
    base = _git(tmp_path, "rev-parse", "HEAD")
    for f in files:
        p = tmp_path / f
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("changed")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-qm", "change", "--allow-empty")
    out = tmp_path / "out"
    out.write_text("")
    subprocess.run(
        ["bash", str(SCRIPT), base],
        cwd=tmp_path,
        check=True,
        env={"GITHUB_OUTPUT": str(out), "PATH": "/usr/bin:/bin"},
    )
    return dict(line.split("=", 1) for line in out.read_text().splitlines())


@pytest.mark.parametrize(
    "files,ios,android",
    [
        (["frontend/ios/GamingApp.xcodeproj/project.pbxproj"], "true", "false"),
        (["frontend/ios/GamingApp/Info.plist", "frontend/ios/en.lproj/x.strings"], "true", "false"),
        (["frontend/android/app/src/main/AndroidManifest.xml"], "false", "true"),
        (["frontend/ios/GamingApp/Info.plist", "frontend/android/build.gradle"], "true", "true"),
        (["frontend/src/App.tsx", "docs/IOS.md"], "false", "false"),
        (["frontend/ios/Podfile.lock"], "false", "false"),
        (["frontend/ios/Podfile.lock", "frontend/ios/Podfile"], "true", "false"),
        (["frontend/ios/build/generated/x.h"], "false", "false"),
        (["frontend/ios/Podfile.lock.bak"], "true", "false"),
    ],
)
def test_detect_native_file_changes(tmp_path, files, ios, android):
    result = _detect(tmp_path, files)
    assert result == {"ios_files_changed": ios, "android_files_changed": android}


def test_detect_without_base_is_false():
    out = subprocess.run(
        ["bash", str(SCRIPT)],
        capture_output=True,
        text=True,
        check=True,
        env={"PATH": "/usr/bin:/bin"},
    ).stdout
    assert "ios_files_changed=false" in out and "android_files_changed=false" in out


def _run(cwd: pathlib.Path, *args: str) -> tuple[subprocess.CompletedProcess, dict[str, str]]:
    out = cwd / "out"
    out.write_text("")
    proc = subprocess.run(
        ["bash", str(SCRIPT), *args],
        check=False,
        cwd=cwd,
        capture_output=True,
        text=True,
        env={"GITHUB_OUTPUT": str(out), "PATH": "/usr/bin:/bin"},
    )
    return proc, dict(line.split("=", 1) for line in out.read_text().splitlines())


def _commit(cwd: pathlib.Path, path: str, msg: str) -> None:
    p = cwd / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(msg)
    _git(cwd, "add", "-A")
    _git(cwd, "commit", "-qm", msg)


def test_merge_ref_ignores_base_changes_made_after_base_sha(tmp_path):
    """On a PR merge ref, iOS edits that landed on the base later are not the PR's."""
    _git(tmp_path, "init", "-q", "-b", "dev")
    _commit(tmp_path, "README.md", "base")
    old_base = _git(tmp_path, "rev-parse", "HEAD")
    _git(tmp_path, "checkout", "-qb", "feature")
    _commit(tmp_path, "frontend/src/App.tsx", "pr change")
    _git(tmp_path, "checkout", "-q", "dev")
    _commit(tmp_path, "frontend/ios/GamingApp/Info.plist", "dev moved")
    # GitHub's merge ref: first parent = current base tip, second = PR head.
    _git(tmp_path, "merge", "-q", "--no-ff", "feature", "-m", "merge ref")
    proc, result = _run(tmp_path, old_base)
    assert proc.returncode == 0
    assert result == {"ios_files_changed": "false", "android_files_changed": "false"}


def test_merge_ref_detects_the_prs_own_native_edit(tmp_path):
    _git(tmp_path, "init", "-q", "-b", "dev")
    _commit(tmp_path, "README.md", "base")
    base = _git(tmp_path, "rev-parse", "HEAD")
    _git(tmp_path, "checkout", "-qb", "feature")
    _commit(tmp_path, "frontend/android/app/build.gradle", "pr change")
    _git(tmp_path, "checkout", "-q", "dev")
    _git(tmp_path, "merge", "-q", "--no-ff", "feature", "-m", "merge ref")
    _, result = _run(tmp_path, base)
    assert result == {"ios_files_changed": "false", "android_files_changed": "true"}


def test_unresolvable_base_warns_and_reports_false(tmp_path):
    _git(tmp_path, "init", "-q")
    _commit(tmp_path, "README.md", "base")
    proc, result = _run(tmp_path, "deadbeef" * 5)
    assert proc.returncode == 0
    assert "::warning::" in proc.stdout
    assert result == {"ios_files_changed": "false", "android_files_changed": "false"}


def test_build_checks_trigger_on_native_file_changes():
    jobs = yaml.safe_load(CI_YML.read_text(encoding="utf-8"))["jobs"]
    detect = jobs["detect-native-changes"]
    # The job exposes the step's outputs under the names the build checks read.
    assert detect["outputs"]["ios_files_changed"] == "${{ steps.files.outputs.ios_files_changed }}"
    assert (
        detect["outputs"]["android_files_changed"]
        == "${{ steps.files.outputs.android_files_changed }}"
    )
    (step,) = [s for s in detect["steps"] if s.get("id") == "files"]
    assert step["run"] == "./scripts/detect-native-file-changes.sh"
    assert step["if"] == "github.event_name == 'pull_request'"
    assert step["env"] == {"BASE_SHA": "${{ github.event.pull_request.base.sha }}"}
    assert step["continue-on-error"] is True
    checkout = next(
        s for s in detect["steps"] if str(s.get("uses", "")).startswith("actions/checkout")
    )
    assert checkout["with"]["fetch-depth"] == 0  # the diff needs full history

    ios_if = jobs["ios-build-check"]["if"]
    android_if = jobs["android-build-check"]["if"]
    assert "needs.detect-native-changes.outputs.ios_files_changed == 'true'" in ios_if
    assert "needs.detect-native-changes.outputs.android_files_changed == 'true'" in android_if
    # Podfile freshness must stay tied to package bumps only.
    assert jobs["podfile-lock-check"]["if"].endswith("has_native_ios == 'true'")

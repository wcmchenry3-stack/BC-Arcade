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


def test_build_checks_trigger_on_native_file_changes():
    jobs = yaml.safe_load(CI_YML.read_text(encoding="utf-8"))["jobs"]
    assert "ios_files_changed == 'true'" in jobs["ios-build-check"]["if"]
    assert "android_files_changed == 'true'" in jobs["android-build-check"]["if"]
    # Podfile freshness must stay tied to package bumps only.
    assert jobs["podfile-lock-check"]["if"].endswith("has_native_ios == 'true'")

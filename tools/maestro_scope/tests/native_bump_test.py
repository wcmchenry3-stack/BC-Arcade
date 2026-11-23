"""Expo / React Native bump detection (#4057)."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

TOOL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL))

import native_bump


def pkg(**deps):
    return json.dumps({"dependencies": deps, "devDependencies": {"jest": "^29.0.0"}})


BASE = pkg(**{"react-native": "0.76.0", "react-i18next": "15.0.0", "expo": "~52.0.0"})


def bump(name, version="9.9.9", base=BASE):
    head = json.loads(base)
    head["dependencies"][name] = version
    return native_bump.changed_native_packages(base, json.dumps(head))


@pytest.mark.parametrize(
    "name",
    [
        "react-native",
        "expo",
        "expo-router",
        "@expo/vector-icons",
        "react-native-reanimated",
        "@react-native/gradle-plugin",
        "@react-native-async-storage/async-storage",
        "@shopify/react-native-skia",
        "@sentry/react-native",
    ],
)
def test_expo_and_react_native_packages_are_native(name):
    assert bump(name) == [name]


@pytest.mark.parametrize(
    "name", ["react-i18next", "intl-pluralrules", "exponential", "@types/react", "metronome"]
)
def test_plain_js_packages_are_not_native(name):
    assert bump(name) == []


@pytest.mark.parametrize("name", ["react", "metro", "metro-config", "babel-preset-expo"])
def test_bundle_packages_count_as_native(name):
    """react, the Metro bundler and Expo's Babel preset change the shipped bundle (#4072 review)."""
    assert native_bump.is_native_package(name)


def test_removed_native_package_is_native():
    head = json.dumps({"dependencies": {"react-i18next": "15.0.0", "expo": "~52.0.0"}})
    assert native_bump.changed_native_packages(BASE, head) == ["react-native"]


def test_dev_dependency_bump_counts():
    head = json.loads(BASE)
    head["devDependencies"]["@types/react-native"] = "1.0.0"
    assert native_bump.changed_native_packages(BASE, json.dumps(head)) == ["@types/react-native"]


def run_cli(tmp_path, base_text, head_text):
    base, head = tmp_path / "base.json", tmp_path / "head.json"
    if base_text is not None:
        base.write_text(base_text)
    if head_text is not None:
        head.write_text(head_text)
    proc = subprocess.run(
        [sys.executable, str(TOOL / "native_bump.py"), str(base), str(head)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0
    return proc.stdout.strip(), proc.stderr


def test_cli_lockfile_only_change_is_not_native(tmp_path):
    out, _ = run_cli(tmp_path, BASE, BASE)
    assert out == "false"


def test_cli_plain_js_bump_is_not_native(tmp_path):
    head = json.loads(BASE)
    head["dependencies"]["react-i18next"] = "16.0.0"
    out, _ = run_cli(tmp_path, BASE, json.dumps(head))
    assert out == "false"


def test_cli_react_native_bump_is_native(tmp_path):
    head = json.loads(BASE)
    head["dependencies"]["react-native"] = "0.77.0"
    out, err = run_cli(tmp_path, BASE, json.dumps(head))
    assert out == "true"
    assert "react-native" in err


@pytest.mark.parametrize(
    "base_text,head_text",
    [
        (None, BASE),
        ("{not json", BASE),
        (BASE, "[]"),
        (BASE, None),
        ('{"dependencies": []}', BASE),
    ],
)
def test_cli_fails_safe_to_native_with_a_warning(tmp_path, base_text, head_text):
    out, err = run_cli(tmp_path, base_text, head_text)
    assert out == "true"
    assert "::warning::" in err

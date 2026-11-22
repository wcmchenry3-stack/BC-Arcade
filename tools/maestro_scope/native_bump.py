"""Decide whether a PR bumps an Expo / React Native dependency (#4057).

Used by .github/workflows/detect-maestro-scope.yml on PRs into dev: an Expo or React Native
package change in frontend/package.json runs the full Android Maestro suite; plain JS bumps
(react-i18next, intl-pluralrules, ...) and lockfile-only changes do not. Stdlib only, no npm.

    python3 tools/maestro_scope/native_bump.py BASE_PACKAGE_JSON HEAD_PACKAGE_JSON

Prints `true` or `false` on stdout, warnings on stderr. Anything unreadable fails safe to `true`.
"""

import json
import sys
from pathlib import Path

DEP_SECTIONS = ("dependencies", "devDependencies")


def is_native_package(name):
    """Expo or React Native package: expo, expo-*, @expo/*, or any name containing react-native
    (react-native, react-native-*, @react-native/*, @react-native-*/*, @shopify/react-native-skia,
    @sentry/react-native, ...)."""
    return name == "expo" or name.startswith(("expo-", "@expo/")) or "react-native" in name


def dependencies(text):
    """name -> version over dependencies + devDependencies. Raises ValueError or TypeError if malformed."""
    try:
        data = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise TypeError("top level is not an object")
    deps = {}
    for section in DEP_SECTIONS:
        value = data.get(section, {})
        if not isinstance(value, dict):
            raise TypeError(f"{section} is not an object")
        deps.update(value)
    return deps


def changed_native_packages(base_text, head_text):
    """Native packages added, removed or whose version changed. Raises ValueError or TypeError if malformed."""
    base, head = dependencies(base_text), dependencies(head_text)
    return sorted(
        n for n in base.keys() | head.keys() if base.get(n) != head.get(n) and is_native_package(n)
    )


def read(path):
    try:
        return Path(path).read_text()
    except OSError:
        return None


def main(argv):
    if len(argv) != 3:
        print("usage: native_bump.py BASE_PACKAGE_JSON HEAD_PACKAGE_JSON", file=sys.stderr)
        return 2
    base_text, head_text = read(argv[1]), read(argv[2])
    if base_text is None or head_text is None:
        print(
            "::warning::native_bump: package.json missing at base or head; treating as native (full suite)",
            file=sys.stderr,
        )
        print("true")
        return 0
    try:
        changed = changed_native_packages(base_text, head_text)
    except (ValueError, TypeError) as exc:
        print(
            f"::warning::native_bump: cannot compare package.json ({exc}); treating as native (full suite)",
            file=sys.stderr,
        )
        print("true")
        return 0
    if changed:
        print(
            f"native_bump: Expo/React Native packages changed: {', '.join(changed)}",
            file=sys.stderr,
        )
    print("true" if changed else "false")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

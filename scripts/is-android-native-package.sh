#!/usr/bin/env bash
# Is an npm package Android-native? Used by detect-native-changes in ci.yml (#4058).
#
# Usage: is-android-native-package.sh PKG_NAME PKG_DIR
# Exit 0 when the package counts as Android-native, 1 otherwise. A package is when
#   - it is `react-native` or `expo` (by name: a bump always changes the native build), or
#   - it has a ReactAndroid/ directory (react-native keeps its sources there), or
#   - its android/ directory holds Java, Kotlin or C++ sources at any depth up to 12
#     (Expo modules keep them at android/src/main/java/expo/modules/<name>/, depth 6+).
#     node_modules/ and build/ inside android/ are pruned.
set -euo pipefail

NAME="${1:?package name}"
DIR="${2:-}"

case "$NAME" in
  react-native | expo) exit 0 ;;
esac

[ -n "$DIR" ] && [ -d "$DIR" ] || exit 1

if [ -d "$DIR/ReactAndroid" ]; then exit 0; fi

if [ -d "$DIR/android" ]; then
  HIT=$(find "$DIR/android" -maxdepth 12 \
    \( -name node_modules -o -name build \) -prune -o \
    -type f \( -name '*.java' -o -name '*.kt' -o -name '*.cpp' \) -print -quit 2>/dev/null || true)
  [ -n "$HIT" ] && exit 0
fi
exit 1

#!/usr/bin/env bash
# Detect edits to the committed native projects in a PR diff (#3213).
#
# Usage: detect-native-file-changes.sh [BASE_SHA]   (BASE_SHA may also come from $BASE_SHA)
# Writes ios_files_changed=true|false and android_files_changed=true|false to
# $GITHUB_OUTPUT (stdout when unset). Diffs BASE_SHA...HEAD (merge-base), the same
# approach android-release-smoke uses.
#
# frontend/ios/Podfile.lock alone does not count as an iOS change: lock-only
# changes come from native package bumps (already caught by the package.json
# detection, with podfile-lock-check guarding freshness). frontend/ios/build/
# is generated output and is ignored too.
set -euo pipefail

BASE="${1:-${BASE_SHA:-}}"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"

if [ -z "$BASE" ]; then
  echo "ios_files_changed=false" >> "$OUT"
  echo "android_files_changed=false" >> "$OUT"
  exit 0
fi

CHANGED=$(git diff --name-only "$BASE"...HEAD)

if printf '%s\n' "$CHANGED" | grep -E '^frontend/ios/' \
   | grep -vE '^frontend/ios/(Podfile\.lock|build/)' | grep -q .; then
  IOS=true
else
  IOS=false
fi
if printf '%s\n' "$CHANGED" | grep -qE '^frontend/android/'; then
  ANDROID=true
else
  ANDROID=false
fi

echo "ios_files_changed=$IOS" >> "$OUT"
echo "android_files_changed=$ANDROID" >> "$OUT"

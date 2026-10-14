#!/usr/bin/env bash
# Detect edits to the committed native projects in a PR diff (#3213).
#
# Usage: detect-native-file-changes.sh [BASE_SHA]   (BASE_SHA may also come from $BASE_SHA)
# Writes ios_files_changed=true|false and android_files_changed=true|false to
# $GITHUB_OUTPUT (stdout when unset).
#
# On a pull_request event HEAD is GitHub's merge commit, whose first parent is the
# current base tip, so `HEAD^1 HEAD` is exactly what the PR changes even when the
# base has moved since BASE_SHA was recorded. Otherwise BASE_SHA...HEAD (merge-base).
# --no-renames so a file moved out of a native project still lists its old path.
#
# frontend/ios/Podfile.lock alone does not count as an iOS change: lock-only
# changes come from native package bumps (already caught by the package.json
# detection, with podfile-lock-check guarding freshness). frontend/ios/build/
# is generated output and is ignored too.
set -euo pipefail

BASE="${1:-${BASE_SHA:-}}"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"

emit() {
  echo "ios_files_changed=$1" >> "$OUT"
  echo "android_files_changed=$2" >> "$OUT"
}

if [ -z "$BASE" ]; then
  emit false false
  exit 0
fi

if git rev-parse -q --verify 'HEAD^2' >/dev/null; then
  RANGE=(HEAD^1 HEAD)
else
  RANGE=("$BASE...HEAD")
fi

if ! CHANGED=$(git diff --no-renames --name-only "${RANGE[@]}"); then
  echo "::warning::detect-native-file-changes: git diff ${RANGE[*]} failed; native build checks not triggered by file changes"
  emit false false
  exit 0
fi

# No early-exiting pipes: under pipefail a `grep -q` that stops reading kills the
# writer with SIGPIPE and the whole test reads as false on large diffs.
IOS_FILES=$(grep -E '^frontend/ios/' <<<"$CHANGED" \
  | grep -vE '^frontend/ios/(Podfile\.lock$|build/)' || true)
if [ -n "$IOS_FILES" ]; then IOS=true; else IOS=false; fi
if grep -qE '^frontend/android/' <<<"$CHANGED"; then ANDROID=true; else ANDROID=false; fi

emit "$IOS" "$ANDROID"

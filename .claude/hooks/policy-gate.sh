#!/usr/bin/env bash
# policy-gate.sh — PreToolUse hook for Claude Code
# Blocks `gh pr create` when changed files match API policy detection
# patterns, prompting the policy-compliance sub-agent to review.
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/output.sh
source "$HOOK_DIR/lib/output.sh"

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Only gate on PR-creation commands; check first line only to avoid matching
# text inside heredoc commit messages that contain 'gh pr create' in the body.
FIRST_LINE=$(echo "$COMMAND" | head -1)
if ! echo "$FIRST_LINE" | grep -qE '^gh\s+pr\s+create'; then
  exit 0
fi

# ── Locate policy-patterns.json ──────────────────────────────────────────────
PATTERNS_FILE=".claude/policies/policy-patterns.json"
if [ ! -f "$PATTERNS_FILE" ]; then
  exit 0
fi

# ── Get changed files ────────────────────────────────────────────────────────
MERGE_BASE=$(git merge-base origin/dev HEAD 2>/dev/null || \
             git merge-base origin/main HEAD 2>/dev/null || \
             echo "")
if [ -n "$MERGE_BASE" ]; then
  DIFF_BASE="$MERGE_BASE"
  CHANGED_FILES=$(git diff --name-only "$DIFF_BASE" HEAD 2>/dev/null || echo "")
else
  DIFF_BASE="HEAD~1"
  CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || echo "")
fi

[ -z "$CHANGED_FILES" ] && exit 0

# ── Check each policy's detection patterns ───────────────────────────────────
TRIGGERED=""

for POLICY in $(jq -r 'to_entries[] | select(.value | type == "object") | .key' "$PATTERNS_FILE" | tr -d '\r'); do
  DETECT=$(jq -r --arg p "$POLICY" '.[$p].detect' "$PATTERNS_FILE" | tr -d '\r')
  SKIP=$(jq -r --arg p "$POLICY" '.[$p].skip // empty' "$PATTERNS_FILE" | tr -d '\r')

  [ -z "$DETECT" ] || [ "$DETECT" = "null" ] && continue

  while IFS= read -r file; do
    case "$file" in .claude/*) continue ;; esac
    case "$file" in *.md|*.mdx|CLAUDE.md) continue ;; esac

    if [ -n "$SKIP" ] && { echo "$file" | grep -qE "$SKIP" || echo "$(basename "$file")" | grep -qE "$SKIP"; }; then
      continue
    fi

    if git diff "$DIFF_BASE" HEAD -- "$file" 2>/dev/null | grep -qE "^\+[^+].*($DETECT)"; then
      TRIGGERED+="  - $POLICY → $file\n"
      break
    fi
  done <<< "$CHANGED_FILES"
done

# ── Verdict ──────────────────────────────────────────────────────────────────
if [ -n "$TRIGGERED" ]; then
  {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "[FAIL] Policy gate — policy-relevant files changed"
    echo "Fix:   Invoke the policy-compliance agent to review"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Triggered policies:"
    echo -e "$TRIGGERED"
  } >&2
  print_blocked "PR creation"
  exit 2
fi

print_ok "Policy gate"
exit 0

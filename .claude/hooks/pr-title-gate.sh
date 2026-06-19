#!/usr/bin/env bash
# pr-title-gate.sh — PreToolUse: gate on `gh pr create` and `gh pr edit`
# Validates PR title against conventional commit format and 72-char subject limit
# (mirrors amannn/action-semantic-pull-request@v6 defaults used in CI)
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/output.sh
source "$HOOK_DIR/lib/output.sh"

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

FIRST_LINE=$(echo "$COMMAND" | head -1)
if ! echo "$FIRST_LINE" | grep -qE '^gh[[:space:]]+pr[[:space:]]+(create|edit)'; then
  exit 0
fi

# Extract --title value using sed (POSIX-compatible, no grep -P)
TITLE=$(echo "$COMMAND" | sed -n 's/.*--title "\([^"]*\)".*/\1/p' | head -1)
if [ -z "$TITLE" ]; then
  TITLE=$(echo "$COMMAND" | sed -n "s/.*--title '\\([^']*\\)'.*/\\1/p" | head -1)
fi

# No --title flag — nothing to validate (e.g. gh pr edit adding a label)
[ -z "$TITLE" ] && exit 0

FAIL=0

VALID_TYPES="feat|fix|chore|docs|style|refactor|test|perf|ci|build|revert"

# ── Conventional commit format ────────────────────────────────────────────────
# Pattern: type(optional-scope)!?: subject
CC_PATTERN="^(${VALID_TYPES})(\([^)]+\))?\!?: .+"
if ! echo "$TITLE" | grep -qE "$CC_PATTERN"; then
  FAIL=1
  print_fail "PR title format" \
    "does not match conventional commit format" \
    "Use: type(scope)?: subject — e.g. feat(solitaire): add smart tap"
  echo "  Valid types: $VALID_TYPES" >&2
  echo "  Title given: $TITLE" >&2
fi

# ── Subject length (1–72 chars) ───────────────────────────────────────────────
# Strip the "type(scope)?: " prefix to measure just the subject
SUBJECT=$(echo "$TITLE" | sed -E "s/^(${VALID_TYPES})(\([^)]+\))?\!?: //")
SUBJECT_LEN=${#SUBJECT}
if [ "$SUBJECT_LEN" -lt 1 ] || [ "$SUBJECT_LEN" -gt 72 ]; then
  FAIL=1
  print_fail "PR title length" \
    "subject is $SUBJECT_LEN chars (must be 1–72)" \
    "Shorten the subject portion of the PR title"
  echo "  Subject: $SUBJECT" >&2
fi

# ── Verdict ───────────────────────────────────────────────────────────────────
if [ "$FAIL" -ne 0 ]; then
  print_blocked "PR creation"
  exit 2
fi

print_ok "PR title"
exit 0

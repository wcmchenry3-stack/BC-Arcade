#!/usr/bin/env bash
# lib/output.sh — shared output format for pre-check hooks
# Source with: source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/output.sh"

_DIVIDER="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

print_ok() {
  echo "[OK]  $1" >&2
}

# print_fail <name> <summary> <fix-command>
print_fail() {
  echo "$_DIVIDER" >&2
  echo "[FAIL] $1 — $2" >&2
  echo "Fix:   $3" >&2
  echo "$_DIVIDER" >&2
}

# print_blocked <action>  e.g. "commit", "push", "PR creation"
print_blocked() {
  echo "" >&2
  echo "Blocked: $1 aborted. Fix the above and retry." >&2
}

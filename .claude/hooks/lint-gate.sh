#!/usr/bin/env bash
# lint-gate.sh — PreToolUse hook for Claude Code
# Blocks `gh pr create` when linting issues exist, prompting the
# lint-review sub-agent to auto-fix before retrying.
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/output.sh
source "$HOOK_DIR/lib/output.sh"

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Check only the first line to avoid matching text inside heredoc commit messages
FIRST_LINE=$(echo "$COMMAND" | head -1)
if ! echo "$FIRST_LINE" | grep -qE '^gh\s+pr\s+create'; then
  exit 0
fi

FAIL=0

# ── Python linting (black + ruff) ────────────────────────────────────────────
if [ -f "backend/requirements.txt" ]; then
  VENV="backend/.venv/bin/activate"
  if [ -f "$VENV" ]; then
    # shellcheck disable=SC1090
    source "$VENV"
    if command -v black &>/dev/null; then
      if OUT=$(cd backend && black --check --quiet . 2>&1); then
        print_ok "black"
      else
        FAIL=1
        print_fail "black" \
          "formatting issues in backend/" \
          "cd backend && source .venv/bin/activate && black ."
      fi
    fi
    if command -v ruff &>/dev/null; then
      if OUT=$(cd backend && ruff check --no-fix . 2>&1); then
        print_ok "ruff"
      else
        FAIL=1
        ISSUES=$(echo "$OUT" | grep -c 'error\|warning' 2>/dev/null || echo "?")
        print_fail "ruff" \
          "$ISSUES issue(s) in backend/" \
          "cd backend && source .venv/bin/activate && ruff check --fix ."
      fi
    fi
    deactivate 2>/dev/null || true
  fi
fi

# ── Frontend linting (eslint + prettier) ─────────────────────────────────────
if [ -f "frontend/package.json" ]; then
  if [ -x "frontend/node_modules/.bin/eslint" ]; then
    if OUT=$(cd frontend && npx eslint . 2>&1); then
      print_ok "ESLint"
    else
      FAIL=1
      ERR_COUNT=$(echo "$OUT" | grep -c ' error ' 2>/dev/null || echo "?")
      print_fail "ESLint" \
        "$ERR_COUNT error(s) in frontend/" \
        "cd frontend && npx eslint --fix ."
    fi
  fi
  if [ -x "frontend/node_modules/.bin/prettier" ]; then
    if OUT=$(cd frontend && npx prettier --check . 2>&1); then
      print_ok "Prettier"
    else
      FAIL=1
      print_fail "Prettier" \
        "formatting issues in frontend/" \
        "cd frontend && npx prettier --write ."
    fi
  fi
fi

# ── Verdict ──────────────────────────────────────────────────────────────────
if [ "$FAIL" -ne 0 ]; then
  print_blocked "PR creation"
  exit 2
fi

exit 0

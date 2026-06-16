#!/usr/bin/env bash
# commit-gate.sh — PreToolUse: tier-1 gate on `git commit`
# Checks: conflict markers, forbidden terms, staged-files lint (frontend + Python)
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/output.sh
source "$HOOK_DIR/lib/output.sh"

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Check only the first line to avoid matching text inside heredoc commit messages
FIRST_LINE=$(echo "$COMMAND" | head -1)
# Only gate on git commit (not git commit-graph or similar)
if ! echo "$FIRST_LINE" | grep -qE '^git\s+commit([^-]|$)'; then
  exit 0
fi

FAIL=0
STAGED=$(git diff --cached --name-only 2>/dev/null || true)

[ -z "$STAGED" ] && exit 0

# ── Conflict markers ─────────────────────────────────────────────────────────
CONFLICT_SCOPE=$(echo "$STAGED" | grep -E '\.(ts|tsx|py|js|jsx|json|yml|yaml)$' || true)
CONFLICT_HIT=""
if [ -n "$CONFLICT_SCOPE" ]; then
  while IFS= read -r f; do
    if [ -f "$f" ] && grep -qE '^<<<<<<< |^=======$|^>>>>>>> ' "$f" 2>/dev/null; then
      CONFLICT_HIT="$f"
      break
    fi
  done <<< "$CONFLICT_SCOPE"

  if [ -n "$CONFLICT_HIT" ]; then
    FAIL=1
    print_fail "Conflict markers" \
      "merge conflict marker in $CONFLICT_HIT" \
      "Resolve conflict in $CONFLICT_HIT, then: git add $CONFLICT_HIT"
  else
    print_ok "Conflict markers"
  fi
fi

# ── Forbidden terms ──────────────────────────────────────────────────────────
TERM_PATTERN='Yahtzee|\bFruit Merge\b|Galaga|Neon Arcade'
TERM_SCOPE=$(echo "$STAGED" | grep -E '\.(ts|tsx|py|js|jsx|json|yml|yaml|md)$' | \
  grep -vE '^(\.github/|\.claude/|alembic/)' | \
  grep -vE '(BRANDING\.md|CLAUDE\.md)$' || true)
TERM_HIT=""
if [ -n "$TERM_SCOPE" ]; then
  while IFS= read -r f; do
    if [ -f "$f" ] && grep -qiE "$TERM_PATTERN" "$f" 2>/dev/null; then
      TERM_HIT="$f"
      break
    fi
  done <<< "$TERM_SCOPE"

  if [ -n "$TERM_HIT" ]; then
    FAIL=1
    print_fail "Forbidden terms" \
      "trademark/brand term in $TERM_HIT" \
      "grep -niE '$TERM_PATTERN' $TERM_HIT"
  else
    print_ok "Forbidden terms"
  fi
fi

# ── Frontend lint (staged .ts/.tsx/.js/.jsx in frontend/) ────────────────────
FRONTEND_JS=$(echo "$STAGED" | grep -E '^frontend/.*\.(ts|tsx|js|jsx)$' || true)
if [ -n "$FRONTEND_JS" ]; then
  REL_FILES=$(echo "$FRONTEND_JS" | sed 's|^frontend/||')
  FIRST_REL=$(echo "$REL_FILES" | head -1)

  if [ -x "frontend/node_modules/.bin/eslint" ]; then
    if ESLINT_OUT=$(cd frontend && echo "$REL_FILES" | tr '\n' '\0' | xargs -0 npx eslint 2>&1); then
      print_ok "ESLint"
    else
      FAIL=1
      ERR_COUNT=$(echo "$ESLINT_OUT" | grep -c ' error ' 2>/dev/null || echo "?")
      print_fail "ESLint" \
        "$ERR_COUNT error(s) in staged files" \
        "cd frontend && npx eslint --fix $FIRST_REL"
    fi
  fi

  if [ -x "frontend/node_modules/.bin/prettier" ]; then
    if PRETTIER_OUT=$(cd frontend && echo "$REL_FILES" | tr '\n' '\0' | xargs -0 npx prettier --check 2>&1); then
      print_ok "Prettier"
    else
      FAIL=1
      print_fail "Prettier" \
        "formatting issues in staged files" \
        "cd frontend && npx prettier --write $FIRST_REL"
    fi
  fi
fi

# ── Python lint (staged .py files) ───────────────────────────────────────────
PY_FILES=$(echo "$STAGED" | grep '\.py$' || true)
if [ -n "$PY_FILES" ]; then
  FIRST_PY=$(echo "$PY_FILES" | head -1)

  if command -v ruff &>/dev/null; then
    if RUFF_OUT=$(echo "$PY_FILES" | tr '\n' '\0' | xargs -0 ruff check --no-fix 2>&1); then
      print_ok "ruff"
    else
      FAIL=1
      print_fail "ruff" \
        "lint issues in staged Python files" \
        "ruff check --fix $FIRST_PY"
    fi
  fi

  if command -v black &>/dev/null; then
    if BLACK_OUT=$(echo "$PY_FILES" | tr '\n' '\0' | xargs -0 black --check --quiet 2>&1); then
      print_ok "black"
    else
      FAIL=1
      print_fail "black" \
        "formatting issues in staged Python files" \
        "black $FIRST_PY"
    fi
  fi
fi

# ── Verdict ──────────────────────────────────────────────────────────────────
if [ "$FAIL" -ne 0 ]; then
  print_blocked "commit"
  exit 2
fi

exit 0

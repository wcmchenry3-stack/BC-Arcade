#!/usr/bin/env bash
# precheck-gate.sh — PreToolUse: tier-2 gate on `git push` or `gh pr create`
# Checks: npm audit, pip-audit, backend tests, frontend tests, i18n
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/output.sh
source "$HOOK_DIR/lib/output.sh"

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Check only the first line to avoid matching text inside heredoc commit messages
FIRST_LINE=$(echo "$COMMAND" | head -1)
if ! echo "$FIRST_LINE" | grep -qE '^(git\s+push|gh\s+pr\s+create)'; then
  exit 0
fi

FAIL=0

# ── npm audit ────────────────────────────────────────────────────────────────
if [ -f "frontend/package.json" ]; then
  if NPM_OUT=$(cd frontend && npm audit --audit-level=high 2>&1); then
    print_ok "npm audit"
  else
    FAIL=1
    SUMMARY=$(echo "$NPM_OUT" | grep -m1 'vulnerabilit\|found' || echo "high or critical severity vulnerability found")
    print_fail "npm audit" \
      "$SUMMARY" \
      "cd frontend && npm audit fix"
  fi
fi

# ── pip-audit ────────────────────────────────────────────────────────────────
VENV="backend/.venv/bin/activate"
if [ -f "$VENV" ]; then
  # shellcheck disable=SC1090
  source "$VENV"
  if PIP_OUT=$(pip-audit 2>&1); then
    print_ok "pip-audit"
  else
    FAIL=1
    CVE=$(echo "$PIP_OUT" | grep -m1 'CVE\|PYSEC\|vuln' || echo "known CVE in Python dependency")
    print_fail "pip-audit" \
      "$CVE" \
      "cd backend && source .venv/bin/activate && pip-audit --fix"
  fi
  deactivate 2>/dev/null || true
fi

# ── Backend tests ─────────────────────────────────────────────────────────────
if [ -d "backend/tests" ] && [ -f "$VENV" ]; then
  # shellcheck disable=SC1090
  source "$VENV"
  if TEST_OUT=$(cd backend && python -m pytest tests/ -x -q 2>&1); then
    print_ok "Backend tests"
  else
    FAIL=1
    FAILING=$(echo "$TEST_OUT" | grep -m1 '^FAILED\|^ERROR' || echo "see test output above")
    print_fail "Backend tests" \
      "$FAILING" \
      "cd backend && source .venv/bin/activate && python -m pytest tests/ -v"
  fi
  deactivate 2>/dev/null || true
fi

# ── Frontend tests ────────────────────────────────────────────────────────────
if [ -f "frontend/package.json" ]; then
  if FE_OUT=$(cd frontend && npm test -- --watchAll=false --passWithNoTests 2>&1); then
    print_ok "Frontend tests"
  else
    FAIL=1
    FAILING=$(echo "$FE_OUT" | grep -m1 '^FAIL \|● ' || echo "see test output above")
    print_fail "Frontend tests" \
      "$FAILING" \
      "cd frontend && npm test -- --watchAll=false"
  fi
fi

# ── i18n check ────────────────────────────────────────────────────────────────
if [ -f "frontend/scripts/check-i18n-strings.js" ]; then
  if I18N_OUT=$(cd frontend && node scripts/check-i18n-strings.js 2>&1); then
    print_ok "i18n check"
  else
    FAIL=1
    MISSING=$(echo "$I18N_OUT" | grep -m1 'missing\|key\|undefined\|untranslated' || echo "missing translation key(s)")
    print_fail "i18n check" \
      "$MISSING" \
      "cd frontend && node scripts/check-i18n-strings.js 2>&1 | head -30"
  fi
fi

# ── Native package bump warning ───────────────────────────────────────────────
# Non-blocking: CI (detect-native-changes) is the enforcing gate. This gives
# an early local signal before the PR goes up.
if [ -f "frontend/package.json" ] && [ -d "frontend/node_modules" ]; then
  NATIVE_WARN=$(node -e "
    const { execSync } = require('child_process');
    const fs = require('fs');
    try {
      const base = JSON.parse(execSync('git show origin/dev:frontend/package.json 2>/dev/null || git show HEAD~1:frontend/package.json').toString());
      const curr = JSON.parse(fs.readFileSync('frontend/package.json', 'utf8'));
      const before = { ...(base.dependencies || {}), ...(base.devDependencies || {}) };
      const after = { ...(curr.dependencies || {}), ...(curr.devDependencies || {}) };
      const bumped = Object.keys(after).filter(k => after[k] !== before[k]);
      const native = bumped.filter(pkg => {
        const dir = 'frontend/node_modules/' + pkg;
        try {
          const { execSync: ex } = require('child_process');
          const podspec = ex('find ' + dir + ' -maxdepth 2 -name \"*.podspec\" 2>/dev/null', {encoding:'utf8'}).trim();
          if (podspec) return true;
          const android = ex('find ' + dir + '/android -maxdepth 4 -name \"*.java\" -o -name \"*.kt\" -o -name \"*.cpp\" 2>/dev/null', {encoding:'utf8'}).trim();
          if (android) return true;
        } catch {}
        return false;
      });
      if (native.length) process.stdout.write(native.join(', '));
    } catch {}
  " 2>/dev/null || echo "")

  if [ -n "$NATIVE_WARN" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  [WARN] Native packages bumped: $NATIVE_WARN"
    echo ""
    echo "  Before merging, verify:"
    echo "    • App loads in Expo Go without errors"
    echo "    • ios-build-check / android-build-check pass in CI"
    echo "    • Podfile.lock updated if iOS native package changed"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
  fi
fi

# ── Verdict ───────────────────────────────────────────────────────────────────
if [ "$FAIL" -ne 0 ]; then
  print_blocked "push"
  exit 2
fi

exit 0

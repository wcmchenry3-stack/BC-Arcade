#!/usr/bin/env bash
# lib/cache.sh — content-hash cache for expensive precheck-gate.sh steps.
# Source with: source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/cache.sh"
#
# A check is skipped only when its inputs are byte-identical to the last time
# it PASSED (failures are never cached, so a broken check is always re-verified).
# TTL exists so an unchanged lockfile still gets a fresh audit periodically,
# to catch newly disclosed CVEs rather than trusting a stale "pass" forever.

_CACHE_DIR="$HOOK_DIR/.cache"
mkdir -p "$_CACHE_DIR" 2>/dev/null

# hash_tree <path> [path...] — content hash of tracked file bytes under the
# given paths (excludes common build/venv/cache dirs). Order-independent.
hash_tree() {
  find "$@" -type f \
    ! -path "*/node_modules/*" \
    ! -path "*/.venv/*" \
    ! -path "*/__pycache__/*" \
    ! -path "*/.pytest_cache/*" \
    ! -path "*/coverage/*" \
    ! -path "*/htmlcov/*" \
    ! -name ".coverage" \
    -print0 2>/dev/null | sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1
}

# cache_hit <name> <hash> <ttl_seconds> — 0 (hit, skip the check) or 1 (miss, run it)
cache_hit() {
  local name="$1" hash="$2" ttl="$3"
  local f="$_CACHE_DIR/$name"
  [ -f "$f" ] || return 1
  local cached_hash cached_ts now
  cached_hash=$(sed -n '1p' "$f")
  cached_ts=$(sed -n '2p' "$f")
  [ "$cached_hash" = "$hash" ] || return 1
  now=$(date +%s)
  [ -n "$cached_ts" ] && [ $((now - cached_ts)) -lt "$ttl" ]
}

# cache_store <name> <hash> — record a PASS so an identical rerun can skip.
# Never call this on a failing result.
cache_store() {
  local name="$1" hash="$2"
  printf '%s\n%s\n' "$hash" "$(date +%s)" > "$_CACHE_DIR/$name"
}

#!/usr/bin/env bash
# Print the signing-certificate fingerprints of an Android App Bundle and
# compare them with the Play Console upload-key certificate (#2783).
#
# Usage:
#   scripts/verify-aab-signing.sh <app.aab> [expected-sha1-or-sha256]
#   EXPECTED_FINGERPRINT=AA:BB:... scripts/verify-aab-signing.sh <app.aab>
#
# The expected value is copied from Play Console -> App integrity -> Play app
# signing -> Upload key certificate (SHA-1 or SHA-256; colons, spaces and case
# are ignored). Exit codes: 0 match (or nothing to compare, fingerprints
# printed), 1 mismatch or debug certificate, 2 usage/tool error.
#
# Needs keytool (JDK). An AAB is a signed zip: jarsigner signs META-INF/*.RSA,
# which keytool -printcert -jarfile reads. See docs/RELEASE-ACCEPTANCE-v1.0.md.
set -euo pipefail

aab="${1:-}"
expected="${2:-${EXPECTED_FINGERPRINT:-}}"

if [ -z "$aab" ] || [ ! -f "$aab" ]; then
  echo "usage: $0 <app.aab> [expected-sha1-or-sha256]  (or set EXPECTED_FINGERPRINT)" >&2
  exit 2
fi
if ! command -v keytool >/dev/null 2>&1; then
  echo "keytool not found: install a JDK (the one used for the Gradle build)." >&2
  exit 2
fi

out="$(keytool -printcert -jarfile "$aab" 2>&1)" || {
  echo "keytool could not read a signature from $aab (unsigned bundle?):" >&2
  echo "$out" >&2
  exit 1
}

# keytool prints "SHA1:" / "SHA256:" (older JDKs "SHA1:"; some "SHA-1:").
sha1="$(printf '%s\n' "$out" | sed -n 's/^[[:space:]]*SHA-\{0,1\}1:[[:space:]]*//p' | head -n1)"
sha256="$(printf '%s\n' "$out" | sed -n 's/^[[:space:]]*SHA-\{0,1\}256:[[:space:]]*//p' | head -n1)"
owner="$(printf '%s\n' "$out" | sed -n 's/^[[:space:]]*Owner:[[:space:]]*//p' | head -n1)"

echo "AAB:     $aab"
echo "Owner:   $owner"
echo "SHA-1:   $sha1"
echo "SHA-256: $sha256"

if [ -z "$sha1" ] || [ -z "$sha256" ]; then
  echo "FAIL: could not parse fingerprints from keytool output." >&2
  exit 1
fi

# Reject the Android debug certificate outright (debug-signing fallback).
if printf '%s' "$owner" | grep -qi 'CN=Android Debug'; then
  echo "FAIL: bundle is signed with the Android DEBUG certificate. Play rejects it; rebuild with the upload keystore." >&2
  exit 1
fi

if [ -z "$expected" ]; then
  echo "No expected fingerprint given: compare the values above with Play Console -> App integrity -> Upload key certificate."
  exit 0
fi

norm() { printf '%s' "$1" | tr -d ': \t\r\n' | tr '[:lower:]' '[:upper:]'; }
want="$(norm "$expected")"
if [ "$want" = "$(norm "$sha1")" ]; then
  echo "OK: matches the expected SHA-1."
elif [ "$want" = "$(norm "$sha256")" ]; then
  echo "OK: matches the expected SHA-256."
else
  echo "FAIL: fingerprint does not match the expected upload certificate." >&2
  echo "Expected: $expected" >&2
  exit 1
fi

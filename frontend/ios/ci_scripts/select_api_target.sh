#!/bin/sh
# Sourced by ci_post_clone.sh before installing build dependencies.
# Keep URL selection testable without running Homebrew, npm or CocoaPods.

PRELAUNCH_API_URL=https://dev-games-api.buffingchi.com
PRODUCTION_API_URL=https://games-api.buffingchi.com
case "${BC_API_TARGET:-}" in
  prelaunch) API_URL=$PRELAUNCH_API_URL ;;
  ""|production) API_URL=$PRODUCTION_API_URL ;;
  *)
    echo "error: BC_API_TARGET='$BC_API_TARGET' is not 'prelaunch' or 'production' — fix the Xcode Cloud workflow environment variable (docs/IOS.md)." >&2
    exit 1
    ;;
esac
# A dev/feature/PR build must never talk to the independently deployed main API.
# Prefer the PR source: its target can be main while the app is still dev code.
SOURCE_BRANCH="${CI_PULL_REQUEST_SOURCE_BRANCH:-${CI_BRANCH:-}}"
if [ -z "$SOURCE_BRANCH" ]; then
  case "${CI_GIT_REF:-}" in
    refs/heads/*) SOURCE_BRANCH=${CI_GIT_REF#refs/heads/} ;;
  esac
fi
if [ "$API_URL" = "$PRODUCTION_API_URL" ] && [ "$SOURCE_BRANCH" != "main" ]; then
  echo "error: production API requires a main-branch build; source is '${SOURCE_BRANCH:-unknown}'. For internal dev/PR builds, set BC_API_TARGET=prelaunch on the Xcode Cloud workflow. Promote dev to main before building for the App Store (docs/IOS.md)." >&2
  exit 1
fi
if [ "$API_URL" = "$PRODUCTION_API_URL" ]; then BUILD_KIND="STORE build"; else BUILD_KIND="PRE-LAUNCH build (never submit for App Store review)"; fi
echo "=== workflow '${CI_WORKFLOW:-unknown}', branch '${SOURCE_BRANCH:-unknown}': BC_API_TARGET='${BC_API_TARGET:-}' -> $API_URL — $BUILD_KIND ==="

# Expo CLI gives the process environment priority over .env, so an
# EXPO_PUBLIC_API_URL set on the workflow would silently replace the URL
# chosen above. Refuse it — BC_API_TARGET is the only switch.
if [ -n "${EXPO_PUBLIC_API_URL:-}" ] && [ "$EXPO_PUBLIC_API_URL" != "$API_URL" ]; then
  echo "error: EXPO_PUBLIC_API_URL='$EXPO_PUBLIC_API_URL' is set in the Xcode Cloud environment and would override $API_URL — remove it and use BC_API_TARGET (docs/IOS.md)." >&2
  exit 1
fi


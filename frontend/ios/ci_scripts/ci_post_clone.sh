#!/bin/sh
set -e

echo "=== Xcode Cloud: ci_post_clone.sh ==="

# Fail before expensive installs if the workflow targets an incompatible API.
. "$CI_PRIMARY_REPOSITORY_PATH/frontend/ios/ci_scripts/select_api_target.sh"

# Ensure Homebrew paths are available
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

# -------------------------------------------------------
# 1. Install Node.js (not pre-installed on Xcode Cloud)
#    Pin to Node 22 LTS — floating `node` formula tracks the latest
#    major and pulled in v26.0.0 on 2026-05-10 which caused npm to
#    crash with "Exit handler never called!" (Build 60, issue #1491).
# -------------------------------------------------------
brew install node@22
export PATH="/usr/local/opt/node@22/bin:$PATH"
echo "Node: $(node --version) at $(which node)"
echo "npm:  $(npm --version) at $(which npm)"

# -------------------------------------------------------
# 2. Tell Xcode build phases where to find node
# -------------------------------------------------------
NODE_BIN=$(which node)
cd "$CI_PRIMARY_REPOSITORY_PATH/frontend/ios"
echo "export NODE_BINARY=$NODE_BIN" > .xcode.env.local
cat .xcode.env.local

# Ensure login shells (bash -l) can find node
echo "export PATH=\"/usr/local/opt/node@22/bin:/usr/local/bin:/opt/homebrew/bin:\$PATH\"" >> "$HOME/.bash_profile"
echo "export PATH=\"/usr/local/opt/node@22/bin:/usr/local/bin:/opt/homebrew/bin:\$PATH\"" >> "$HOME/.zprofile"

# -------------------------------------------------------
# 3. Write environment variables for the JS bundle
#    The API URL decides whether this is a pre-launch or a store build
#    (isPreLaunchApiBuild() in src/game/_shared/envFlags.ts: hidden games,
#    debug panels, Sentry environment). The Xcode Cloud workflow's
#    BC_API_TARGET environment variable picks it (docs/IOS.md):
#      prelaunch      -> dev API (internal / TestFlight workflows only)
#      unset or empty -> production API (main-branch App Store workflows only)
#      production     -> production API (main branch only)
#      anything else  -> build fails (a typo must not pick a side)
#    select_api_target.sh validates the target before dependencies install.
#    Remove .env.production so Expo CLI does not load it and
#    override the URL below (APP_ENV=production is set in
#    Xcode Cloud, causing .env.production to win otherwise).
# -------------------------------------------------------
cd "$CI_PRIMARY_REPOSITORY_PATH/frontend"
rm -f .env.production
# The same override through a dotenv file Expo ranks above .env. Both are
# gitignored, so a fresh clone should never have them.
for dotenv in .env.local .env.production.local; do
  if [ -f "$dotenv" ] && grep -q -E "^[[:space:]]*(export[[:space:]]+)?EXPO_PUBLIC_API_URL[[:space:]]*=" "$dotenv"; then
    echo "error: frontend/$dotenv sets EXPO_PUBLIC_API_URL and would override $API_URL." >&2
    exit 1
  fi
done
printf 'EXPO_PUBLIC_API_URL=%s\n' "$API_URL" > .env
cat >> .env <<'DOTENV'
EXPO_PUBLIC_SENTRY_DSN=https://4e8b2bd816cbce3f73b0cd6923530d53@o4511129011093504.ingest.us.sentry.io/4511129020334080
DOTENV
echo "=== .env written (.env.production removed) ==="
cat .env

# Store-build guard (#2390). EXPO_PUBLIC_TEST_HOOKS=1 is inlined into the JS
# bundle and unhides the premium games that store builds must not show
# (frontend/src/entitlements/gameVisibility.ts). The .env above never sets it,
# but Expo CLI also reads the process environment and any other tracked .env*
# file, so refuse to build if it has leaked in from an Xcode Cloud workflow
# variable or a committed dotenv. Mirrors the Android release bundle guard.
if [ "${EXPO_PUBLIC_TEST_HOOKS:-}" = "1" ]; then
  echo "error: EXPO_PUBLIC_TEST_HOOKS=1 is set in the Xcode Cloud environment — remove the workflow environment variable." >&2
  exit 1
fi
# The dotenv files Expo CLI loads for a production bundle (.env.example is not
# one). Checked one at a time: grep exits 2 when any listed file is missing,
# even if another one matched.
for dotenv in .env .env.local .env.production .env.production.local; do
  if [ -f "$dotenv" ] && grep -q -E "^[[:space:]]*(export[[:space:]]+)?EXPO_PUBLIC_TEST_HOOKS[[:space:]]*=[[:space:]]*[\"']?1" "$dotenv"; then
    echo "error: EXPO_PUBLIC_TEST_HOOKS=1 is set in frontend/$dotenv — store builds must not enable test hooks." >&2
    exit 1
  fi
done
echo "=== test-hooks guard passed ==="

# -------------------------------------------------------
# 4. Install JavaScript dependencies (npm ci for lockfile integrity)
# -------------------------------------------------------
npm ci

# -------------------------------------------------------
# 5. Install CocoaPods (fresh install to fix paths)
#    The committed Pods have hardcoded local machine paths
#    (e.g. HERMES_CLI_PATH). Removing and reinstalling
#    regenerates xcconfigs with correct CI runner paths.
# -------------------------------------------------------
cd "$CI_PRIMARY_REPOSITORY_PATH/frontend/ios"
rm -rf Pods Podfile.lock
which pod || brew install cocoapods

# Disable FFmpeg download in react-native-audio-api (app.json disableFFmpeg:true).
# Without this, pod install tries to fetch large FFmpeg xcframeworks from GitHub
# which times out on Xcode Cloud runners (issue #1813).
export DISABLE_AUDIOAPI_FFMPEG=1

# Retry pod install up to 3 times — Xcode Cloud runners occasionally
# time out reaching cdn.cocoapods.org on the first attempt.
for attempt in 1 2 3; do
  echo "=== pod install attempt $attempt ==="
  if pod install; then
    break
  fi
  if [ "$attempt" -eq 3 ]; then
    echo "pod install failed after 3 attempts"
    exit 1
  fi
  echo "pod install failed, retrying in 10s..."
  sleep 10
done

# -------------------------------------------------------
# 6. Verify HERMES_CLI_PATH is correct
# -------------------------------------------------------
echo "=== Pre-build verification ==="
HERMES_PATH=$(grep HERMES_CLI_PATH "Pods/Target Support Files/Pods-GamingApp/Pods-GamingApp.release.xcconfig" || echo "NOT FOUND")
echo "HERMES_CLI_PATH: $HERMES_PATH"
echo "node_modules: $(test -d "$CI_PRIMARY_REPOSITORY_PATH/frontend/node_modules" && echo YES || echo NO)"

echo "=== ci_post_clone.sh complete ==="

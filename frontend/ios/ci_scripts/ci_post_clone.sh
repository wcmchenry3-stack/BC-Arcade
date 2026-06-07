#!/bin/sh
set -e

echo "=== Xcode Cloud: ci_post_clone.sh ==="

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
#    Remove .env.production so Expo CLI does not load it and
#    override the dev URL below (APP_ENV=production is set in
#    Xcode Cloud, causing .env.production to win otherwise).
# -------------------------------------------------------
cd "$CI_PRIMARY_REPOSITORY_PATH/frontend"
rm -f .env.production
cat > .env <<'DOTENV'
EXPO_PUBLIC_API_URL=https://dev-games-api.buffingchi.com
EXPO_PUBLIC_SENTRY_DSN=https://4e8b2bd816cbce3f73b0cd6923530d53@o4511129011093504.ingest.us.sentry.io/4511129020334080
DOTENV
echo "=== .env written (.env.production removed) ==="
cat .env

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

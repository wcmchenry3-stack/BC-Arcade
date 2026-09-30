const crypto = require("crypto");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// Allow Metro to bundle .wasm files (required for @dimforge/rapier2d-compat)
config.resolver.assetExts.push("wasm");

// Allow Metro to bundle .ogg audio files (Kenney sound packs)
config.resolver.assetExts.push("ogg");

// Expo inlines EXPO_PUBLIC_* values into modules at transform time, but Metro's
// transform cache key knows nothing about them. Without this, a bundle built
// after the value changed reuses the stale transform: a release bundle built
// right after an EXPO_PUBLIC_TEST_HOOKS=1 build kept its test hooks on — and
// with them the premium games that store builds hide (#2390). Folding the
// values into the cache version re-transforms only when one actually changes,
// on every platform and in CI.
const publicEnv = Object.keys(process.env)
  .filter((key) => key.startsWith("EXPO_PUBLIC_"))
  .sort()
  .map((key) => `${key}=${process.env[key]}`)
  .join("|");
config.cacheVersion = [
  config.cacheVersion ?? "",
  crypto.createHash("sha1").update(publicEnv).digest("hex"),
].join(":");

module.exports = config;

/**
 * The app's version (#3858), for data that says which build made it (Cascade's `game_started`).
 *
 * Read from the native app (`expo-constants` `nativeAppVersion`: iOS `CFBundleShortVersionString`,
 * Android `versionName`), the same version the stores show and Sentry's release carries, so it
 * cannot drift from what was shipped. On web, where there is no native app, it falls back to the
 * embedded app config's `version` (`app.json`), and to `"unknown"` when neither is there.
 * `expo-constants` ships with Expo (`expo` depends on it, and autolinking already builds it into
 * both apps); it is listed in `package.json` so the import is a declared dependency.
 */
import Constants from "expo-constants";

function readAppVersion(): string {
  try {
    return Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "unknown";
  } catch {
    return "unknown"; // isolation: a version is never worth breaking a game for
  }
}

export const APP_VERSION: string = readAppVersion();

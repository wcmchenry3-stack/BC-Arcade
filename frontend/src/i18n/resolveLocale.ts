import { areTestHooksEnabled, isPreLaunchApiBuild } from "../game/_shared/envFlags";
import { LAUNCH_LOCALE_CODES, LOCALES, NATIVE_LOCALES } from "./locales";

export interface DeviceLocale {
  languageTag: string;
  languageCode: string | null;
}

/**
 * Store builds offer only the launch locales (#3150); dev, e2e and pre-launch builds
 * keep every locale. Same build-time predicate as `SHOW_HIDDEN_GAMES` — see
 * `entitlements/gameVisibility.ts` for why this is not an env var or a server flag.
 */
export const SHOW_UNLAUNCHED_LOCALES: boolean =
  __DEV__ || areTestHooksEnabled() || isPreLaunchApiBuild();

/**
 * Locales offered on the given platform. Native has no RTL layout support, so ar/he are
 * excluded there (#2212); web keeps them via the DOM `dir` attribute. With `launchOnly`
 * (the store-build default) only `LAUNCH_LOCALE_CODES` are offered.
 */
export function availableLocales(os: string, launchOnly: boolean = !SHOW_UNLAUNCHED_LOCALES) {
  const platform = os === "web" ? LOCALES : NATIVE_LOCALES;
  return launchOnly ? platform.filter((l) => LAUNCH_LOCALE_CODES.has(l.code)) : platform;
}

/** Resolve the best supported locale from the device's preference list. */
export function resolveLocale(
  deviceLocales: readonly DeviceLocale[],
  os: string,
  launchOnly: boolean = !SHOW_UNLAUNCHED_LOCALES
): string {
  const available = availableLocales(os, launchOnly);
  const supported = new Set(available.map((l) => l.code));

  for (const { languageTag, languageCode } of deviceLocales) {
    if (supported.has(languageTag)) return languageTag;
    // Fall back to base language code (e.g. "fr" matches "fr-CA")
    const match = available.find((l) => l.code.split("-")[0] === languageCode);
    if (match) return match.code;
  }
  return "en";
}

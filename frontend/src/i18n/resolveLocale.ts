import { isStoreBuild } from "../entitlements/gameVisibility";
import { LAUNCH_LOCALE_CODES, LOCALES, NATIVE_LOCALES } from "./locales";

export interface DeviceLocale {
  languageTag: string;
  languageCode: string | null;
}

/**
 * Store builds on iOS/Android offer only `LAUNCH_LOCALE_CODES` (#3150). Web is not a
 * store platform (free games + testing) and keeps every locale, as do dev, e2e and
 * pre-launch builds. Uses the same `isStoreBuild()` gate as the hidden games.
 */
function launchOnlyDefault(os: string): boolean {
  return os !== "web" && isStoreBuild();
}

/**
 * Locales offered on the given platform. Native has no RTL layout support, so ar/he are
 * excluded there (#2212); web keeps them via the DOM `dir` attribute. With `launchOnly`
 * (the native store-build default) only `LAUNCH_LOCALE_CODES` are offered.
 */
export function availableLocales(os: string, launchOnly: boolean = launchOnlyDefault(os)) {
  const platform = os === "web" ? LOCALES : NATIVE_LOCALES;
  return launchOnly ? platform.filter((l) => LAUNCH_LOCALE_CODES.has(l.code)) : platform;
}

/** Resolve the best supported locale from the device's preference list. */
export function resolveLocale(
  deviceLocales: readonly DeviceLocale[],
  os: string,
  launchOnly: boolean = launchOnlyDefault(os)
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

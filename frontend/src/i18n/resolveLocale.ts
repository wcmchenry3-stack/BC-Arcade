import { isStoreBuild } from "../game/_shared/buildFlavour";
import { LAUNCH_LOCALE_CODES, LOCALES, NATIVE_LOCALES } from "./locales";

export interface DeviceLocale {
  languageTag: string;
  languageCode: string | null;
}

/**
 * Locales offered on the given platform. Native has no RTL layout support, so ar/he are
 * excluded there (#2212); web keeps them via the DOM `dir` attribute. Native store
 * builds offer only `LAUNCH_LOCALE_CODES` (#3150); web is not a store platform (free
 * games + testing) and, like dev, e2e and pre-launch builds, keeps every locale.
 */
export function availableLocales(os: string) {
  if (os === "web") return LOCALES;
  return isStoreBuild()
    ? NATIVE_LOCALES.filter((l) => LAUNCH_LOCALE_CODES.has(l.code))
    : NATIVE_LOCALES;
}

/** Resolve the best supported locale from the device's preference list. */
export function resolveLocale(deviceLocales: readonly DeviceLocale[], os: string): string {
  const available = availableLocales(os);
  const supported = new Set(available.map((l) => l.code));

  for (const { languageTag, languageCode } of deviceLocales) {
    if (supported.has(languageTag)) return languageTag;
    // Fall back to base language code (e.g. "fr" matches "fr-CA")
    const match = available.find((l) => l.code.split("-")[0] === languageCode);
    if (match) return match.code;
  }
  return "en";
}

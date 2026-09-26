import { LOCALES, NATIVE_LOCALES } from "./locales";

export interface DeviceLocale {
  languageTag: string;
  languageCode: string | null;
}

/**
 * Locales offered on the given platform. Native has no RTL layout support, so ar/he are
 * excluded there (#2212); web keeps them via the DOM `dir` attribute.
 */
export function availableLocales(os: string) {
  return os === "web" ? LOCALES : NATIVE_LOCALES;
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

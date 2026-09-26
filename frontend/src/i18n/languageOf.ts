import i18next, { type TFunction } from "i18next";

/**
 * The language `t` translates into, for formatting numbers and dates the way
 * the app's language writes them rather than the device's (#2638, #2754). A
 * `useTranslation` t is fixed to one (`lng`); any other t translates into
 * i18next's resolved language.
 */
export function languageOf(t: TFunction): string {
  const fixed = (t as unknown as { lng?: unknown }).lng;
  if (typeof fixed === "string" && fixed !== "cimode") return fixed;
  return i18next.resolvedLanguage ?? i18next.language ?? "en";
}

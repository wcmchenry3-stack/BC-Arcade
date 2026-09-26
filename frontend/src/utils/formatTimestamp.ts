/**
 * Timestamp display utilities — always use these, never toISOString() or
 * manual offset arithmetic. The device's local timezone is applied
 * automatically by the JS runtime when you pass a Date to toLocaleString /
 * toLocaleDateString.
 *
 * Pattern:
 *   const d = new Date(isoUtcString);   // parses ISO-8601 → local TZ
 *   return d.toLocaleString();           // renders in device local TZ
 */

import type { TFunction } from "i18next";
import { languageOf } from "../i18n/languageOf";

/**
 * Full date + time in the device's local timezone.
 * Returns "—" for null or an unparseable string.
 */
export function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};
const dateFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * Short date in the device's local timezone, written the way the app's
 * language writes it ("Jun 15, 2024" in English, "15. Juni 2024" in German),
 * like `formatNumber`. Not `toLocaleDateString(undefined)`: that follows the
 * device's language, which can differ from the one picked in the app (#2754).
 * Returns "" for null or an unparseable string.
 */
export function formatDate(t: TFunction, iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const lng = languageOf(t);
  let format = dateFormats.get(lng);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat(lng, DATE_OPTIONS);
    } catch {
      format = new Intl.DateTimeFormat("en", DATE_OPTIONS);
    }
    dateFormats.set(lng, format);
  }
  return format.format(d);
}

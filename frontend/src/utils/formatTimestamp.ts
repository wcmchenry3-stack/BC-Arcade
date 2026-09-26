/**
 * Timestamp display utilities — always use these, never toISOString() or
 * manual offset arithmetic. Intl.DateTimeFormat applies the device's local
 * timezone; the language is the app's (the one `t` translates into), not the
 * device's, like `formatNumber` (#2754).
 *
 * Pattern:
 *   formatDate(t, isoUtcString)   // parses ISO-8601, renders in device local TZ
 */

import type { TFunction } from "i18next";
import { languageOf } from "../i18n/languageOf";

/** An ISO-8601 string or epoch milliseconds. */
type Instant = string | number;

const TIMESTAMP_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
};
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};
const formats = new Map<string, Intl.DateTimeFormat>();

/** The date in the device's timezone, or null for a missing or unparseable value. */
function toDate(value: Instant | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A cached formatter for the app's language; English if Intl rejects that language. */
function formatIn(t: TFunction, kind: "timestamp" | "date"): Intl.DateTimeFormat {
  const lng = languageOf(t);
  const key = `${kind}|${lng}`;
  let format = formats.get(key);
  if (!format) {
    const options = kind === "date" ? DATE_OPTIONS : TIMESTAMP_OPTIONS;
    try {
      format = new Intl.DateTimeFormat(lng, options);
    } catch {
      format = new Intl.DateTimeFormat("en", options);
    }
    formats.set(key, format);
  }
  return format;
}

/**
 * Full date + time ("6/15/2024, 4:00:00 PM" in English, "15.6.2024, 16:00:00"
 * in German) in the device's local timezone and the app's language. Not
 * `toLocaleString()`: that follows the device's language.
 * Returns "—" for null or an unparseable value.
 */
export function formatTimestamp(t: TFunction, value: Instant | null): string {
  const d = toDate(value);
  return d ? formatIn(t, "timestamp").format(d) : "—";
}

/**
 * Short date ("Jun 15, 2024" in English, "15. Juni 2024" in German) in the
 * device's local timezone and the app's language. Not
 * `toLocaleDateString(undefined)`: that follows the device's language.
 * Returns "" for null or an unparseable value.
 */
export function formatDate(t: TFunction, value: Instant | null): string {
  const d = toDate(value);
  return d ? formatIn(t, "date").format(d) : "";
}

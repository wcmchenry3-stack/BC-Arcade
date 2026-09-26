/**
 * How one game's `/stats/me` figures are read and shown (#2637, #2635): the
 * Profile's tiles and per-game rows and the per-game stats screen share
 * these, so the two never disagree. Strings are in the "profile" namespace.
 */

import i18next, { type TFunction } from "i18next";
import type { GameTypeStats } from "./types";

// A missing comparable field shows "—" (or 0 sessions) rather than failing.

/** Finished games, abandons included. */
export const sessionsOf = (s: GameTypeStats): number => s.sessions ?? 0;

/** Finished games minus abandons; null when the response omits it. */
export const completedOf = (s: GameTypeStats): number | null => s.completed ?? null;

/** won / (won + lost + tied), or null when the game records no results for this player. */
export function winRateOf(s: GameTypeStats): number | null {
  if (s.won == null || s.lost == null || s.tied == null) return null;
  const decided = s.won + s.lost + s.tied;
  return decided > 0 ? s.won / decided : null;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/**
 * The language `t` translates into. A `useTranslation` t is fixed to one
 * (`lng`); any other t translates into i18next's resolved language.
 */
function languageOf(t: TFunction): string {
  const fixed = (t as unknown as { lng?: unknown }).lng;
  if (typeof fixed === "string" && fixed !== "cimode") return fixed;
  return i18next.resolvedLanguage ?? i18next.language ?? "en";
}

/**
 * A number grouped the way the app's language writes it ("1,450" in English,
 * "1.450" in German). Not `toLocaleString()`: that follows the device, whose
 * language can differ from the one picked in the app.
 */
export function formatNumber(t: TFunction, value: number): string {
  const lng = languageOf(t);
  let format = numberFormats.get(lng);
  if (!format) {
    try {
      format = new Intl.NumberFormat(lng);
    } catch {
      format = new Intl.NumberFormat("en");
    }
    numberFormats.set(lng, format);
  }
  return format.format(value);
}

/** A 0–1 ratio as a whole percentage, e.g. "67%". */
export function formatPercent(t: TFunction, ratio: number): string {
  return t("profile:stats.percent", { value: Math.round(ratio * 100) });
}

/** Reported play time as "3h 12m" or "45m". */
export function formatPlayTime(t: TFunction, ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0
    ? t("profile:time.hoursMinutes", { hours: formatNumber(t, hours), minutes })
    : t("profile:time.minutes", { minutes });
}

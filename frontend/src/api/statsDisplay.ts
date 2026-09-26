/**
 * How one game's `/stats/me` figures are read and shown (#2637, #2635): the
 * Profile's tiles and per-game rows and the per-game stats screen share
 * these, so the two never disagree. Strings are in the "profile" namespace
 * (#2638 consolidates them later).
 */

import type { TFunction } from "i18next";
import type { GameTypeStats } from "./types";

// A server from before #2620 omits the comparable fields. Its `played` is an
// honest session count, but it includes abandons, so it is no stand-in for
// `completed`: those figures show "—" instead.

/** Finished games, abandons included. */
export const sessionsOf = (s: GameTypeStats): number => s.sessions ?? s.played;

/** Finished games minus abandons; null from a server that predates #2620. */
export const completedOf = (s: GameTypeStats): number | null => s.completed ?? null;

/** won / (won + lost + tied), or null when the game records no results for this player. */
export function winRateOf(s: GameTypeStats): number | null {
  if (s.won == null || s.lost == null || s.tied == null) return null;
  const decided = s.won + s.lost + s.tied;
  return decided > 0 ? s.won / decided : null;
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
    ? t("profile:time.hoursMinutes", { hours: hours.toLocaleString(), minutes })
    : t("profile:time.minutes", { minutes });
}

/**
 * Local-day helpers for the Daily Challenge (#2924).
 *
 * Same offset-based day model as the backend (`daily_challenge/definitions.py`
 * `local_day`) and Daily Word: the device's current UTC offset is applied to UTC
 * to get the local calendar date. Not an IANA timezone, so it stays consistent
 * with #2478's model.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Minutes east of UTC for the device right now. */
export function tzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

/** `YYYY-MM-DD` of the local calendar day for `offsetMinutes` (default: the device's). */
export function localDayKey(offsetMinutes: number = tzOffsetMinutes(), nowMs = Date.now()): string {
  const localMs = nowMs + offsetMinutes * MINUTE_MS;
  const d = new Date(Math.floor(localMs / DAY_MS) * DAY_MS);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${dy}`;
}

/** Milliseconds until the next local midnight for `offsetMinutes`. */
export function msUntilLocalMidnight(
  offsetMinutes: number = tzOffsetMinutes(),
  nowMs = Date.now()
): number {
  const localMs = nowMs + offsetMinutes * MINUTE_MS;
  return Math.floor(localMs / DAY_MS) * DAY_MS + DAY_MS - localMs;
}

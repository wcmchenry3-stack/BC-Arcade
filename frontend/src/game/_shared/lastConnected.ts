import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * When the API last answered with a 2xx (#3226), so the daily games can tell
 * how long the device has been offline (#3043: puzzles are fetched ahead for
 * a few days, then the player is asked to reconnect). Local only; cleared by
 * Delete My Data.
 */

export const LAST_CONNECTED_KEY = "last_connected_at_v1";

/**
 * Days offline at which the puzzles fetched ahead run out. A connection on day
 * D fetches D, D+1 and D+2, so the first day with nothing left is D+3.
 */
export const OFFLINE_WINDOW_DAYS = 3;

// Every 2xx calls recordConnected: skip the write when a recent one stands.
const WRITE_THROTTLE_MS = 60_000;
let lastWrittenAt = 0;

/** Note a successful API response. Never throws and never needs awaiting. */
export async function recordConnected(now: number = Date.now()): Promise<void> {
  if (now >= lastWrittenAt && now - lastWrittenAt < WRITE_THROTTLE_MS) return;
  lastWrittenAt = now;
  try {
    await AsyncStorage.setItem(LAST_CONNECTED_KEY, String(now));
  } catch {
    // Best effort: the next 2xx tries again.
  }
}

/** Epoch ms of the last 2xx response, or null when there has been none. */
export async function getLastConnected(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_CONNECTED_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Forget it (Delete My Data; tests). */
export async function clearLastConnected(): Promise<void> {
  lastWrittenAt = 0;
  await AsyncStorage.removeItem(LAST_CONNECTED_KEY);
}

/**
 * Whole local calendar days from `from` to `to`, by the device's current time
 * zone: 23:59 to 00:01 is 1, morning to evening is 0. Counting calendar dates
 * (not 24 h spans) keeps DST changes from shifting a day, and a negative
 * result (clock set back) counts as 0.
 */
export function localDaysBetween(from: number, to: number): number {
  const dayOf = (ms: number) =>
    Math.floor((ms - new Date(ms).getTimezoneOffset() * 60_000) / 86_400_000);
  return Math.max(0, dayOf(to) - dayOf(from));
}

/** Local days since the last 2xx response, or null when there has been none. */
export async function daysOffline(now: number = Date.now()): Promise<number | null> {
  const last = await getLastConnected();
  return last === null ? null : localDaysBetween(last, now);
}

/**
 * True once the puzzles fetched ahead have run out: `OFFLINE_WINDOW_DAYS`
 * local days since the last connection. False when never connected (a fresh
 * install has no window to run out of).
 *
 * @internal No production caller until the offline daily screens land (#3228,
 * #3230); drop this tag then (knip --production, #3126).
 */
export async function offlineWindowExhausted(now: number = Date.now()): Promise<boolean> {
  const d = await daysOffline(now);
  return d !== null && d >= OFFLINE_WINDOW_DAYS;
}

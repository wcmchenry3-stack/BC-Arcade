import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The most recent streak the server reported (#3226), kept across launches so
 * Home still shows it offline instead of an empty value. Refreshed by every
 * `/stats/me` answer (`rememberMyStats`); cleared by Delete My Data.
 */

export const LAST_KNOWN_STREAK_KEY = "last_known_streak_v1";

export async function saveLastKnownStreak(days: number): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_KNOWN_STREAK_KEY, String(days));
  } catch {
    // Best effort: the next /stats/me tries again.
  }
}

/** The remembered streak, or null when there is none. */
export async function getLastKnownStreak(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_KNOWN_STREAK_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export async function clearLastKnownStreak(): Promise<void> {
  await AsyncStorage.removeItem(LAST_KNOWN_STREAK_KEY);
}

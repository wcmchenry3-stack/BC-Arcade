import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import type { DailyWordState } from "./types";

const STORAGE_KEY = "daily_word_state_v1";

// Callers must compare loaded state's puzzle_id against today's puzzle
// (via dailyWordApi.getToday) and call clearState() on a mismatch so a
// stale save from a previous day is never presented to the player.

// puzzle_id format: "YYYY-MM-DD:lang"
const PUZZLE_ID_RE = /^\d{4}-\d{2}-\d{2}:[a-z]{2}$/;

export function looksValid(v: unknown): v is DailyWordState {
  if (v === null || typeof v !== "object") return false;
  const s = v as Partial<DailyWordState>;
  if (s._v !== 1) return false;
  if (typeof s.puzzle_id !== "string" || !PUZZLE_ID_RE.test(s.puzzle_id)) return false;
  if (!Array.isArray(s.rows) || s.rows.length > 6) return false;
  return true;
}

export async function saveState(state: DailyWordState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "daily_word.storage", op: "save" } });
  }
}

export async function loadState(): Promise<DailyWordState | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!looksValid(parsed)) return null;
    return parsed;
  } catch (e) {
    Sentry.captureMessage("daily_word.storage: corrupt payload, discarding", {
      level: "warning",
      tags: { subsystem: "daily_word.storage", op: "load" },
      extra: { error: String(e), key: STORAGE_KEY },
    });
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    return null;
  }
}

export async function clearState(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "daily_word.storage", op: "clear" } });
  }
}

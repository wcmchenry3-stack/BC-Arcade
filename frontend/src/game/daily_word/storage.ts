import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import type { DailyWordState } from "./types";
import type { TodayResponse } from "./api";
import { createJsonSlot } from "../_shared/storageSlot";

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

export const {
  save: saveState,
  load: loadState,
  clear: clearState,
} = createJsonSlot<DailyWordState>({
  key: "daily_word_state_v1",
  subsystem: "daily_word.storage",
  isValid: looksValid,
  keepInvalid: true,
  corruptMessage: "daily_word.storage: corrupt payload, discarding",
});

const TODAY_META_KEY_PREFIX = "daily_word_today_";

export async function saveTodayMeta(dateKey: string, meta: TodayResponse): Promise<void> {
  try {
    await AsyncStorage.setItem(`${TODAY_META_KEY_PREFIX}${dateKey}`, JSON.stringify(meta));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "daily_word.storage", op: "saveTodayMeta" } });
  }
}

export async function loadTodayMeta(dateKey: string): Promise<TodayResponse | null> {
  try {
    const raw = await AsyncStorage.getItem(`${TODAY_META_KEY_PREFIX}${dateKey}`);
    if (!raw) return null;
    return JSON.parse(raw) as TodayResponse;
  } catch {
    return null;
  }
}

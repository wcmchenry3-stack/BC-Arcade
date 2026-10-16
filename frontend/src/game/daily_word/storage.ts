import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import type { DailyWordState } from "./types";
import type { TodayResponse } from "./api";
import { createJsonSlot } from "../_shared/storageSlot";

// Boards are saved per puzzle (#3230): the screen loads the board for today's
// puzzle id, and its restore handler prunes every other board (another day's
// or language's), not its load (#3127).

// puzzle_id format: "YYYY-MM-DD:lang" (Hindi) or "YYYY-MM-DD:lang:version" (English, #3155)
const PUZZLE_ID_RE = /^\d{4}-\d{2}-\d{2}:[a-z]{2}(:\d+)?$/;

export function looksValid(v: unknown): v is DailyWordState {
  if (v === null || typeof v !== "object") return false;
  const s = v as Partial<DailyWordState>;
  if (s._v !== 1) return false;
  if (typeof s.puzzle_id !== "string" || !PUZZLE_ID_RE.test(s.puzzle_id)) return false;
  if (!Array.isArray(s.rows) || s.rows.length > 6) return false;
  return true;
}

// One saved board per puzzle (#3230), so a board played offline on one day
// is not overwritten by the next day's. Same payload as the single slot
// before it.
const BOARD_KEY_PREFIX = "daily_word_board_";
const LEGACY_KEY = "daily_word_state_v1";

function boardSlot(key: string) {
  return createJsonSlot<DailyWordState>({
    key,
    subsystem: "daily_word.storage",
    isValid: looksValid,
    keepInvalid: true,
    corruptMessage: "daily_word.storage: corrupt payload, discarding",
  });
}

const boardKey = (puzzleId: string) => `${BOARD_KEY_PREFIX}${puzzleId}`;

/**
 * Move a board saved by a build before #3230 (`daily_word_state_v1`) to its
 * puzzle's own key, unless that key already holds one, and remove the old
 * slot. A payload that is not a board is left where it is, as before.
 */
async function migrateLegacyBoard(): Promise<void> {
  const legacy = boardSlot(LEGACY_KEY);
  const old = await legacy.load();
  if (!old) return;
  try {
    if ((await AsyncStorage.getItem(boardKey(old.puzzle_id))) === null) {
      await boardSlot(boardKey(old.puzzle_id)).save(old);
    }
  } catch {
    return; // Leave the old slot for the next load to try again.
  }
  await legacy.clear();
}

/** The saved board for `puzzleId`, or null. */
export async function loadState(puzzleId: string): Promise<DailyWordState | null> {
  await migrateLegacyBoard();
  const saved = await boardSlot(boardKey(puzzleId)).load();
  // A board stored under another puzzle's key is not this puzzle's.
  return saved && saved.puzzle_id === puzzleId ? saved : null;
}

/** Save `state` as its puzzle's board. */
export function saveState(state: DailyWordState): Promise<void> {
  return boardSlot(boardKey(state.puzzle_id)).save(state);
}

/** Remove the saved board for `puzzleId`. */
export function clearState(puzzleId: string): Promise<void> {
  return boardSlot(boardKey(puzzleId)).clear();
}

/**
 * Remove every saved board except `keepPuzzleId`'s: another day's, or
 * another language's (#3230). Only one puzzle is playable at a time, so the
 * rest are stale. Never rejects.
 */
export async function pruneStates(keepPuzzleId: string): Promise<void> {
  try {
    const keep = boardKey(keepPuzzleId);
    const stale = (await AsyncStorage.getAllKeys()).filter(
      (k) => k.startsWith(BOARD_KEY_PREFIX) && k !== keep
    );
    if (stale.length > 0) await AsyncStorage.removeMany(stale);
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "daily_word.storage", op: "prune" } });
  }
}

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

/**
 * Hearts replay units that wait for a game session, kept across a kill (#3283).
 *
 * Hand 1 is dealt and passed before the first card opens a game session, so its
 * `hand_opened` waits in memory; if the app is backgrounded and killed before
 * the first card, the restored game would have no record of its deal. The
 * waiting units are small (about 250 B) and written only when one is added with
 * no session open and read once on load: nothing on the play path.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { PendingPort, ReplayUnit } from "./replay";

const KEY = "hearts.replay_pending_v1";

/** Writes and clears the waiting units; a failure is ignored (the replay is best-effort). */
export const pendingReplayPort: PendingPort = {
  save(units) {
    AsyncStorage.setItem(KEY, JSON.stringify(units)).catch(() => {});
  },
  clear() {
    AsyncStorage.removeItem(KEY).catch(() => {});
  },
};

const isUnit = (u: unknown): u is ReplayUnit => {
  const unit = u as { n?: unknown; events?: unknown } | null;
  return (
    typeof unit?.n === "number" &&
    Array.isArray(unit.events) &&
    unit.events.every((e: { type?: unknown; data?: { h?: unknown } }) => {
      return (
        (e?.type === "hand_opened" || e?.type === "hand_played") &&
        typeof e.data === "object" &&
        e.data !== null &&
        typeof e.data.h === "number"
      );
    })
  );
};

/** The units a killed process left waiting; none when nothing valid is stored. */
export async function loadPendingReplay(): Promise<ReplayUnit[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isUnit) : [];
  } catch {
    return [];
  }
}

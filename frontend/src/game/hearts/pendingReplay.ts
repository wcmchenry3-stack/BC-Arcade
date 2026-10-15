/**
 * Hearts replay units that wait for a game session, kept across a kill (#3283).
 *
 * Hand 1 is dealt and passed before the first card opens a game session, so its
 * `hand_opened` waits in memory; if the app is backgrounded and killed before
 * the first card, the restored game would have no record of its deal. The
 * waiting units are small (about 250 B) and written only when one is added with
 * no session open (off the tap that causes it) and read once on load: nothing on the play path.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { InteractionManager } from "react-native";

import type { PendingPort, ReplayUnit } from "./replay";

const KEY = "hearts.replay_pending_v1";

// A write is put off to after the interactions (never inside the tap that causes
// it); `flush` does it at once, for the moment the app leaves the foreground.
let waiting: { units: readonly ReplayUnit[] } | "clear" | null = null;
let scheduled = false;

function write(): void {
  const job = waiting;
  waiting = null;
  if (job === null) return;
  const done =
    job === "clear"
      ? AsyncStorage.removeItem(KEY)
      : AsyncStorage.setItem(KEY, JSON.stringify(job.units));
  done.catch(() => {});
}

function later(): void {
  if (scheduled) return;
  scheduled = true;
  InteractionManager.runAfterInteractions(() => {
    scheduled = false;
    write();
  });
}

/** Writes and clears the waiting units; a failure is ignored (the replay is best-effort). */
export const pendingReplayPort: PendingPort = {
  save(units) {
    waiting = { units: [...units] };
    later();
  },
  clear() {
    waiting = "clear";
    later();
  },
  flush: write,
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

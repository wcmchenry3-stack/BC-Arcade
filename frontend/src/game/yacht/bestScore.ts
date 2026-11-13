/**
 * Yacht's solo personal best, kept on the device (#3749, owner: a local best).
 *
 * Only for the end of a solo game: a new best is a "win" for the end beat (and #3750's end
 * sound), anything else a "tie". Vs games don't record it. It is its own small record, next to
 * the game save (`storage.ts`) and independent of it, so saves from before it load unchanged and
 * #3757 can replace it with a shared best-score module later.
 *
 * Absent or unreadable, the best is 0 ("no best on record"): the first finished solo game sets it
 * and counts as a new best (owner).
 */
import { bestOf } from "../_shared/bestOf";
import { createRecord } from "../_shared/storageSlot";
import type { YachtEndOutcome } from "./motion";

/** The most a Yacht game can score (every row at its best, twelve Yacht bonuses). */
const MAX_YACHT_SCORE = 1575;

export const { save: saveBestScore, load: loadBestScore } = createRecord<number>({
  key: "yacht_best_score_v1",
  subsystem: "yacht.storage",
  ops: { load: "loadBest", save: "saveBest" },
  fallback: () => 0,
  // Anything that can't be a real score (not a number, negative, above the most a game can score)
  // is a corrupt record: no best.
  read: (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 && n <= MAX_YACHT_SCORE ? n : 0;
  },
  write: String,
});

/**
 * A finished solo game against the best before it (read when the game started, so this is
 * synchronous): its end-beat outcome, and the best to store if it changed (`null` if not).
 * The first game (no best on record) is a new best (owner, #3749).
 */
export function soloEndOutcome(
  priorBest: number,
  total: number
): { outcome: YachtEndOutcome; newBest: number | null } {
  const result = bestOf(priorBest, total, false);
  return result.improved && total > 0
    ? { outcome: "win", newBest: result.best }
    : { outcome: "tie", newBest: null };
}

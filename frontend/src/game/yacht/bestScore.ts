/**
 * Yacht's solo personal best (#3749, owner: a local best), kept in the shared personal best
 * (`game/_shared/personalBest.ts`, #3757; its old key `yacht_best_score_v1` is moved in there on
 * the first read).
 *
 * Only for the end of a solo game: a new best is a "win" for the end beat (and #3750's end
 * sound), anything else a "tie". Vs games don't record it.
 *
 * With no best on record, the first finished solo game sets it and counts as a new best (owner).
 */
import { judgeResult } from "../_shared/personalBest";
import type { YachtEndOutcome } from "./motion";

/**
 * A finished solo game against the best before it (read when the game started, so this is
 * synchronous): its end-beat outcome, and the best to store if it changed (`null` if not).
 * The first game (no best on record) is a new best (owner, #3749); a game of 0 never is.
 */
export function soloEndOutcome(
  priorBest: number,
  total: number
): { outcome: YachtEndOutcome; newBest: number | null } {
  const result = judgeResult("yacht", priorBest, total);
  return result.improved
    ? { outcome: "win", newBest: result.best }
    : { outcome: "tie", newBest: null };
}

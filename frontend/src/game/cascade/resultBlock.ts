/**
 * Cascade's result block (#2450, #2619, #3700): what `PATCH /games/{id}/complete`
 * sends as `result`, validated by the server's `CascadeResult`
 * (`backend/cascade/models.py`) and merged into `games.metadata`.
 *
 * - `merge_score`: the merge points (the engine's score).
 * - `max_tier`: the highest tier on the board this game (10 on a win).
 * - `won` / `outcome`: what the Daily Challenge goals read (#3703).
 * - `time_bonus` / `bonus_rule`: the app's copy, for display only; the server
 *   recomputes both from the completion's `outcome` and `duration_ms`.
 * - `final_score` = `merge_score + time_bonus`, the score the server stores.
 * - `duration_ms`, `theme`, `total_drops`, `total_merges`: as before #3700.
 *
 * About 100 bytes of JSON more per finished game than before #3700, on the
 * game's existing row; nothing is sent during play.
 */
import { CAPSTONE_TIER } from "./tiers";
import { BONUS_RULE, timeBonus } from "./timeBonus";

/** The game so far, as the screen tracks it. */
interface CascadeProgress {
  readonly mergeScore: number;
  readonly durationMs: number;
  readonly theme: string;
  readonly drops: number;
  readonly merges: number;
  readonly maxTier: number;
}

/** How a game ended; `null` while it is still being played (the abandon snapshot). */
type CascadeEnd = CascadeOutcome | null;

export interface CascadeResultBlock {
  readonly final_score: number;
  readonly merge_score: number;
  readonly time_bonus: number;
  readonly bonus_rule: number;
  readonly duration_ms: number;
  readonly theme: string;
  readonly total_drops: number;
  readonly total_merges: number;
  readonly max_tier: number;
  readonly won: boolean;
  readonly outcome?: "win" | "loss";
}

/** How a session closes: `useGameSync.complete`'s outcome. */
type CascadeOutcome = "win" | "loss" | "completed" | "abandoned";

/**
 * What `useGameSync.complete(summary, payload)` takes for a session closing as `outcome`. The
 * analytics payload is the block plus its outcome. An abandon's result is the same block as the
 * unmount snapshot; a completion's keeps `outcome`, as it always has. The score sent is the merge
 * score plus the time bonus; the server recomputes it (#3700).
 */
export function cascadeCompletion(block: CascadeResultBlock, outcome: CascadeOutcome) {
  const payload = { ...block, outcome };
  const result = outcome === "abandoned" ? block : payload;
  const summary = { finalScore: block.final_score, outcome, durationMs: block.duration_ms, result };
  return { summary, payload };
}

/** The result block for a game that ended `end` (or is still going, `null`). */
export function cascadeResultBlock(p: CascadeProgress, end: CascadeEnd): CascadeResultBlock {
  const bonus = timeBonus(end, p.durationMs);
  const block: CascadeResultBlock = {
    final_score: p.mergeScore + bonus,
    merge_score: p.mergeScore,
    time_bonus: bonus,
    bonus_rule: BONUS_RULE,
    duration_ms: p.durationMs,
    theme: p.theme,
    total_drops: p.drops,
    total_merges: p.merges,
    // A win made the capstone, whatever the screen saw (a restore, a test set-up).
    max_tier: end === "win" ? CAPSTONE_TIER : p.maxTier,
    won: end === "win",
  };
  return end === "win" || end === "loss" ? { ...block, outcome: end } : block;
}

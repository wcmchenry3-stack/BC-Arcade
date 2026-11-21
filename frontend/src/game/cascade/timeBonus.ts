/**
 * Cascade's time bonus for a win (#3700), for display only.
 *
 * The server is the source of truth (`backend/cascade/time_bonus.py`): it
 * recomputes the bonus from the completion's `outcome` and `duration_ms` and
 * ignores the one the app sends. This copy lets the result card show the score
 * the server will store; both are checked against
 * `backend/tests/fixtures/cascade_time_bonus.json`.
 *
 * `bonus = round(BONUS_MAX × max(0, 1 − t / PAR_TIME_MS))` for a win whose play
 * time `t` is at least `MIN_WIN_MS`; 0 for a loss, an abandon, a faster win or
 * one with no time. Owner decision 2026-11-16 (B = 20,000, T = 6 min, 20 s floor); B = 30,000
 * since #3967 (owner decision #3978, rule 2), for the 12-tier ladder's higher merge scores.
 */

/** `B`: the bonus of a win at t = 0 (the floor zeroes it in practice). */
export const BONUS_MAX = 30_000;
/** `T`: 6 minutes. A win at or after it earns no bonus. */
export const PAR_TIME_MS = 360_000;
/** The plausibility floor: a win under 20 s earns no bonus (it still counts). */
export const MIN_WIN_MS = 20_000;
/** The version of (B, T, floor); the server stores it as `bonus_rule`. */
export const BONUS_RULE = 2;

/**
 * The time bonus the server gives a game with this outcome and play time.
 *
 * `durationMs` is rounded to whole ms first, as the app sends it
 * (`resolveDurationMs`). Integer arithmetic rounding half up, as the server
 * does, so the two agree on every case: `floor((2n + d) / 2d)` for
 * `n / d = BONUS_MAX × remaining / PAR_TIME_MS` (every value stays an exact
 * integer well under 2^53).
 */
export function timeBonus(outcome: string | null, durationMs: number | null | undefined): number {
  if (outcome !== "win" || typeof durationMs !== "number" || !Number.isFinite(durationMs)) return 0;
  const t = Math.round(durationMs);
  if (t < MIN_WIN_MS) return 0;
  const remaining = Math.max(0, PAR_TIME_MS - t);
  return Math.floor((2 * BONUS_MAX * remaining + PAR_TIME_MS) / (2 * PAR_TIME_MS));
}

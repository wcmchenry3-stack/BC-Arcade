/**
 * Mahjong's clear-time floor (#2747), on its own so the shared personal best
 * (`game/_shared/personalBestGames.ts`, #3757) needn't import the engine.
 */

/**
 * Fastest clear that ranks, in ms (#2747): half a second per pair over 72
 * pairs. Mirrors `MIN_CLEAR_MS` in `backend/mahjong/models.py` (the board's
 * `min_value`); `backend/tests/test_board_definitions.py` keeps them equal.
 * A faster clear is a broken clock (e.g. an old save resumed with no time
 * banked), so it is never a device best either.
 */
export const MAHJONG_MIN_CLEAR_MS = 36000;

/**
 * A device best time, or 0 ("no best yet") when it is below the floor. The shared personal best
 * counts only these as Mahjong bests.
 */
export function plausibleBestMs(ms: number): number {
  return Number.isFinite(ms) && ms >= MAHJONG_MIN_CLEAR_MS ? ms : 0;
}

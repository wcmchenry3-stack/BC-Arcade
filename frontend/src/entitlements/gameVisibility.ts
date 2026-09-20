/**
 * Which games exist at all in this build (#2390).
 *
 * v1.0 ships to the stores with the six premium games hidden entirely — not
 * locked, not free. They come back when IAP lands (epic #822).
 *
 * This is deliberately a compiled constant and NOT:
 *  - a new `EXPO_PUBLIC_*` env var — `ios/ci_scripts/ci_post_clone.sh` deletes
 *    `.env.production` and force-writes a two-line `.env` on every Xcode Cloud
 *    build, so a new var would silently vanish and could ship the premium
 *    games to App Review by accident;
 *  - server-driven — the binary App Review approves must be the binary users
 *    get (guideline 2.3.1); a flag that unhides content post-review is itself
 *    a rejection pattern.
 *
 * Visibility is separate from entitlement: `PREMIUM_GAMES` / `canPlay` in
 * `EntitlementContext.tsx` still decide locked vs. playable wherever a hidden
 * game is shown (dev and test builds).
 */
import { areTestHooksEnabled } from "../game/_shared/envFlags";

export const HIDDEN_GAMES: ReadonlySet<string> = new Set([
  "yacht",
  "cascade",
  "hearts",
  "sudoku",
  "starswarm",
  "sort",
]);

/**
 * Dev builds and e2e test builds (`EXPO_PUBLIC_TEST_HOOKS=1`, already set by
 * the Maestro/Playwright build jobs) keep every game; store builds do not.
 */
export const SHOW_HIDDEN_GAMES: boolean = __DEV__ || areTestHooksEnabled();

export function isGameVisible(slug: string): boolean {
  return SHOW_HIDDEN_GAMES || !HIDDEN_GAMES.has(slug);
}

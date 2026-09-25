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
 * Until launch, internal TestFlight / Play test builds keep all twelve games,
 * free (owner decision, 2026-09-19). That is keyed off the API the build was
 * compiled against rather than a flag somebody has to remember to flip back:
 * a build pointed at the pre-launch API — whose backend grants every premium
 * game to every session — shows everything; a build pointed at anything else
 * is a store build. Building against the production API (on Xcode Cloud,
 * any workflow without `BC_API_TARGET=prelaunch`; docs/IOS.md) therefore
 * hides the games and ends the free entitlements in the same step. `EXPO_PUBLIC_API_URL` is safe from both
 * objections above: it is one of the two vars `ci_post_clone.sh` itself
 * writes, and it is inlined at build time, so the reviewed binary is the
 * shipped binary.
 *
 * Visibility is separate from entitlement: `PREMIUM_GAMES` / `canPlay` in
 * `EntitlementContext.tsx` still decide locked vs. playable wherever a hidden
 * game is shown (dev, test and pre-launch builds).
 */
import { areTestHooksEnabled, isPreLaunchApiBuild } from "../game/_shared/envFlags";

export const HIDDEN_GAMES: ReadonlySet<string> = new Set([
  "blackjack",
  "cascade",
  "hearts",
  "sudoku",
  "starswarm",
  "sort",
]);

/**
 * Dev builds, e2e test builds (`EXPO_PUBLIC_TEST_HOOKS=1`, already set by the
 * Maestro/Playwright build jobs) and pre-launch-API builds keep every game;
 * store builds do not.
 */
export const SHOW_HIDDEN_GAMES: boolean = __DEV__ || areTestHooksEnabled() || isPreLaunchApiBuild();

let forcedStoreBuild = false;

/**
 * Test seam: makes `isGameVisible` answer as a store build would, so suites can
 * exercise the real predicate under Jest's `__DEV__ === true`. Hide-only by
 * design — there is no way to force hidden games *visible*, so this can never
 * weaken a store build.
 */
export function __forceStoreBuildForTests(on: boolean): void {
  forcedStoreBuild = on;
}

export function isGameVisible(slug: string): boolean {
  const showHidden = SHOW_HIDDEN_GAMES && !forcedStoreBuild;
  return showHidden || !HIDDEN_GAMES.has(slug);
}

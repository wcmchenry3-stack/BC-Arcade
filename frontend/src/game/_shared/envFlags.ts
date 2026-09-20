/**
 * Build-time env flag checks with zero other imports.
 *
 * `testHooks.ts` re-exports `areTestHooksEnabled` from here for its existing
 * public API, but the pure game engines (`game/solitaire/engine.ts`,
 * `game/freecell/engine.ts`) import it directly from this module instead —
 * those engines are documented as side-effect-import-free (no React,
 * AsyncStorage, HTTP, timers, ...), and `testHooks.ts` itself pulls in
 * `eventStore`/`gameEventClient`/`syncWorker`, which are exactly that kind
 * of side-effect-heavy dependency. Keep this file free of any import beyond
 * `process.env` so every consumer can use it safely.
 */

export function areTestHooksEnabled(): boolean {
  return process.env.EXPO_PUBLIC_TEST_HOOKS === "1";
}

/**
 * The pre-launch (dev) API — the only backend that runs with
 * `ENTITLEMENT_DEV_OVERRIDE`, i.e. grants every premium game to every session.
 * Anchored on scheme + exact host so a lookalike
 * (`dev-games-api.buffingchi.com.example.org`) or plain http never matches.
 */
const PRE_LAUNCH_API = /^https:\/\/dev-games-api\.buffingchi\.com(?:[/:?#]|$)/;

/**
 * True only for a build compiled against the pre-launch API: internal
 * TestFlight / Play test builds. Fails closed — a production URL, an unknown
 * host, or no URL at all is a store build.
 */
export function isPreLaunchApiBuild(): boolean {
  return PRE_LAUNCH_API.test(process.env.EXPO_PUBLIC_API_URL ?? "");
}

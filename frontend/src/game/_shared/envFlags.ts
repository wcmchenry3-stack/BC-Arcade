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

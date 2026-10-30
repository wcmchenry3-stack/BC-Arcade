/**
 * Star Swarm — the run-level dev flag (#3510).
 *
 * `StarSwarmState.devAffected` is latched when any dev-panel action touches the run: the panel's
 * New Game (`DevOptions.devRun`) or anything that flags a wave `dev` (`markWaveDev`). The screen
 * reads it once, at game over, and sends it on the run's completion as `dev_affected: true`; the
 * server keeps the run but leaves it off the leaderboards and the `/stats` roll-ups, and raises a
 * Sentry warning when one reaches production. Store builds have no dev panel, so they never set
 * it. Nothing here runs in the frame loop.
 *
 * See docs/games/starswarm.md#dev-affected-runs-3510.
 */
import * as Sentry from "@sentry/react-native";
import type { StarSwarmState } from "./types";

/** The Sentry tag a run sets on the app's scope: `"true"` for a dev-affected run. */
export const DEV_AFFECTED_TAG = "starswarm.dev_affected";

/**
 * The completion result's dev field: `{ dev_affected: true }` for a run a dev-panel action
 * touched, else `{}` — a clean run sends nothing extra (the server reads a missing flag as
 * clean). Reads the state defensively: an I/O path never trusts its shape.
 */
export function devAffectedResult(
  state: Partial<Pick<StarSwarmState, "devAffected">> | null | undefined
): { readonly dev_affected?: true } {
  return state?.devAffected === true ? { dev_affected: true } : {};
}

/**
 * Tags the app's Sentry scope with whether the current run is dev-affected, so any event that
 * follows (a crash, a throttled report) shows it. One scope write per call, made at run start
 * (dev-tools builds) and at the game over of a flagged run only. Isolated: never throws.
 */
export function tagDevAffected(devAffected: boolean): void {
  try {
    Sentry.setTag(DEV_AFFECTED_TAG, devAffected ? "true" : "false");
  } catch {
    // a failing Sentry client must not break the run's lifecycle
  }
}

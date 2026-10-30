/**
 * Star Swarm — the run-level dev flag (#3510).
 *
 * `StarSwarmState.devAffected` is latched when any dev-panel action touches the run: the panel's
 * New Game (`DevOptions.devRun`), a dev-panel handler (`markDevAffected`), or anything that flags
 * a wave `dev` (`markWaveDev`). The screen sends it as `dev_affected: true` on the run's
 * completion or abandon, and the run's waves go out `dev: true` (`asSent`); the server keeps the
 * run but leaves it off the leaderboards and the `/stats` roll-ups, and raises a Sentry warning
 * when one reaches production. Store builds have no dev panel, so they never set it. Nothing here
 * runs in the frame loop.
 *
 * See docs/games/starswarm.md#dev-affected-runs-3510.
 */
import { setGameSessionTag } from "../_shared/sessionTags";
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
 * Tags the run's Sentry session with whether it is dev-affected, so any event that follows (a
 * crash, a throttled report) shows it. A per-session tag (`setGameSessionTag`): written only while
 * the run's session is tagged and reset to "none" with the `game.*` tags when the session ends, so
 * it never rides another game's events. One scope write per call, from the screen's run start,
 * restore and dev-panel handlers only. Isolated: never throws.
 */
export function tagDevAffected(devAffected: boolean): void {
  setGameSessionTag(DEV_AFFECTED_TAG, devAffected ? "true" : "false");
}

/**
 * A closed wave (or wave timeline) as it is sent: flagged `dev` when its run is dev-affected, so
 * per-wave analytics never count a dev run's waves, whatever the wave's own flag says. The item
 * itself when nothing changes (the caller copies it for the recorder); `dev: true` only shortens
 * the JSON, so the size caps still hold.
 */
export function asSent<T extends { readonly dev: boolean }>(item: T, runDevAffected: boolean): T {
  return runDevAffected && !item.dev ? { ...item, dev: true } : item;
}

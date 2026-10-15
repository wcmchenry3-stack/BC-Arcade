/**
 * Star Swarm — sending a run's closed waves as `wave_completed` game events (#3251, epic #3244).
 *
 * The engine collects every closed wave on `state.closedWaves`, in wire form
 * (engine/closedWaves.ts), and the paused-run save keeps them (saveShape.ts). Nothing goes out
 * during play: when the run ends — game over, ahead of `game_ended`, or abandoned for a new run,
 * ahead of the abandon — the screen records them all at once, in wave order, and the recorder
 * saves them in one call, so SyncWorker sends them with the run's other events in one batch. This
 * module holds the pure pieces:
 *
 *  - `devRevert` — the dev panel's infinite lives undoes a lost life (and the GameOver it
 *    caused) after `tick`. By then the engine has closed that wave as `died`; that entry, and
 *    the rest of the wave (its later `cleared` close), are flagged `dev`: sent, but filterable.
 *
 * The send itself is the shared recorder's (#3280): the screen records each closed wave through
 * `useGameRecorder("starswarm", { policy: "on_session_end" })`, which applies the caps from
 * eventQueueConfig.ts (`gameEventRegistry.starswarm`) and reports what they drop. `wave_completed`
 * is registered with `envelope: false`, so the payload goes out exactly as the engine built it.
 *
 * See docs/games/starswarm.md#sending-wave_completed.
 */
import { markWaveDev } from "./engine/waveStats";
import { wireBytes } from "./engine/closedWaves";
import type { StarSwarmState } from "./types";

/** The game event type the backend accepts for a closed wave (#3250). */
export const WAVE_COMPLETED_EVENT = "wave_completed";

/**
 * `reverted` is `next` with the canvas's infinite-lives revert applied. Flags the current wave
 * dev and, when `next`'s tick closed a wave (the `died` close the revert undoes), that entry too.
 */
export function devRevert(prev: StarSwarmState, reverted: StarSwarmState): StarSwarmState {
  let s = markWaveDev(reverted);
  const waves = s.closedWaves;
  const last = waves[waves.length - 1];
  if (waves.length > prev.closedWaves.length && last && !last.dev) {
    const flagged = { ...last, dev: true };
    s = {
      ...s,
      closedWaves: [...waves.slice(0, -1), flagged],
      // `dev: true` serializes shorter than `dev: false`; keep the running total exact
      closedWavesBytes: s.closedWavesBytes - wireBytes(last) + wireBytes(flagged),
    };
  }
  const closed = s.lastClosedWave;
  if (closed && closed !== prev.lastClosedWave && !closed.dev) {
    // the snapshot's sections are already frozen (closeWave); only the top level is new
    s = { ...s, lastClosedWave: Object.freeze({ ...closed, dev: true }) };
  }
  return s;
}

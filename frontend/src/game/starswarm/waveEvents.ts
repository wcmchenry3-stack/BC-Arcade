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
 * #3393: the run's kept wave timelines (`state.closedTimelines`, engine/waveTimeline.ts) go out
 * the same way, as `wave_timeline` events recorded after every `wave_completed`
 * (`timelinesInSendOrder`), in the same recorder session and the same single save.
 *
 * See docs/games/starswarm.md#sending-wave_completed.
 */
import { markWaveDev } from "./engine/waveStats";
import { NO_OVERFLOW, wireBytes } from "./engine/closedWaves";
import { NO_TIMELINE_OVERFLOW, revertTimeline, type WaveTimelineWire } from "./engine/waveTimeline";
import type { StarSwarmState } from "./types";

/** The game event type the backend accepts for a closed wave (#3250). */
export const WAVE_COMPLETED_EVENT = "wave_completed";

/** #3393: the game event type of a kept wave timeline (docs/games/starswarm-diagnostics.md). */
export const WAVE_TIMELINE_EVENT = "wave_timeline";

/**
 * #3393: the run's kept timelines in the order they are recorded, after every `wave_completed`:
 * the `died` timeline of the highest wave first (the run's last death; only a dev run has more
 * than one), then the others oldest first. A cap that bites cuts from the end, so it drops
 * cleared-wave timelines before the death's. A fresh array; the timelines are not copied.
 */
export function timelinesInSendOrder(
  kept: readonly WaveTimelineWire[]
): readonly WaveTimelineWire[] {
  let death = -1;
  for (let i = 0; i < kept.length; i++) {
    const tl = kept[i]!;
    if (tl.outcome === "died" && (death < 0 || tl.wave > kept[death]!.wave)) death = i;
  }
  if (death < 0) return kept.slice();
  return [kept[death]!, ...kept.slice(0, death), ...kept.slice(death + 1)];
}

/**
 * The extras of the throttled `starswarm.waveStats.engineDrop` report — counts and sizes only —
 * or null when nothing was lost to a cap. #3251: waves the engine never kept. #3393: timelines
 * refused by the run budget or the per-event cap (`waves`, or the list closed: `full`). Clean
 * waves, dev repeats and unrecorded waves ride along but never fire it alone: that is the
 * policy working, not a loss. Reads the state defensively: an I/O path never trusts its shape.
 */
export function engineDropCounts(
  state: Partial<Pick<StarSwarmState, "closedWavesOverflow" | "closedTimelinesOverflow">>
): Record<string, number> | null {
  const over = state.closedWavesOverflow ?? NO_OVERFLOW;
  const tl = state.closedTimelinesOverflow ?? NO_TIMELINE_OVERFLOW;
  // `full` alone matters only for a hand-edited or restored overflow: the engine sets it only
  // when it refuses a timeline, which always bumps `waves` too
  if (over.waves <= 0 && tl.waves <= 0 && !tl.full) return null;
  return {
    engine_dropped: over.waves,
    engine_dropped_bytes: over.bytes,
    timeline_dropped: tl.waves,
    timeline_bytes: tl.bytes,
    timeline_clean: tl.clean,
    timeline_dev_repeats: tl.devRepeats,
    timeline_unrecorded: tl.unrecorded,
  };
}

/**
 * `reverted` is `next` with the canvas's infinite-lives revert applied. Flags the current wave
 * dev and, when `next`'s tick closed a wave (the `died` close the revert undoes), that entry too.
 * #3392: the wave timeline likewise — the trailing `RUN_LOST` leaves the live buffer, so the wave
 * carries on with its terminal slot free, and the timeline kept this tick (the `died` one, or a
 * `cleared` one on the tick the extraction completed) is flagged dev.
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
  return revertTimeline(prev, s);
}

/**
 * Star Swarm — sending a run's closed waves as `wave_completed` game events (#3251, epic #3244).
 *
 * The engine collects every closed wave on `state.closedWaves`, in wire form
 * (engine/closedWaves.ts), and the paused-run save keeps them (saveShape.ts). Nothing goes out
 * during play: when the run ends — game over, ahead of `game_ended`, or abandoned for a new run,
 * ahead of the abandon — the screen queues them all at once, in wave order, so SyncWorker sends
 * them with the run's other events in one batch. This module holds the pure pieces:
 *
 *  - `devRevert` — the dev panel's infinite lives undoes a lost life (and the GameOver it
 *    caused) after `tick`. By then the engine has closed that wave as `died`; that entry, and
 *    the rest of the wave (its later `cleared` close), are flagged `dev`: sent, but filterable.
 *  - `planWaveEvents` — which waves fit the caps: none over `WAVE_STATS_MAX_BYTES` (the backend
 *    drops those), and the run's total within `WAVE_STATS_RUN_MAX_BYTES`, sent oldest first.
 *    What doesn't fit (here, or already in the engine's overflow count) is reported, by counts
 *    and sizes only.
 *
 * See docs/games/starswarm.md#sending-wave_completed.
 */
import { markWaveDev, type WaveStatsWire } from "./engine/waveStats";
import { NO_OVERFLOW, wireBytes, type ClosedWavesOverflow } from "./engine/closedWaves";
import {
  WAVE_STATS_MAX_BYTES,
  WAVE_STATS_RUN_MAX_BYTES,
  logConfig,
} from "../_shared/eventQueueConfig";
import type { EnqueueEventInput } from "../_shared/gameEventClient";
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

/** What a dropped wave report carries: counts and sizes, nothing that identifies the run. */
export interface WaveDropReport {
  readonly collected: number;
  readonly sent: number;
  readonly dropped: number;
  /** Bytes of every collected wave together. */
  readonly totalBytes: number;
  readonly sentBytes: number;
  readonly largestWaveBytes: number;
}

export interface WaveEventPlan {
  /** The events to queue, in wave order. */
  readonly events: readonly EnqueueEventInput[];
  /** Set when any wave was left out. */
  readonly report: WaveDropReport | null;
}

/**
 * The `wave_completed` events for a run's closed waves, within the per-wave and run caps. The
 * engine already keeps the list within them (engine/closedWaves.ts) and counts what it left off
 * in `overflow`; this applies the caps again (with the event queue's own per-row cap too) and
 * reports both together.
 */
export function planWaveEvents(
  waves: readonly WaveStatsWire[],
  overflow: ClosedWavesOverflow = NO_OVERFLOW
): WaveEventPlan {
  const waveCap = Math.min(WAVE_STATS_MAX_BYTES, logConfig.MAX_EVENT_PAYLOAD_BYTES);
  const events: EnqueueEventInput[] = [];
  let sentBytes = 0;
  let totalBytes = overflow.bytes;
  let largestWaveBytes = overflow.largestBytes;
  let full = false;
  for (const wave of waves) {
    const bytes = wireBytes(wave);
    totalBytes += bytes;
    largestWaveBytes = Math.max(largestWaveBytes, bytes);
    if (full || bytes > waveCap) continue;
    // in order until the next one would go over: no later, smaller wave fills the gap
    if (sentBytes + bytes > WAVE_STATS_RUN_MAX_BYTES) {
      full = true;
      continue;
    }
    sentBytes += bytes;
    events.push({ type: WAVE_COMPLETED_EVENT, data: wave as unknown as Record<string, unknown> });
  }
  const collected = waves.length + overflow.waves;
  const dropped = collected - events.length;
  const report =
    dropped === 0
      ? null
      : {
          collected,
          sent: events.length,
          dropped,
          totalBytes,
          sentBytes,
          largestWaveBytes,
        };
  return { events, report };
}

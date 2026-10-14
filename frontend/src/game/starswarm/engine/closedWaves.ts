/**
 * Star Swarm engine — the run's list of closed waves (#3251, epic #3244).
 *
 * Each wave close (engine/wave.ts) adds the snapshot's wire form (`toWirePayload`) to
 * `state.closedWaves`; the screen sends the list as `wave_completed` events when the run ends.
 * The list is bounded the way the send is (waveEvents.ts `planWaveEvents`): a wave over
 * `WAVE_STATS_MAX_BYTES` is never kept, and once a wave would take the kept waves past
 * `WAVE_STATS_RUN_MAX_BYTES` neither it nor any later wave is. What isn't kept is counted, by
 * count and size only, in `state.closedWavesOverflow`, so the send's report still says how many
 * waves were left out — and memory and the paused-run save stay bounded however long the run.
 */
import type { StarSwarmState } from "../types";
import { WAVE_STATS_MAX_BYTES, toWirePayload, type WaveStatsSnapshot } from "./waveStats";

/** The most a run's `wave_completed` payloads add up to (the sum of their JSON lengths). */
export const WAVE_STATS_RUN_MAX_BYTES = 64 * 1024;

/** The closed waves left off `closedWaves`, by count and size only. */
export interface ClosedWavesOverflow {
  readonly waves: number;
  readonly bytes: number;
  readonly largestBytes: number;
  /** A wave hit the run cap: the list is closed, no later wave is kept. */
  readonly full: boolean;
}

export const NO_OVERFLOW: ClosedWavesOverflow = {
  waves: 0,
  bytes: 0,
  largestBytes: 0,
  full: false,
};

/** One wave's serialized size (the wire payload is ASCII, so characters are bytes). */
export function wireBytes(wave: unknown): number {
  return JSON.stringify(wave).length;
}

/** The serialized size of a list of waves (what `state.closedWavesBytes` holds for its list). */
export function wavesBytes(waves: readonly unknown[]): number {
  let total = 0;
  for (const w of waves) total += wireBytes(w);
  return total;
}

/** `state` with `snap` added to its closed waves, or counted as overflow when it doesn't fit. */
export function collectClosedWave(state: StarSwarmState, snap: WaveStatsSnapshot): StarSwarmState {
  const wire = toWirePayload(snap);
  const bytes = wireBytes(wire);
  const over = state.closedWavesOverflow;
  const oversize = bytes > WAVE_STATS_MAX_BYTES;
  // the running total: only the new wave is serialized on each close
  const kept = state.closedWavesBytes;
  const full = over.full || (!oversize && kept + bytes > WAVE_STATS_RUN_MAX_BYTES);
  if (!oversize && !full) {
    return { ...state, closedWaves: [...state.closedWaves, wire], closedWavesBytes: kept + bytes };
  }
  return {
    ...state,
    closedWavesOverflow: {
      waves: over.waves + 1,
      bytes: over.bytes + bytes,
      largestBytes: Math.max(over.largestBytes, bytes),
      full,
    },
  };
}

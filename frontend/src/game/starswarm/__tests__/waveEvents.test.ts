/**
 * #3251: the pure pieces of sending a run's closed waves as `wave_completed` events — the dev
 * flag the canvas's infinite-lives revert sets, and the per-wave and per-run payload caps.
 */
import {
  CANVAS_H,
  CANVAS_W,
  WAVE_STATS_MAX_BYTES,
  closeWave,
  initStarSwarm,
  toWirePayload,
} from "../engine";
import type { WaveStatsSnapshot, WaveStatsWire } from "../engine";
import {
  WAVE_COMPLETED_EVENT,
  WAVE_STATS_RUN_MAX_BYTES,
  devRevert,
  planWaveEvents,
} from "../waveEvents";
import type { StarSwarmState } from "../types";
import { killShip, untilPlaying } from "./helpers/engineFixtures";

function run(wave = 1): StarSwarmState {
  return initStarSwarm(CANVAS_W, CANVAS_H, wave, 42, "Commander");
}

/** Every number in `snap`'s sections set to `n`: a dense wave with every key present. */
function dense(snap: WaveStatsSnapshot, n: number): WaveStatsWire {
  const fill = (v: unknown): unknown => {
    if (v === null || typeof v === "number") return n;
    if (typeof v !== "object") return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
  };
  return toWirePayload({
    ...snap,
    powerUps: fill(snap.powerUps),
    rocks: fill(snap.rocks),
    buddy: fill(snap.buddy),
    carrier: fill(snap.carrier),
    combat: fill(snap.combat),
    damage: { ...(fill(snap.damage) as object), deathCause: "beam" },
  } as WaveStatsSnapshot);
}

const bytesOf = (w: WaveStatsWire) => JSON.stringify(w).length;
/** Wave `wave` of a run, its sections dense at `n`. */
const wave = (n: number, w: number): WaveStatsWire => ({
  ...dense(closeWave(run(), "cleared"), n),
  wave: w,
});

describe("devRevert (the dev panel's infinite lives)", () => {
  it("flags the wave dev, so its later cleared close is dev too", () => {
    const prev = { ...run(), phase: "Playing" } as StarSwarmState;
    const reverted = devRevert(prev, prev);
    expect(reverted.waveStats.dev).toBe(true);
    expect(closeWave(reverted, "cleared").dev).toBe(true);
  });

  it("flags the died close the revert undoes, in closedWaves and lastClosedWave", () => {
    const prev = untilPlaying(run());
    const over = killShip(prev);
    expect(over.closedWaves.at(-1)).toMatchObject({ wave: 1, outcome: "died", dev: false });
    // what the canvas does: the GameOver and the lost life undone
    const reverted = devRevert(prev, {
      ...over,
      phase: prev.phase,
      player: { ...over.player, lives: prev.player.lives },
    });
    expect(reverted.closedWaves).toHaveLength(1);
    expect(reverted.closedWaves[0]).toMatchObject({ wave: 1, outcome: "died", dev: true });
    expect(reverted.lastClosedWave).toMatchObject({ wave: 1, outcome: "died", dev: true });
    expect(Object.isFrozen(reverted.lastClosedWave)).toBe(true);
    // the engine's own values are never mutated
    expect(over.closedWaves[0]!.dev).toBe(false);
    expect(over.lastClosedWave!.dev).toBe(false);
  });

  it("leaves waves closed on an earlier tick alone", () => {
    const earlier = closeWave(run(), "cleared");
    const prev = {
      ...run(2),
      lastClosedWave: earlier,
      closedWaves: [toWirePayload(earlier)],
    } as StarSwarmState;
    const reverted = devRevert(prev, prev);
    expect(reverted.lastClosedWave).toBe(earlier);
    expect(reverted.closedWaves[0]).toBe(prev.closedWaves[0]);
  });
});

describe("planWaveEvents (payload caps)", () => {
  it("under the caps, sends every wave in order and reports nothing", () => {
    const waves = [wave(5, 1), wave(5, 2), wave(5, 3)];
    expect(planWaveEvents(waves)).toEqual({
      events: waves.map((data) => ({ type: WAVE_COMPLETED_EVENT, data })),
      report: null,
    });
    expect(WAVE_COMPLETED_EVENT).toBe("wave_completed");
    expect(planWaveEvents([])).toEqual({ events: [], report: null });
  });

  it("a worst-case dense wave at real-play magnitudes fits the per-wave cap", () => {
    const worst = wave(99_999, 999);
    expect(bytesOf(worst)).toBeLessThanOrEqual(WAVE_STATS_MAX_BYTES);
    expect(planWaveEvents([worst]).report).toBeNull();
  });

  it("over the run's cap, sends the earliest waves that fit and drops the rest, in one report", () => {
    // waves 101.. all serialize to the same size (a 3-digit wave number)
    const one = bytesOf(wave(99_999, 101));
    const fit = Math.floor(WAVE_STATS_RUN_MAX_BYTES / one);
    const waves = Array.from({ length: fit + 3 }, (_, i) => wave(99_999, i + 101));
    const { events, report } = planWaveEvents(waves);
    expect(events.map((e) => (e.data as { wave: number }).wave)).toEqual(
      waves.slice(0, fit).map((w) => w.wave)
    );
    expect(report).toEqual({
      collected: fit + 3,
      sent: fit,
      dropped: 3,
      totalBytes: one * (fit + 3),
      sentBytes: one * fit,
      largestWaveBytes: one,
    });
    expect(report!.sentBytes).toBeLessThanOrEqual(WAVE_STATS_RUN_MAX_BYTES);
  });

  it("once a wave doesn't fit the run's cap, no later (smaller) wave is sent", () => {
    const big = bytesOf(wave(99_999, 101));
    const fit = Math.floor(WAVE_STATS_RUN_MAX_BYTES / big);
    const waves = [
      ...Array.from({ length: fit }, (_, i) => wave(99_999, i + 101)),
      wave(99_999, fit + 101),
      wave(0, fit + 102),
    ];
    const { events, report } = planWaveEvents(waves);
    expect(events).toHaveLength(fit);
    expect(report).toMatchObject({ sent: fit, dropped: 2 });
  });

  it("never sends a wave over the per-wave cap, and reports it", () => {
    const huge = wave(Number.MAX_SAFE_INTEGER, 2);
    const hugeBytes = bytesOf(huge);
    expect(hugeBytes).toBeGreaterThan(WAVE_STATS_MAX_BYTES);
    const waves = [wave(5, 1), huge, wave(5, 3)];
    const { events, report } = planWaveEvents(waves);
    expect(events.map((e) => (e.data as { wave: number }).wave)).toEqual([1, 3]);
    expect(report).toEqual({
      collected: 3,
      sent: 2,
      dropped: 1,
      totalBytes: bytesOf(waves[0]!) + hugeBytes + bytesOf(waves[2]!),
      sentBytes: bytesOf(waves[0]!) + bytesOf(waves[2]!),
      largestWaveBytes: hugeBytes,
    });
  });
});

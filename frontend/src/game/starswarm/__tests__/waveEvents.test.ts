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
import { WAVE_COMPLETED_EVENT, devRevert } from "../waveEvents";
import { GameRecorder, type RecordingDropReport } from "../../_shared/gameRecorder";
import type { EnqueueEventInput } from "../../_shared/gameEventClient";
import { WAVE_STATS_RUN_MAX_BYTES, wavesBytes } from "../engine/closedWaves";
import type { StarSwarmState } from "../types";
import { RECORDER_MAX_RAW_EVENTS } from "../../_shared/eventQueueConfig";
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

  it("keeps closedWavesBytes equal to the list's serialized size after flagging", () => {
    const prev = untilPlaying(run());
    const over = killShip(prev);
    expect(over.closedWavesBytes).toBe(wavesBytes(over.closedWaves));
    const reverted = devRevert(prev, {
      ...over,
      phase: prev.phase,
      player: { ...over.player, lives: prev.player.lives },
    });
    // `dev: true` is one byte shorter than `dev: false`
    expect(reverted.closedWavesBytes).toBe(wavesBytes(reverted.closedWaves));
    expect(reverted.closedWavesBytes).toBe(over.closedWavesBytes - 1);
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

/**
 * What the screen does at the run's end (#3280): every closed wave through the shared recorder
 * (`on_session_end`, the registry's `wave_completed` caps), then the session ends.
 */
function sendThroughRecorder(waves: readonly WaveStatsWire[]) {
  const saves: EnqueueEventInput[][] = [];
  const reports: RecordingDropReport[] = [];
  const recorder = new GameRecorder({
    gameType: "starswarm",
    policy: "on_session_end",
    sink: {
      canAccept: () => true,
      enqueueMany: (events) => {
        saves.push([...events]);
        return true;
      },
    },
    schedule: () => undefined, // measuring waits for endSession: nothing runs during "play"
    report: (r) => reports.push(r),
  });
  for (const w of waves) recorder.record(WAVE_COMPLETED_EVENT, { ...w });
  expect(saves).toEqual([]); // held until the session ends
  recorder.endSession();
  return { events: saves.flat(), saves, report: reports[0] ?? null };
}

describe("wave_completed through the recorder (payload caps)", () => {
  it("under the caps, sends every wave in order, as is, in one save, and reports nothing", () => {
    const waves = [wave(5, 1), wave(5, 2), wave(5, 3)];
    const sent = sendThroughRecorder(waves);
    expect(sent.events).toEqual(waves.map((data) => ({ type: WAVE_COMPLETED_EVENT, data })));
    expect(sent.saves).toHaveLength(1);
    expect(sent.report).toBeNull();
    expect(WAVE_COMPLETED_EVENT).toBe("wave_completed");
    expect(sendThroughRecorder([])).toMatchObject({ events: [], report: null });
  });

  it("a worst-case dense wave at real-play magnitudes fits the per-wave cap", () => {
    const worst = wave(99_999, 999);
    expect(bytesOf(worst)).toBeLessThanOrEqual(WAVE_STATS_MAX_BYTES);
    const sent = sendThroughRecorder([worst]);
    expect(sent.events).toHaveLength(1);
    expect(sent.report).toBeNull();
  });

  it("a wave right at the per-wave cap is still sent, as is (no envelope bytes added)", () => {
    const withPad = (n: number): WaveStatsWire => {
      const base = wave(5, 1);
      return {
        ...base,
        score: { ...base.score, pts: { ...base.score.pts, [`p${"x".repeat(n)}`]: 1 } },
      };
    };
    // the padded key's length moves the size one for one: land on the cap exactly
    const padded = withPad(WAVE_STATS_MAX_BYTES - bytesOf(withPad(0)));
    expect(bytesOf(padded)).toBe(WAVE_STATS_MAX_BYTES);
    const sent = sendThroughRecorder([padded]);
    expect(sent.events).toHaveLength(1);
    expect(sent.report).toBeNull();
  });

  it("over the run's cap, sends the earliest waves that fit and drops the rest, in one report", () => {
    // waves 101.. all serialize to the same size (a 3-digit wave number)
    const one = bytesOf(wave(99_999, 101));
    const fit = Math.floor(WAVE_STATS_RUN_MAX_BYTES / one);
    const waves = Array.from({ length: fit + 3 }, (_, i) => wave(99_999, i + 101));
    const { events, report } = sendThroughRecorder(waves);
    expect(events.map((e) => (e.data as { wave: number }).wave)).toEqual(
      waves.slice(0, fit).map((w) => w.wave)
    );
    expect(report).toMatchObject({
      recorded: fit + 3,
      saved: fit,
      dropped_session_cap: 3,
      saved_bytes: one * fit,
      largest_bytes: one,
    });
    expect(report!.saved_bytes).toBeLessThanOrEqual(WAVE_STATS_RUN_MAX_BYTES);
  });

  it("once a wave doesn't fit the run's cap, no later (smaller) wave is sent", () => {
    const big = bytesOf(wave(99_999, 101));
    const fit = Math.floor(WAVE_STATS_RUN_MAX_BYTES / big);
    const waves = [
      ...Array.from({ length: fit }, (_, i) => wave(99_999, i + 101)),
      wave(99_999, fit + 101),
      wave(0, fit + 102),
    ];
    const { events, report } = sendThroughRecorder(waves);
    expect(events).toHaveLength(fit);
    expect(report).toMatchObject({ saved: fit, dropped_session_cap: 2 });
  });

  it("never sends a wave over the per-wave cap, and reports it", () => {
    const huge = wave(Number.MAX_SAFE_INTEGER, 2);
    const hugeBytes = bytesOf(huge);
    expect(hugeBytes).toBeGreaterThan(WAVE_STATS_MAX_BYTES);
    const waves = [wave(5, 1), huge, wave(5, 3)];
    const { events, report } = sendThroughRecorder(waves);
    expect(events.map((e) => (e.data as { wave: number }).wave)).toEqual([1, 3]);
    expect(report).toMatchObject({
      recorded: 3,
      saved: 2,
      dropped_oversize: 1,
      saved_bytes: bytesOf(waves[0]!) + bytesOf(waves[2]!),
      largest_bytes: hugeBytes,
    });
  });

  it("a run's waves fit the recorder's in-memory hold (even the smallest real wave)", () => {
    // all of a run's waves are recorded at once at its end: the unmeasured-event hold must not
    // be reachable inside the run cap
    const smallest = bytesOf(toWirePayload(closeWave(run(), "cleared")));
    expect(Math.floor(WAVE_STATS_RUN_MAX_BYTES / smallest)).toBeLessThanOrEqual(
      RECORDER_MAX_RAW_EVENTS
    );
  });
});

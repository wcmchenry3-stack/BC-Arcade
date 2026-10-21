/**
 * #3396: measured sizes of the wave timeline (docs/games/starswarm-diagnostics.md, "Budget
 * arithmetic", and docs/DATA-INVENTORY.md §2a).
 *
 * Sources: the seed-42 golden replays with the timeline on, a seeded run from wave 1 at every
 * difficulty (6 lives, the golden pilot, played until the run ends), a prolonged 32-wave run
 * (200 lives: each wave flown for 300 combat ticks, then cleared) and the widest wave the device
 * can keep (every class over its quota at the widest values, from the shared fixture's code
 * table). For each kept timeline it measures compact JSON (what the device and the per-event cap
 * count), `jsonb::text` (`", "` and `": "` separators: what the server's caps and storage count)
 * and stored (jsonb + `ROW_OVERHEAD_BYTES` = 200 a row); per run, the timeline rows and bytes
 * and the full session's transfer (`wave_completed` plus `wave_timeline`).
 *
 * Asserted: the bounds that are invariants (each timeline within the 1,024 B per-event cap, a
 * run within 16 KB and 64 timelines, the run's waves plus timelines within `STARSWARM_CAP`) and
 * the jsonb measure against the shared fixture's own byte counts. The distribution is printed
 * (one `[sizes #3396]` block), never asserted: it is the input for the doc's measured tables.
 *   cd frontend && npx jest src/game/starswarm/__tests__/timelineSizes.test.ts
 */
import * as fs from "fs";
import * as path from "path";
import { DIFFICULTY_TIERS } from "../engine";
import {
  type WaveTimelineWire,
  TIMELINE_MAX_BYTES,
  TIMELINE_RUN_MAX_BYTES,
  TIMELINE_RUN_MAX_WAVES,
} from "../engine/waveTimeline";
import type { DifficultyTier, StarSwarmState } from "../types";
import fixture from "../../../../../backend/tests/fixtures/starswarm_wave_timeline_v1.json";
import { clearWave } from "./helpers/engineFixtures";
import { SCENARIOS, replay } from "./helpers/goldenRuns";
import { playRun } from "./helpers/timelineGoldenRuns";

// Both mirror backend/games/replay_caps.py; backend/tests/test_starswarm_timeline_goldens.py
// (test_the_size_measurement_uses_the_real_caps) pins the backend's values to these.
/** `ROW_OVERHEAD_BYTES` in `backend/games/replay_caps.py`. */
const ROW_OVERHEAD = 200;
/** `STARSWARM_CAP` in `backend/games/replay_caps.py` (264 events, 149,500 B: #3394). */
const STARSWARM_CAP = { events: 264, bytes: 149_500 };

/** The length of `v` as Postgres prints `jsonb::text`: `", "` and `": "` separators. */
function jsonbBytes(v: unknown): number {
  return Buffer.byteLength(jsonbText(v), "utf8");
}
function jsonbText(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonbText).join(", ")}]`;
  if (v !== null && typeof v === "object") {
    const parts = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => `${JSON.stringify(k)}: ${jsonbText(x)}`);
    return `{${parts.join(", ")}}`;
  }
  return JSON.stringify(v);
}
const compact = (v: unknown) => JSON.stringify(v).length;
const stored = (v: unknown) => jsonbBytes(v) + ROW_OVERHEAD;

interface Measured {
  readonly name: string;
  readonly end: StarSwarmState;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}
function dist(values: readonly number[]) {
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  return {
    n: s.length,
    min: s[0] ?? 0,
    median: percentile(s, 50),
    p95: percentile(s, 95),
    max: s.at(-1) ?? 0,
    mean,
  };
}

/** Every combat wave flown for 300 ticks, then cleared: a long run the pilot survives. */
function prolonged(): StarSwarmState {
  let wave = 0;
  let since = 0;
  return playRun({
    difficulty: "Lieutenant",
    ticks: 100_000,
    lives: 200,
    before: (t, s) => {
      if (s.wave !== wave) {
        wave = s.wave;
        since = t;
      }
      return s.phase === "Playing" && t - since > 300 ? clearWave(s) : s;
    },
    until: (s) => s.wave > 32 || s.phase === "GameOver",
  }).end;
}

/**
 * The widest wave a device keeps: 30 ordinary slots of the widest damage entry, the lethal
 * blow and the terminal entry at `t` 65535, every `ovf` count saturated, a 7-digit wave.
 */
function widest() {
  const lim = fixture.limits;
  const e: number[][] = [];
  for (let i = 0; i < lim.ordinarySlots; i++) e.push([lim.tMax, 2, 3, lim.xMax, 255]);
  e.push([lim.tMax, 2, 3, lim.xMax, 0], [lim.tMax, 8]);
  return {
    v: 1,
    ev: 1,
    wave: 9_999_999,
    outcome: "cleared",
    dev: false,
    ovf: [65_535, 65_535, 65_535],
    e,
  };
}

/** The golden timelines (goldenTimelines.test.ts): the overflow and prolonged-run cases. */
function goldenCase(name: string): {
  closedTimelines: WaveTimelineWire[];
  closedWaves: Record<string, unknown>[];
} {
  const file = path.join(__dirname, "__fixtures__", "golden-replay-seed42.timelines.json");
  const all = JSON.parse(fs.readFileSync(file, "utf8")) as {
    name: string;
    closedTimelines: WaveTimelineWire[];
    closedWaves: Record<string, unknown>[];
  }[];
  return all.find((c) => c.name === name)!;
}

describe("measured wave-timeline sizes (#3396)", () => {
  const runs: Measured[] = [];

  beforeAll(() => {
    for (const sc of SCENARIOS)
      runs.push({ name: `golden/${sc.name}`, end: replay(sc, { timelineOn: true }).end });
    for (const d of DIFFICULTY_TIERS) {
      const end = playRun({ difficulty: d as DifficultyTier, ticks: 12_000, lives: 6 }).end;
      runs.push({ name: `seeded/${d}`, end });
    }
    runs.push({ name: "prolonged/32-waves", end: prolonged() });
  }, 180_000);

  it("the jsonb measure matches the shared fixture's byte counts", () => {
    for (const v of fixture.valid) {
      expect([compact(v.payload), jsonbBytes(v.payload)]).toEqual([v.compactBytes, v.jsonbBytes]);
    }
  });

  it("every bound that is an invariant holds, and the distribution is printed", () => {
    const tlCompact: number[] = [];
    const tlJsonb: number[] = [];
    const tlEntries: number[] = [];
    const lines: string[] = [];
    const perRun: {
      tl: number;
      tlStored: number;
      waves: number;
      waveStored: number;
      upload: number;
    }[] = [];
    for (const { name, end } of runs) {
      const tls = end.closedTimelines;
      expect(tls.length).toBeLessThanOrEqual(TIMELINE_RUN_MAX_WAVES);
      expect(tls.reduce((n, t) => n + compact(t), 0)).toBe(end.closedTimelinesBytes);
      expect(end.closedTimelinesBytes).toBeLessThanOrEqual(TIMELINE_RUN_MAX_BYTES);
      for (const t of tls) {
        expect(compact(t)).toBeLessThanOrEqual(TIMELINE_MAX_BYTES);
        tlCompact.push(compact(t));
        tlJsonb.push(jsonbBytes(t));
        tlEntries.push(t.e.length);
      }
      const tlStored = tls.reduce((n, t) => n + stored(t), 0);
      const waveStored = end.closedWaves.reduce((n, w) => n + stored(w), 0);
      const rows = tls.length + end.closedWaves.length;
      // the run's waves and timelines together fit the server's per-game cap
      expect(rows).toBeLessThanOrEqual(STARSWARM_CAP.events);
      expect(tlStored + waveStored).toBeLessThanOrEqual(STARSWARM_CAP.bytes);
      const upload = end.closedWaves.reduce((n, w) => n + compact(w), 0) + end.closedTimelinesBytes;
      perRun.push({ tl: tls.length, tlStored, waves: end.closedWaves.length, waveStored, upload });
      lines.push(
        `  ${name.padEnd(30)} waves ${String(end.closedWaves.length).padStart(3)}  timelines ${String(tls.length).padStart(3)}` +
          `  tl compact ${String(end.closedTimelinesBytes).padStart(6)} B  tl stored ${String(tlStored).padStart(6)} B` +
          `  wave_completed stored ${String(waveStored).padStart(7)} B  session data ${String(upload).padStart(7)} B` +
          `  over ${JSON.stringify(end.closedTimelinesOverflow)}`
      );
    }
    // the widest wave the device keeps is still under the per-event cap
    const w = widest();
    expect(compact(w)).toBeLessThanOrEqual(TIMELINE_MAX_BYTES);
    // the golden overflow wave (every class over its quota) and the prolonged run at the budget
    const ovf = goldenCase("overflow-every-class").closedTimelines.find((t) => t.ovf[0] > 0)!;
    expect(compact(ovf)).toBeLessThanOrEqual(TIMELINE_MAX_BYTES);
    const cappedRun = goldenCase("prolonged-every-wave-damaged");
    const capped = cappedRun.closedTimelines;
    const cappedWavesStored = cappedRun.closedWaves.reduce((a, w) => a + stored(w), 0);
    const cappedCompact = capped.reduce((a, t) => a + compact(t), 0);
    const cappedStored = capped.reduce((a, t) => a + stored(t), 0);
    expect(capped.length).toBeLessThanOrEqual(TIMELINE_RUN_MAX_WAVES);
    expect(cappedCompact).toBeLessThanOrEqual(TIMELINE_RUN_MAX_BYTES);
    expect(capped.length + cappedRun.closedWaves.length).toBeLessThanOrEqual(STARSWARM_CAP.events);
    expect(cappedStored + cappedWavesStored).toBeLessThanOrEqual(STARSWARM_CAP.bytes);
    const c = dist(tlCompact);
    const j = dist(tlJsonb);
    const n = dist(tlEntries);
    const typical = perRun.filter((_, i) => runs[i]!.name.startsWith("seeded/"));
    const mean = (f: (r: (typeof perRun)[number]) => number) =>
      typical.reduce((a, r) => a + f(r), 0) / typical.length;
    const fmt = (d: ReturnType<typeof dist>) =>
      `min ${d.min} / median ${d.median} / p95 ${d.p95} / max ${d.max} / mean ${d.mean.toFixed(1)} (n ${d.n})`;
    process.stdout.write(
      [
        "[sizes #3396] wave_timeline, measured",
        `  entries per timeline:  ${fmt(n)}`,
        `  compact B:             ${fmt(c)}`,
        `  jsonb B:               ${fmt(j)}  (stored = jsonb + ${ROW_OVERHEAD})`,
        `  jsonb / compact:       ${(j.mean / c.mean).toFixed(3)} mean`,
        `  widest kept wave:      ${compact(w)} B compact, ${jsonbBytes(w)} B jsonb, ${stored(w)} B stored (${w.e.length} entries)`,
        `  golden overflow wave:  ${compact(ovf)} B compact, ${jsonbBytes(ovf)} B jsonb, ${stored(ovf)} B stored (${ovf.e.length} entries, ovf ${JSON.stringify(ovf.ovf)})`,
        `  prolonged run at cap:  ${capped.length} timelines, ${cappedCompact} B compact, ${cappedStored} B stored;` +
          ` with its ${cappedRun.closedWaves.length} waves (${cappedWavesStored} B stored) ${capped.length + cappedRun.closedWaves.length} rows,` +
          ` ${cappedStored + cappedWavesStored} B of STARSWARM_CAP's ${STARSWARM_CAP.bytes}`,
        `  seeded runs (mean):    ${mean((r) => r.waves).toFixed(2)} waves, ${mean((r) => r.tl).toFixed(2)} timelines,` +
          ` ${mean((r) => r.tlStored).toFixed(0)} B timelines stored, ${mean((r) => r.waveStored).toFixed(0)} B waves stored,` +
          ` ${mean((r) => r.upload).toFixed(0)} B session data`,
        ...lines,
        "",
      ].join("\n")
    );
    expect(c.max).toBeLessThanOrEqual(TIMELINE_MAX_BYTES);
  });
});

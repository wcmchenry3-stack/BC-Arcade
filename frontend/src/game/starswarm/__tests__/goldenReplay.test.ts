/**
 * Star Swarm golden seeded replay (#2955).
 *
 * Seeds the engine (`seedRng` via `initStarSwarm(..., seed)`, `_resetIds`) and a stand-in for
 * the engine's two `Math.random` calls (they affect play: the known exception in
 * docs/ARCHITECTURE.md §3.2), then drives the public API (`initStarSwarm`,
 * `tick`, `applyPowerUp`, `throwAsteroid`, `killEscorts`) with a scripted pilot for a fixed
 * number of ticks. Every CHECKPOINT_EVERY ticks it records a short summary plus a SHA-256 of
 * the canonical `JSON.stringify(state)`, and at the end the module counters (`engineCounters()`);
 * the whole record must equal `__fixtures__/golden-replay-seed42.json`.
 *
 * Why the hash rounds: V8's `Math.sin/cos/exp/pow` may differ in the last bits between Node
 * versions (the raw-float hash of one scenario diverged on Node 24 vs 22 with every gameplay
 * field equal). Before hashing, every non-integer number is rounded to 6 decimal places and
 * object keys are sorted (`canonical`), so the hash tracks the game, not the runtime's float
 * noise or a refactor's key order. Integer and gameplay fields — score, lives, counts, phase,
 * wave, carrier stage, ids and the engine counters — are compared exactly in the summaries.
 *
 * Contract:
 * - The Star Swarm engine split (#2988) is a pure move: this fixture must stay byte-identical
 *   across it. A diff here means the split changed behaviour; fix the split, not the fixture.
 * - The one sanctioned re-record is the `rng()` range fix in #2985 (`_shared/seededRng`, divide
 *   by 2^32 instead of 0xffffffff), which changes every draw. Re-record in that PR and say so.
 * - Any other re-record is a deliberate gameplay/balance change and must be called out in the
 *   PR description.
 *
 * Per-wave stats (#3252): each scenario's closed waves (`state.closedWaves`, the `wave_completed`
 * wire form) and its end-of-replay leaderboard result (`final_score`, `wave_reached`,
 * `difficulty_tier`, `score_breakdown`, as the screen builds it at game over) are pinned in the
 * sibling `__fixtures__/golden-replay-seed42.waves.json`. They are observations, kept out of the
 * gameplay hash and out of the main fixture, so a counter change diffs that file only — and a
 * diff there must be an intentional fixture update called out in the PR. The result is also
 * checked against the main fixture's last checkpoint, which predates the per-wave stats (epic
 * #3244): the score, the wave and the gameplay hash are the same as before the epic.
 *
 * The scenarios, the pilot, the hash and the replay itself live in `helpers/goldenRuns.ts` (moved
 * there unchanged in #3396, which replays them with the wave timeline on in
 * `goldenTimelines.test.ts`).
 *
 * Re-record: `UPDATE_GOLDEN=1 npx jest src/game/starswarm/__tests__/goldenReplay.test.ts` (writes
 * both fixtures; the main one must come out unchanged unless play changed).
 */
import * as fs from "fs";
import * as path from "path";
import { summarizeScoreLedger } from "../scoreLedger";
import type { StarSwarmState } from "../types";
import { SCENARIOS, replay } from "./helpers/goldenRuns";
import { expectClosedWave, expectRunTotals, fromWire, runWaves } from "./helpers/waveInvariants";

const FIXTURE = path.join(__dirname, "__fixtures__", "golden-replay-seed42.json");
const WAVES_FIXTURE = path.join(__dirname, "__fixtures__", "golden-replay-seed42.waves.json");

type Recorded = ReturnType<typeof replay>["recorded"];

/** #3252: the replay's per-wave stats and leaderboard result (see the header). */
function wavesOf(name: string, end: StarSwarmState) {
  return {
    name,
    result: {
      final_score: end.score,
      wave_reached: end.wave,
      difficulty_tier: end.difficulty,
      score_breakdown: summarizeScoreLedger(end.scoreLedger, end.score),
    },
    closedWaves: end.closedWaves,
  };
}

type RecordedWaves = ReturnType<typeof wavesOf>;

/** Each scenario replays once per run, however many cases read it. */
const replays = new Map<number, ReturnType<typeof replay>>();
function replayOnce(i: number): ReturnType<typeof replay> {
  let r = replays.get(i);
  if (!r) {
    r = replay(SCENARIOS[i]!);
    replays.set(i, r);
  }
  return r;
}

const UPDATE = process.env.UPDATE_GOLDEN === "1";

describe("Star Swarm golden seeded replay (seed 42)", () => {
  // Read in beforeAll and replay inside each case (not at collection time), so `-t` filtering
  // skips the replays and an engine exception fails that case instead of the whole suite.
  let golden: Recorded[] = [];
  let goldenWaves: RecordedWaves[] = [];
  const recorded = new Map<string, Recorded>();
  const recordedWaves = new Map<string, RecordedWaves>();

  beforeAll(() => {
    if (UPDATE) return;
    golden = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Recorded[];
    goldenWaves = JSON.parse(fs.readFileSync(WAVES_FIXTURE, "utf8")) as RecordedWaves[];
  });

  afterAll(() => {
    // Re-record only from a full run, so a filtered run can never write a partial fixture.
    if (!UPDATE || recorded.size !== SCENARIOS.length) return;
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    const all = SCENARIOS.map((sc) => recorded.get(sc.name));
    fs.writeFileSync(FIXTURE, JSON.stringify(all, null, 2) + "\n");
    if (recordedWaves.size !== SCENARIOS.length) return;
    const waves = SCENARIOS.map((sc) => recordedWaves.get(sc.name));
    fs.writeFileSync(WAVES_FIXTURE, JSON.stringify(waves, null, 2) + "\n");
  });

  it("covers the same scenarios as the fixture", () => {
    if (UPDATE) return;
    expect(SCENARIOS.map((sc) => sc.name)).toEqual(golden.map((g) => g.name));
    expect(SCENARIOS.map((sc) => sc.name)).toEqual(goldenWaves.map((g) => g.name));
  });

  it.each(SCENARIOS.map((sc, i) => [sc.name, i] as const))(
    "%s replays byte-identically",
    (name, i) => {
      const run = replayOnce(i).recorded;
      recorded.set(name, run);
      if (!UPDATE) expect(run).toEqual(golden[i]);
    }
  );

  it.each(SCENARIOS.map((sc, i) => [sc.name, i] as const))(
    "%s: per-wave stats and leaderboard result match the waves fixture (#3252)",
    (name, i) => {
      const waves = wavesOf(name, replayOnce(i).end);
      recordedWaves.set(name, waves);
      if (!UPDATE) expect(waves).toEqual(goldenWaves[i]);
    }
  );

  it.each(SCENARIOS.map((sc, i) => [sc.name, i] as const))(
    "%s: score, wave and gameplay hash are unchanged by the per-wave stats (#3252)",
    (name, i) => {
      if (UPDATE) return;
      const { recorded: run, end } = replayOnce(i);
      // the main fixture's last checkpoint predates epic #3244 (these three lines restate part of
      // the byte-identical check above, so a failure there is named as the epic's here)
      const before = golden[i]!.checkpoints.at(-1)!;
      const after = run.checkpoints.at(-1)!;
      expect(after.sha256).toBe(before.sha256);
      const { result, closedWaves } = wavesOf(name, end);
      expect([result.final_score, result.wave_reached]).toEqual([before.score, before.wave]);
      // the result block reconciles, and agrees wave by wave with the closed waves' scores
      const { score_breakdown: b } = result;
      expect(b.unattributed).toBeUndefined();
      const earlier = b.earlier?.total ?? 0;
      expect(earlier + b.waves.reduce((t, w) => t + w.total, 0)).toBe(result.final_score);
      for (const w of closedWaves) {
        expect(w.score.total).toBe(b.waves.find((x) => x.wave === w.wave)?.total ?? 0);
      }
    }
  );

  // #3252: the per-wave invariants (helpers/waveInvariants.ts, run over seeded runs in
  // waveStats.invariants.test.ts) over the replay's own waves — wave3-lieutenant-actions has a
  // rout and Buddy kills. Not the lives check: the replay tops the lives up to PILOT_LIVES
  // outside the engine, after wave 1's stats recorded the 3 it opened with.
  it.each(SCENARIOS.map((sc, i) => [sc.name, i] as const))(
    "%s: its closed waves hold the per-wave invariants (#3252)",
    (_name, i) => {
      const { end } = replayOnce(i);
      const closed = end.closedWaves.map(fromWire);
      expect(closed.length).toBeGreaterThan(0);
      for (const w of closed) expectClosedWave(w, { lives: false });
      expectRunTotals(runWaves(closed, end), end);
    }
  );
});

/**
 * #3396: the frontend reconciliation invariant (docs/games/starswarm-diagnostics.md,
 * "Reader and reconciliation"). Over seeded runs at every difficulty, every kept timeline
 * reconciles against its `wave_completed` with the reader's own check list (a port of
 * `backend/starswarm/replay.py`, `helpers/timelineReconcile.ts`): hits per cause, the lethal
 * blow, the lives and hull path, PLATING_UP, pickups and buff ends, Carrier stage, rout and
 * terminal `t`. Presence is checked exactly, with every count in hand: each `died` and damaged
 * cleared wave has a timeline unless `closedTimelinesOverflow` accounts for it.
 *
 * Drift: the port runs over the backend reader's own fixture
 * (`backend/tests/fixtures/starswarm_run_lieutenant_7w.json`), which must reconcile clean, and
 * over the same targeted corruptions `test_replay_game_starswarm_timeline.py` makes, each failing
 * the same named check. The backend runs `replay.py` over this story's golden timelines
 * (`test_starswarm_timeline_goldens.py`), so a check that changes on one side fails CI there.
 */
import { DIFFICULTY_TIERS, toWirePayload } from "../engine";
import type { DifficultyTier } from "../types";
import runFixture from "../../../../../backend/tests/fixtures/starswarm_run_lieutenant_7w.json";
import { playRun, presenceCounts } from "./helpers/timelineGoldenRuns";
import { pairWaves, presenceProblems, reconcile } from "./helpers/timelineReconcile";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function fixtureRows() {
  const events = clone(runFixture.events) as { event_type: string; data: Row }[];
  const of = (type: string) => events.filter((e) => e.event_type === type).map((e) => e.data);
  return { summaries: of("wave_completed"), timelines: of("wave_timeline") };
}

/** The failed checks of `wave`, as `name: detail`. */
function failedOf(summaries: Row[], timelines: Row[], wave: number): string[] {
  const pair = pairWaves(summaries as never[], timelines as never[]).find(
    (p) => p.timeline !== null && (p.timeline as Row).wave === wave
  )!;
  expect(pair.summary).not.toBeNull();
  return reconcile(pair.summary, pair.timeline as never)
    .filter((c) => !c.ok)
    .map((c) => `${c.name}: ${c.detail}`);
}

describe("the port against the backend reader's fixture (drift)", () => {
  it("the consistent seven-wave run reconciles clean, every timeline paired", () => {
    const { summaries, timelines } = fixtureRows();
    expect(timelines.map((t) => t.wave).sort()).toEqual([2, 4, 6, 7]);
    const pairs = pairWaves(summaries as never[], timelines as never[]);
    for (const { summary, timeline } of pairs) {
      if (timeline === null) continue;
      expect(summary).not.toBeNull();
      const checks = reconcile(summary, timeline);
      expect(checks.length).toBeGreaterThan(20);
      expect(checks.filter((c) => !c.ok)).toEqual([]);
    }
  });

  const setHits = (s: Row, cause: string, result: string, n: number) => {
    s.damage.hits[cause] = { ...(s.damage.hits[cause] ?? {}), [result]: n };
  };
  // the same corruptions as test_replay_game_starswarm_timeline.py's CASES, each failing its check
  const CASES: [string, number, (s: Row, t: Row) => void, string][] = [
    ["hull hits per cause", 7, (s) => setHits(s, "bullet", "plating", 2), "HULL_HIT bullet"],
    ["hull hit in another cause", 7, (s) => setHits(s, "beam", "plating", 1), "HULL_HIT beam"],
    ["hull hit total", 7, (s) => setHits(s, "bullet", "plating", 0), "HULL_HIT total"],
    ["life loss per cause", 7, (s) => setHits(s, "rock", "life", 0), "LIFE_LOST rock"],
    ["life loss total", 6, (s) => setHits(s, "beam", "life", 2), "LIFE_LOST total"],
    ["death cause", 7, (s) => (s.damage.deathCause = "bullet"), "RUN_LOST cause"],
    ["bonus lives", 7, (s) => (s.pacing.bonusLives = 1), "BONUS_LIFE awarded"],
    ["lives path", 7, (s) => (s.pacing.end.lives = 1), "lives and hull arithmetic"],
    ["hull path", 7, (s) => (s.pacing.start.hull = 0), "lives and hull arithmetic"],
    ["hull end", 2, (s) => (s.pacing.end.hull = 0), "lives and hull arithmetic"],
    ["plating up", 2, (s) => (s.powerUps.collected.hull = 2), "PLATING_UP"],
    ["pickup", 7, (s) => (s.powerUps.collected.bomb = 0), "PICKUP bomb"],
    ["buff end", 7, (s) => (s.powerUps.expired.shield = 0), "BUFF_END shield"],
    [
      "carrier stage t",
      6,
      (s) => (s.carrier.stageReachedMs.finalStand = 31_000),
      "CARRIER_STAGE finalStand t",
    ],
    [
      "carrier stage absent",
      6,
      (s) => delete s.carrier.stageReachedMs.exposed,
      "CARRIER_STAGE exposed t",
    ],
    ["rout t", 2, (s) => (s.rout.atMs = 36_000), "ROUT t"],
    ["rout not triggered", 2, (s) => (s.rout.triggered = false), "ROUT t"],
    ["terminal t", 7, (s) => (s.pacing.durationMs = 31_500), "terminal t"],
    ["carrier down without a kill", 2, (s) => delete s.combat.kills.Carrier, "CARRIER_DOWN"],
    ["timeline side: a life claims 0", 7, (_s, t) => (t.e[3][4] = 0), "lives and hull arithmetic"],
    [
      "timeline side: the fatal blow as plating",
      7,
      (_s, t) => (t.e[6] = [301, 1, 3, 29, 0]),
      "last hit is the lethal LIFE_LOST",
    ],
  ];

  it.each(CASES)("%s fails %s's check", (_label, wave, fn, check) => {
    const { summaries, timelines } = fixtureRows();
    fn(
      summaries.find((s) => s.wave === wave)!,
      timelines.find((t) => t.wave === wave)!
    );
    const failed = failedOf(summaries, timelines, wave);
    expect(failed.some((f) => f.startsWith(check))).toBe(true);
  });

  // the RUN_LOST cause check on edge inputs, each result as replay.py gives it
  // (`reconcile(summary, {"outcome": "died", "ovf": [0, 0, 0], "e": e})` under the backend venv)
  const bare = (deathCause?: string | null) => ({
    damage: { hits: {}, ...(deathCause === undefined ? {} : { deathCause }) },
    pacing: { durationMs: 1000, start: { lives: 1, hull: 0 }, end: { lives: 1, hull: 0 } },
  });
  const runLostCheck = (summary: unknown, e: number[][]) =>
    reconcile(summary, { outcome: "died", ovf: [0, 0, 0], e }).find((c) =>
      c.name.startsWith("RUN_LOST cause")
    )!.ok;
  it.each<[string, unknown, number[][], boolean]>([
    ["no RUN_LOST and no deathCause key (None == None)", bare(), [[10, 8]], true],
    ["no RUN_LOST and deathCause null", bare(null), [[10, 8]], true],
    [
      "an out-of-range cause index, deathCause null (the entry is dropped)",
      bare(null),
      [[10, 9, 9]],
      true,
    ],
    ["an out-of-range cause index, no deathCause key", bare(), [[10, 9, 9]], true],
    ["a RUN_LOST bullet with no deathCause key", bare(), [[10, 9, 0]], false],
    ["a RUN_LOST bullet with deathCause bullet", bare("bullet"), [[10, 9, 0]], true],
  ])("RUN_LOST cause check matches replay.py: %s", (_label, summary, e, ok) => {
    expect(runLostCheck(summary, e)).toBe(ok);
  });

  it("an overflowing class weakens its checks to at most, as the backend does", () => {
    const { summaries, timelines } = fixtureRows();
    const t7 = timelines.find((t) => t.wave === 7)!;
    t7.ovf = [1, 1, 1];
    t7.e = t7.e.filter((e: number[]) => e[1] !== 1 && e[1] !== 20); // a hull hit and pickups lost
    expect(failedOf(summaries, timelines, 7)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The invariant over seeded runs
// ---------------------------------------------------------------------------

/** Wave 1 with 6 lives (stats opened with them), the pilot until the run ends. */
const runOf = (difficulty: DifficultyTier) =>
  playRun({ difficulty, ticks: 12_000, lives: 6, timelineOn: true });

describe.each(DIFFICULTY_TIERS.map((d) => [d as DifficultyTier]))(
  "reconciliation over a seeded run at %s",
  (difficulty) => {
    const run = runOf(difficulty);
    const end = run.end;

    it("the run is a real one: it ends, with kept timelines", () => {
      expect(end.phase).toBe("GameOver");
      expect(end.closedTimelines.length).toBeGreaterThan(0);
      expect(end.closedTimelines.some((t) => t.outcome === "died")).toBe(true);
    });

    it("every kept timeline reconciles with every check of the reader", () => {
      const pairs = pairWaves(end.closedWaves, end.closedTimelines);
      let checked = 0;
      for (const { summary, timeline } of pairs) {
        if (timeline === null) continue;
        expect(summary).not.toBeNull();
        if (summary!.dev || timeline.dev) continue; // dev waves are decoded, not checked
        const failed = reconcile(summary, timeline).filter((c) => !c.ok);
        expect({ wave: timeline.wave, outcome: timeline.outcome, failed }).toEqual({
          wave: timeline.wave,
          outcome: timeline.outcome,
          failed: [],
        });
        checked++;
      }
      expect(checked).toBe(end.closedTimelines.length);
    });

    it("presence is exact: every died and damaged cleared wave has one, counted otherwise", () => {
      const closes = run.closes.map(toWirePayload);
      expect(
        presenceProblems(closes, end.closedWaves, end.closedTimelines, presenceCounts(end))
      ).toEqual([]);
    });
  }
);

describe("presence catches a missing, an extra and an unaccounted timeline", () => {
  const run = runOf("Commander");
  const end = run.end;
  const closes = run.closes.map(toWirePayload);
  const counts = presenceCounts(end);

  it("a dropped timeline nothing counts", () => {
    expect(
      presenceProblems(closes, end.closedWaves, end.closedTimelines.slice(1), counts).length
    ).toBeGreaterThan(0);
  });

  it("the same drop, counted in waves, holds", () => {
    expect(
      presenceProblems(closes, end.closedWaves, end.closedTimelines.slice(1), {
        ...counts,
        waves: counts.waves + 1,
      })
    ).toEqual([]);
  });

  it("a clean count off by one", () => {
    expect(
      presenceProblems(closes, end.closedWaves, end.closedTimelines, {
        ...counts,
        clean: counts.clean + 1,
      }).length
    ).toBeGreaterThan(0);
  });

  it("a timeline with no summary (and no summary cap)", () => {
    const tl = end.closedTimelines[0]!;
    const summaries = end.closedWaves.filter(
      (w) => !(w.wave === tl.wave && w.outcome === tl.outcome)
    );
    expect(presenceProblems(closes, summaries, end.closedTimelines, counts)).toEqual(
      expect.arrayContaining([expect.stringContaining("orphan timeline")])
    );
  });
});

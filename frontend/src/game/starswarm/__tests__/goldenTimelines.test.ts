/**
 * Star Swarm golden wave timelines (#3396, epic #3390).
 *
 * Two kinds of golden, both pinned in `__fixtures__/golden-replay-seed42.timelines.json`:
 *
 *  1. **The golden replay with the timeline on.** The three seed-42 scenarios of
 *     `goldenReplay.test.ts` (#2955), replayed with the run option `timelineOn` true. Their
 *     checkpoints (every gameplay hash, score, wave, lives and the engine counters) must equal
 *     `golden-replay-seed42.json` and their closed waves `golden-replay-seed42.waves.json`
 *     exactly: the timeline changes no gameplay and no wave summary. Those two fixtures are never
 *     re-recorded here. The timelines they keep are recorded in the new fixture.
 *  2. **Targeted scenarios** (seeded runs from wave 1, `helpers/timelineGoldenRuns.ts`): cleared
 *     waves then a death in combat; a boss wave; a death during the extraction; late impacts (a
 *     hit after the clear); a pause and restore mid-wave (identical to the uninterrupted run), and
 *     a restore from an older build's save (recording lost, the later closes counted
 *     `unrecorded`); a run abandoned mid-wave; an overflowing wave (every class over its quota:
 *     `ovf` counts); the recorder disabled (the dial off: no timeline at all) and a prolonged
 *     every-wave-damaged run that reaches the run budget (`full`). Each is also replayed with the
 *     timeline off and must play identically. The send path's cases (sampled out, the kill
 *     switch, a reporter that throws) are in `goldenTimelines.pipeline.test.ts` and the screen's
 *     in `StarSwarmScreen.timelineRun.test.tsx`.
 *
 * Every kept timeline also reconciles with the reader's checks (`helpers/timelineReconcile.ts`,
 * the port of `backend/starswarm/replay.py`; for the golden replays every check but the lives and
 * hull path, which PILOT_LIVES skews) and, for the targeted runs, presence holds exactly. The
 * backend runs `replay.py` over this fixture (`backend/tests/test_starswarm_timeline_goldens.py`).
 *
 * Re-record (only the timelines fixture; the gameplay fixtures stay as they are):
 *   UPDATE_GOLDEN=1 npx jest src/game/starswarm/__tests__/goldenTimelines.test.ts
 * A diff in it is an intentional change to the timeline capture and must be called out in the
 * PR (bump `TIMELINE_ENGINE_VERSION` if a trigger's meaning changed).
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { toWirePayload } from "../engine";
import { TL, type WaveTimelineWire } from "../engine/waveTimeline";
import { fitsSaveShape, restoreSavedState, type SavedStarSwarmState } from "../saveShape";
import type { StarSwarmState } from "../types";
import { timelinesInSendOrder } from "../waveEvents";
import { NO_INPUT, clearWave, shotOnShip } from "./helpers/engineFixtures";
import { SCENARIOS, replay, sha } from "./helpers/goldenRuns";
import { onShip } from "./helpers/powerUpFixtures";
import {
  playRun,
  presenceCounts,
  type PlayOptions,
  type PlayedRun,
} from "./helpers/timelineGoldenRuns";
import { pairWaves, presenceProblems, reconcile } from "./helpers/timelineReconcile";

const FIXTURE = path.join(__dirname, "__fixtures__", "golden-replay-seed42.timelines.json");
const GAMEPLAY_FIXTURE = path.join(__dirname, "__fixtures__", "golden-replay-seed42.json");
const WAVES_FIXTURE = path.join(__dirname, "__fixtures__", "golden-replay-seed42.waves.json");
const UPDATE = process.env.UPDATE_GOLDEN === "1";
const SLOW = 120_000;

// ---------------------------------------------------------------------------
// Out-of-tick steps the targeted scenarios apply
// ---------------------------------------------------------------------------

/**
 * A shot sitting on the ship, with no shield and no invulnerability: the next tick costs a plate,
 * or a life when there is none. Lives and hull are the engine's own, so the wave's lives and hull
 * arithmetic still reconciles.
 */
function hitNow(s: StarSwarmState): StarSwarmState {
  return {
    ...s,
    player: { ...s.player, invincibleTimer: 0 },
    activePowerUp: null,
    enemyBullets: [...s.enemyBullets, shotOnShip(s)],
  };
}

/**
 * A kill drop of `type` landing on the ship: the pickup on the ship, counted as spawned (by a
 * kill) in the wave's stats as the engine's own drop would be, so the summary stays consistent.
 */
function dropOnShip(s: StarSwarmState, type: "shield" | "lightning"): StarSwarmState {
  const pu = s.waveStats.powerUps;
  const spawned = {
    ...pu.spawned,
    [type]: { ...pu.spawned[type], kill: pu.spawned[type].kill + 1 },
  };
  return {
    ...s,
    powerUps: [...s.powerUps, onShip(s, type)],
    waveStats: { ...s.waveStats, powerUps: { ...pu, spawned } },
  };
}

/** What a pause save holds once written and read back (pauseStore drops `lastClosedWave`). */
function roundTrip(s: StarSwarmState, drop: readonly string[] = []): StarSwarmState {
  const { lastClosedWave: _dropped, ...rest } = s;
  const out = JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
  for (const k of drop) delete out[k];
  expect(fitsSaveShape(out)).toBe(true);
  return restoreSavedState(out as unknown as SavedStarSwarmState);
}

/** The timeline fields a save from before #3393 lacks. */
const PRE_TIMELINE_FIELDS = [
  "waveTimeline",
  "timelineOn",
  "timelineLost",
  "closedTimelines",
  "closedTimelinesLens",
  "closedTimelinesBytes",
  "closedTimelinesOverflow",
];

/** Clears the wave (every enemy down) once `wave` has been in combat for `afterTicks`. */
function clearAfter(afterTicks: number, keep: (wave: number) => boolean = () => false) {
  let wave = 0;
  let since = 0;
  return (t: number, s: StarSwarmState): StarSwarmState => {
    if (s.wave !== wave) {
      wave = s.wave;
      since = t;
    }
    if (keep(s.wave) || s.phase !== "Playing" || t - since < afterTicks) return s;
    return clearWave(s);
  };
}

/** Applies `step` once, on the first tick whose state matches `when`. */
function once(when: (s: StarSwarmState) => boolean, step: (s: StarSwarmState) => StarSwarmState) {
  let done = false;
  return (_t: number, s: StarSwarmState): StarSwarmState => {
    if (done || !when(s)) return s;
    done = true;
    return step(s);
  };
}

// ---------------------------------------------------------------------------
// The targeted scenarios
// ---------------------------------------------------------------------------

interface Targeted {
  readonly name: string;
  /** The run; `timelineOn` is the case's own (false only for the dial-off case). */
  readonly play: (timelineOn: boolean) => PlayedRun;
  /** What the scenario is about, beyond the fixture. */
  readonly expect: (run: PlayedRun) => void;
  /**
   * Also replay it with the timeline off (default true). The prolonged run skips it (about 20 s
   * a replay; the on/off identity is held by every other case), and so does the dial-off case,
   * which is the first case's off run.
   */
  readonly offCheck?: boolean;
}

/** A case's run; `o` is called per run, so the steps' own state starts fresh each time. */
const run = (o: () => Omit<PlayOptions, "timelineOn">) => (timelineOn: boolean) =>
  playRun({ ...o(), timelineOn });

const cache = new Map<string, unknown>();
function memo<T>(key: string, f: () => T): T {
  if (!cache.has(key)) cache.set(key, f());
  return cache.get(key) as T;
}

/** Ensign, 6 lives, the pilot until the run ends: played once per flag, shared by three cases. */
const ensignRun = (timelineOn: boolean): PlayedRun =>
  memo(`ensign:${timelineOn}`, () =>
    playRun({ difficulty: "Ensign", ticks: 12_000, lives: 6, timelineOn })
  );

const codesOf = (tl: WaveTimelineWire) => tl.e.map((e) => e[1]);
const tlOf = (r: PlayedRun, wave: number, outcome: "cleared" | "died") =>
  r.end.closedTimelines.find((t) => t.wave === wave && t.outcome === outcome);

/**
 * `waves` waves, each hit once as combat opens and cleared a moment later (swoop-in and
 * extraction played out), then the run is lost in the next wave: every wave is kept as damaged.
 */
function damagedEveryWave(waves: number): (timelineOn: boolean) => PlayedRun {
  return (timelineOn) => {
    let hitWave = 0;
    const clear = clearAfter(20);
    return playRun({
      difficulty: "Lieutenant",
      ticks: 200_000,
      lives: 200,
      timelineOn,
      before: (t, s) => {
        // past the last wave: hit on every combat tick until the lives run out
        if (s.wave > waves) return s.phase === "Playing" ? hitNow(s) : s;
        if (s.phase === "Playing" && s.wave !== hitWave && s.player.invincibleTimer <= 0) {
          hitWave = s.wave;
          return hitNow(s);
        }
        return clear(t, s);
      },
    });
  };
}

const TARGETED: Targeted[] = [
  {
    name: "cleared-waves-then-death-in-combat",
    play: ensignRun,
    expect: (r) => {
      expect(r.end.phase).toBe("GameOver");
      const cleared = r.end.closedTimelines.filter((t) => t.outcome === "cleared");
      expect(cleared.length).toBeGreaterThanOrEqual(2);
      for (const tl of cleared) expect(codesOf(tl).at(-1)).toBe(TL.WAVE_CLEARED);
      const died = r.end.closedTimelines.find((t) => t.outcome === "died")!;
      // in combat: the last phase entered before the lethal blow is Playing
      const phases = died.e.filter((e) => e[1] === TL.PHASE).map((e) => e[2]);
      expect(phases.at(-1)).toBe(1);
      expect(died.e.at(-2)![1]).toBe(TL.LIFE_LOST);
      expect(died.e.at(-2)![4]).toBe(0);
    },
  },
  {
    name: "boss-wave",
    // waves 1-4 cleared after 900 ticks of combat; the wave-5 boss is flown by the pilot
    play: run(() => ({
      difficulty: "Lieutenant",
      ticks: 20_000,
      lives: 30,
      before: clearAfter(900, (w) => w === 5),
      until: (s) => s.wave >= 6 || s.phase === "GameOver",
    })),
    expect: (r) => {
      expect(r.end.wave).toBe(6);
      const boss = tlOf(r, 5, "cleared")!;
      expect(boss.dev).toBe(false);
      const stages = boss.e.filter((e) => e[1] === TL.CARRIER_STAGE).map((e) => e[2]);
      expect(stages).toEqual([2]); // a boss wave's lone Carrier records only the final stand
      expect(codesOf(boss)).toContain(TL.CARRIER_DOWN);
    },
  },
  {
    name: "death-during-extraction",
    play: run(() => ({
      difficulty: "Ensign",
      ticks: 12_000,
      lives: 6,
      // hit on every tick of wave 1's extraction until the last life goes
      before: (_t, s) => (s.wave === 1 && s.phase === "Extraction" ? hitNow(s) : s),
    })),
    expect: (r) => {
      expect(r.end.phase).toBe("GameOver");
      const died = r.end.closedTimelines.find((t) => t.outcome === "died")!;
      const iPhase = died.e.findIndex((e) => e[1] === TL.PHASE && e[2] === 3);
      const iBlow = died.e.findIndex((e) => e[1] === TL.LIFE_LOST && e[4] === 0);
      expect(iPhase).toBeGreaterThanOrEqual(0);
      expect(iBlow).toBeGreaterThan(iPhase); // the fatal hit came after the extraction began
      expect(codesOf(died)).not.toContain(TL.WAVE_CLEARED);
    },
  },
  {
    name: "late-impacts-after-the-clear",
    // a hit taken in the pickup wait or the extraction: the wave still clears, kept as damaged
    play: run(() => ({
      difficulty: "Ensign",
      ticks: 12_000,
      lives: 6,
      before: once((s) => s.phase === "ClearAwaitingPickups" || s.phase === "Extraction", hitNow),
      until: (s) => s.wave >= 2 && s.phase === "Playing",
    })),
    expect: (r) => {
      const w1 = tlOf(r, 1, "cleared")!;
      const firstClearPhase = w1.e.findIndex((e) => e[1] === TL.PHASE && e[2] >= 2);
      const lastHit = w1.e.findLastIndex((e) => e[1] === TL.HULL_HIT || e[1] === TL.LIFE_LOST);
      expect(firstClearPhase).toBeGreaterThanOrEqual(0);
      expect(lastHit).toBeGreaterThan(firstClearPhase);
      expect(codesOf(w1).at(-1)).toBe(TL.WAVE_CLEARED);
    },
  },
  {
    name: "pause-and-restore-mid-wave",
    // saved and restored three times mid-wave (twice in wave 1, once in wave 2)
    play: run(() => ({
      difficulty: "Ensign",
      ticks: 12_000,
      lives: 6,
      after: (t, s) => ([700, 1900, 4100].includes(t) ? roundTrip(s) : s),
    })),
    expect: (r) => {
      const straight = ensignRun(true);
      // identical to the uninterrupted run: nothing lost, duplicated or shifted in time
      expect(r.end.closedTimelines).toEqual(straight.end.closedTimelines);
      expect(r.end.closedTimelinesOverflow).toEqual(straight.end.closedTimelinesOverflow);
      expect(r.end.closedTimelinesBytes).toBe(straight.end.closedTimelinesBytes);
      expect(r.end.closedWaves).toEqual(straight.end.closedWaves);
      expect(sha(r.end)).toBe(sha(straight.end));
      expect(r.end.closedTimelinesOverflow.unrecorded).toBe(0);
    },
  },
  {
    name: "restore-from-an-older-build-save",
    // the save at tick 700 (mid wave 1) has no timeline fields: recording is lost for the run
    play: run(() => ({
      difficulty: "Ensign",
      ticks: 12_000,
      lives: 6,
      after: (t, s) => (t === 700 ? roundTrip(s, PRE_TIMELINE_FIELDS) : s),
    })),
    expect: (r) => {
      expect(r.end.timelineOn).toBe(false);
      expect(r.end.timelineLost).toBe(true);
      expect(r.end.closedTimelines).toEqual([]);
      // explicitly marked: every close after the restore counted as unrecorded
      expect(r.end.closedTimelinesOverflow.unrecorded).toBe(r.closes.length);
      expect(r.closes.length).toBeGreaterThan(0);
    },
  },
  {
    name: "abandoned-mid-wave",
    // stopped in wave 3's combat (a new run abandons it): only closed waves have timelines
    play: run(() => ({
      difficulty: "Ensign",
      ticks: 12_000,
      lives: 6,
      until: (s) => s.wave === 3 && s.phase === "Playing" && s.waveStats.pacing.durationMs > 15_000,
    })),
    expect: (r) => {
      expect(r.end.phase).toBe("Playing");
      expect(r.end.wave).toBe(3);
      expect(r.end.waveTimeline!.e.length).toBeGreaterThan(0); // the wave in progress...
      const sent = timelinesInSendOrder(r.end.closedTimelines);
      expect(sent.every((t) => t.wave < 3)).toBe(true); // ...is never sent (D10)
      expect(sent.some((t) => t.outcome === "died")).toBe(false);
    },
  },
  {
    name: "overflow-every-class",
    // wave 1: twelve pickups on the ship and 30 hits, then cleared; then a death
    play: (timelineOn) => {
      let step = 0;
      return playRun({
        difficulty: "Commander",
        ticks: 20_000,
        lives: 40,
        timelineOn,
        input: () => NO_INPUT,
        before: (_t, s) => {
          if (s.wave !== 1 || s.phase !== "Playing" || step >= 42) {
            if (s.wave === 2 && s.phase === "Playing") return hitNow(s); // until the run ends
            return s;
          }
          step++;
          if (step <= 12) {
            const type = step % 2 ? "shield" : "lightning";
            return dropOnShip(s, type);
          }
          if (step < 42) return hitNow(s);
          return clearWave(s);
        },
      });
    },
    expect: (r) => {
      const w1 = tlOf(r, 1, "cleared")!;
      expect(w1.e.length).toBe(31); // 30 ordinary slots and the terminal one
      expect(w1.ovf[0]).toBeGreaterThan(0); // damage refused
      expect(w1.ovf[1]).toBeGreaterThan(0); // transitions refused (the slots were full)
      expect(w1.ovf[2]).toBe(4); // the 9th to 12th pickups
      expect(codesOf(w1).filter((c) => c === TL.PICKUP)).toHaveLength(8);
      expect(JSON.stringify(w1).length).toBeLessThanOrEqual(1024);
      expect(tlOf(r, 2, "died")).toBeDefined();
    },
  },
  {
    name: "recorder-disabled",
    // the timeline-off run of the first case: its on/off check is that case's
    play: () => ensignRun(false),
    offCheck: false,
    expect: (r) => {
      expect(r.end.phase).toBe("GameOver");
      expect(r.closes.length).toBeGreaterThan(0);
      expect(r.end.waveTimeline).toBeNull();
      expect(r.end.closedTimelines).toEqual([]);
      expect(r.end.closedTimelinesBytes).toBe(0);
      expect(r.end.closedTimelinesOverflow).toEqual({
        waves: 0,
        bytes: 0,
        clean: 0,
        devRepeats: 0,
        unrecorded: 0,
        full: false,
      });
    },
  },
  {
    name: "prolonged-every-wave-damaged",
    // 66 waves, each hit once: the cleared list closes at the run budget, the death still fits
    play: damagedEveryWave(66),
    offCheck: false,
    expect: (r) => {
      const end = r.end;
      expect(end.phase).toBe("GameOver");
      expect(end.wave).toBe(67);
      expect(end.closedTimelinesOverflow.full).toBe(true);
      expect(end.closedTimelines.length).toBe(64); // 63 cleared and the death
      expect(end.closedTimelines.at(-1)!.outcome).toBe("died");
      expect(end.closedTimelinesBytes).toBeLessThanOrEqual(16_384);
      expect(end.closedTimelinesOverflow.waves).toBe(66 - 63);
    },
  },
];

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/** What the fixture pins for one run. */
function recordOf(name: string, end: StarSwarmState) {
  return {
    name,
    end: { wave: end.wave, phase: end.phase, score: end.score, lives: end.player.lives },
    /** The run's `wave_completed` payloads: the backend reconciles the timelines against them. */
    closedWaves: end.closedWaves,
    closedTimelines: end.closedTimelines,
    closedTimelinesBytes: end.closedTimelinesBytes,
    closedTimelinesOverflow: end.closedTimelinesOverflow,
    /** The wave in progress at the end (never sent): its entries, or null. */
    live: end.waveTimeline?.e ?? null,
    /** The order `sendClosedWaves` records them in. */
    sendOrder: timelinesInSendOrder(end.closedTimelines).map((t) => `${t.wave}:${t.outcome}`),
  };
}
type Recorded = ReturnType<typeof recordOf>;

const goldenOn = (i: number) =>
  memo(`golden:${i}`, () => replay(SCENARIOS[i]!, { timelineOn: true }));
const targeted = (i: number, on: boolean) => memo(`t:${i}:${on}`, () => TARGETED[i]!.play(on));

/** Every kept non-dev timeline reconciles, and presence holds exactly. */
function expectReconciled(end: StarSwarmState, closes: PlayedRun["closes"] | null): void {
  for (const { summary, timeline } of pairWaves(end.closedWaves, end.closedTimelines)) {
    if (timeline === null) continue;
    expect(summary).not.toBeNull();
    if (summary!.dev || timeline.dev) continue; // dev waves: decoded, not checked
    const failed = reconcile(summary, timeline).filter((c) => !c.ok);
    expect({ wave: timeline.wave, failed }).toEqual({ wave: timeline.wave, failed: [] });
  }
  if (closes) {
    const wire = closes.map(toWirePayload);
    expect(
      presenceProblems(wire, end.closedWaves, end.closedTimelines, presenceCounts(end))
    ).toEqual([]);
  }
}

/** Writes the fixture as the repo's Prettier formats JSON (so `format:check` passes a re-record). */
function writeFixture(v: unknown): void {
  fs.writeFileSync(FIXTURE, JSON.stringify(v, null, 2) + "\n");
  const bin = path.join(__dirname, "..", "..", "..", "..", "node_modules", ".bin", "prettier");
  execFileSync(bin, ["--write", FIXTURE], { stdio: "ignore" });
}

describe("Star Swarm golden wave timelines (#3396)", () => {
  let golden: Recorded[] = [];
  const recorded = new Map<string, Recorded>();
  const ALL = [...SCENARIOS.map((s) => `golden/${s.name}`), ...TARGETED.map((s) => s.name)];

  beforeAll(() => {
    if (!UPDATE) golden = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Recorded[];
  });

  afterAll(() => {
    // re-record only from a full run, so a filtered run never writes a partial fixture
    if (!UPDATE || recorded.size !== ALL.length) return;
    const all = ALL.map((n) => recorded.get(n));
    writeFixture(all);
  });

  it("covers the same scenarios as the fixture", () => {
    if (UPDATE) return;
    expect(golden.map((g) => g.name)).toEqual(ALL);
  });

  describe("the golden replay with the timeline on", () => {
    const gameplay = () => JSON.parse(fs.readFileSync(GAMEPLAY_FIXTURE, "utf8")) as unknown[];
    const waves = () =>
      JSON.parse(fs.readFileSync(WAVES_FIXTURE, "utf8")) as { closedWaves: unknown[] }[];

    it.each(SCENARIOS.map((sc, i) => [sc.name, i] as const))(
      "%s: gameplay identical to the timeline-off fixture, waves unchanged, timelines pinned",
      (name, i) => {
        const { recorded: rec, end } = goldenOn(i);
        expect(end.timelineOn).toBe(true);
        // every checkpoint (gameplay hash, score, wave, lives) and the engine counters
        expect(rec).toEqual(gameplay()[i]);
        expect(end.closedWaves).toEqual(waves()[i]!.closedWaves);
        const r = recordOf(`golden/${name}`, end);
        recorded.set(r.name, r);
        if (!UPDATE) expect(r).toEqual(golden[i]);
        // Reconciled with every check but the lives and hull arithmetic: the replay tops lives up
        // to PILOT_LIVES outside the engine after the first wave's stats opened with 3, so that
        // one path is skewed. The dev waves (a run opened past wave 1 is a dev wave jump) are
        // checked too: the reader would skip them, but nothing here changes their counts.
        expect(end.closedTimelines.length).toBeGreaterThan(0);
        let checked = 0;
        let skewed = 0;
        for (const { summary, timeline } of pairWaves(end.closedWaves, end.closedTimelines)) {
          if (timeline === null) continue;
          expect(summary).not.toBeNull();
          const checks = reconcile(summary, timeline);
          const failed = checks.filter((c) => !c.ok && c.name !== "lives and hull arithmetic");
          expect({ wave: timeline.wave, failed }).toEqual({ wave: timeline.wave, failed: [] });
          if (checks.some((c) => !c.ok && c.name === "lives and hull arithmetic")) skewed++;
          checked++;
        }
        expect(checked).toBe(end.closedTimelines.length);
        // the exemption is still needed: drop it once PILOT_LIVES no longer skews the replays
        expect(skewed).toBeGreaterThan(0);
      },
      SLOW
    );
  });

  describe("targeted scenarios", () => {
    it.each(TARGETED.map((sc, i) => [sc.name, i] as const))(
      "%s",
      (name, i) => {
        const r = targeted(i, true);
        TARGETED[i]!.expect(r);
        const rec = recordOf(name, r.end);
        recorded.set(name, rec);
        if (!UPDATE) expect(rec).toEqual(golden[SCENARIOS.length + i]);
        expectReconciled(r.end, name === "restore-from-an-older-build-save" ? null : r.closes);
        // bounded: the per-event and run caps hold whatever the scenario does
        for (const tl of r.end.closedTimelines)
          expect(JSON.stringify(tl).length).toBeLessThanOrEqual(1024);
        expect(r.end.closedTimelines.length).toBeLessThanOrEqual(64);
        expect(r.end.closedTimelinesBytes).toBeLessThanOrEqual(16_384);
      },
      SLOW
    );

    it.each(TARGETED.flatMap((sc, i) => (sc.offCheck === false ? [] : [[sc.name, i] as const])))(
      "%s: plays identically with the timeline off",
      (_name, i) => {
        const on = targeted(i, true);
        const off = targeted(i, false);
        expect(off.end.timelineOn).toBe(false);
        expect(sha(off.end)).toBe(sha(on.end));
        expect(off.end.closedWaves).toEqual(on.end.closedWaves);
        expect(off.closes.length).toBe(on.closes.length);
        expect(off.ticks).toBe(on.ticks);
      },
      SLOW
    );
  });
});

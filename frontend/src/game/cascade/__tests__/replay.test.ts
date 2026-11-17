/**
 * Cascade's replay recording (#3858): the log that turns drops, merges and danger moments into
 * units on the shared recorder, what `game_started` carries, the engine's step counter and danger
 * events, the event caps, and `rebuild` refusing what it cannot replay.
 */
import {
  CASCADE_DROP_MAX_BYTES,
  CASCADE_MAX_UNITS,
  CASCADE_MERGE_MAX_BYTES,
  CASCADE_SESSION_MAX_BYTES,
  recordingConfigFor,
} from "../../_shared/eventQueueConfig";
import type { EnqueueEventInput } from "../../_shared/gameEventClient";
import {
  CASCADE_TUNING_ID,
  FIXED_STEP_MS,
  FLOOR_THICKNESS,
  OVERFLOW_IGNORE_MERGE_TICKS,
  OVERFLOW_TICKS_THRESHOLD,
  WORLD_HEIGHT,
} from "../constants";
import { CascadeEngine, ENGINE_VERSION, type EngineEvent } from "../engine";
import { REPLAY_ENGINES, rebuild } from "../rebuild";
import {
  CASCADE_DROPS_PER_UNIT,
  CASCADE_MAX_DANGER,
  DANGER_MIN_TICKS,
  createCascadeLog,
  logEngineEvents,
  newSeeds,
  quantizeX,
  startedData,
  type CascadeRecordSink,
} from "../replay";
import { CAPSTONE_TIER, tierRadius } from "../tiers";
import { recorderInto } from "./helpers/recordedGame";

/** A sink that keeps what the log hands over: one entry per unit. */
function unitsSink() {
  const units: { n: number; events: { type: string; data: Record<string, unknown> }[] }[] = [];
  const sink: CascadeRecordSink = {
    beginUnit: (n) => {
      units.push({ n: n ?? units.length + 1, events: [] });
      return n ?? units.length;
    },
    record: (type, data) => units[units.length - 1]!.events.push({ type, data }),
    closeUnit: () => undefined,
  };
  return { units, sink };
}

describe("quantizeX and the seeds", () => {
  it("drops at a tenth of a pixel, the x the tenths replay to exactly", () => {
    expect(quantizeX(123.456)).toBe(123.5);
    expect(quantizeX(20)).toBe(20);
    for (const x of [21.04, 199.95, 379.99, 100.05]) {
      expect(Math.round(quantizeX(x) * 10) / 10).toBe(quantizeX(x));
    }
  });

  it("draws two seeds in 1..2^31-1 (the queue's generator needs a non-zero seed)", () => {
    expect(newSeeds(() => 0)).toEqual({ queue: 1, engine: 1 });
    const top = newSeeds(() => 0.9999999999);
    expect(top.queue).toBeLessThanOrEqual(0x7fffffff);
    const live = newSeeds();
    expect(Number.isInteger(live.queue) && live.queue > 0).toBe(true);
    expect(Number.isInteger(live.engine) && live.engine > 0).toBe(true);
  });

  it("game_started carries the piece set, both seeds, the tuning and engine_version (no app version yet, #3942)", () => {
    expect(startedData("cosmos", { queue: 5, engine: 9 })).toEqual({
      fruit_set: "cosmos",
      theme: "cosmos",
      seed: 5,
      engine_seed: 9,
      tuning: CASCADE_TUNING_ID,
      engine_version: 1,
    });
    expect(ENGINE_VERSION).toBe(1);
  });
});

describe("the replay log", () => {
  it("hands over a unit every 20 drops: a drop event and a merge event", () => {
    const { units, sink } = unitsSink();
    const log = createCascadeLog(sink);
    log.start();
    for (let i = 0; i < CASCADE_DROPS_PER_UNIT; i += 1) {
      log.drop(i * 60, 100.5, i % 6);
      log.merge(i * 60 + 30, 0);
    }
    expect(units).toHaveLength(1);
    expect(units[0]!.n).toBe(1);
    expect(units[0]!.events.map((e) => e.type)).toEqual(["drop", "merge"]);
    const d = units[0]!.events[0]!.data.d as number[][];
    expect(d).toHaveLength(20);
    expect(d[1]).toEqual([60, 1005, 1]);
    // Each merge is the first of its drop's chain.
    expect(units[0]!.events[1]!.data.m).toContainEqual([90, 0, 1]);
    log.drop(1300, 50, 2);
    log.close();
    expect(units.map((u) => u.n)).toEqual([1, 2]);
    // The 20th drop closed unit 1, so its merge went with the next unit.
    expect(units[1]!.events).toEqual([
      { type: "drop", data: { d: [[1300, 500, 2]] } },
      { type: "merge", data: { m: [[1170, 0, 1]] } },
    ]);
  });

  it("counts a chain from 1 after each drop, and notes the capstone's step", () => {
    const { units, sink } = unitsSink();
    const log = createCascadeLog(sink);
    log.start();
    log.drop(10, 200, 3);
    log.merge(20, 3);
    log.merge(21, 4);
    log.merge(23, CAPSTONE_TIER - 1);
    log.close();
    expect(units[0]!.events[1]!.data.m).toEqual([
      [20, 3, 1],
      [21, 4, 2],
      [23, 9, 3],
    ]);
    expect(log.endData(40)).toEqual({ end_step: 40, capstone_step: 23 });
  });

  it("records a merge with no drop waiting as a merge-only unit, and nothing for an empty close", () => {
    const { units, sink } = unitsSink();
    const log = createCascadeLog(sink);
    log.start();
    log.close();
    expect(units).toHaveLength(0);
    log.merge(5, 1);
    log.close();
    expect(units[0]!.events).toEqual([{ type: "merge", data: { m: [[5, 1, 1]] } }]);
  });

  it("keeps danger moments of DANGER_MIN_TICKS or more, at most CASCADE_MAX_DANGER, and the first lid step", () => {
    const { units, sink } = unitsSink();
    const log = createCascadeLog(sink);
    log.start();
    log.danger(100, DANGER_MIN_TICKS - 1); // a flicker: only the lid step
    log.danger(200, OVERFLOW_TICKS_THRESHOLD);
    for (let i = 0; i < CASCADE_MAX_DANGER + 3; i += 1) log.danger(300 + i, 50);
    log.close();
    const z = units[0]!.events[0]!.data.z as number[][];
    expect(units[0]!.events[0]!.data.d).toEqual([]);
    expect(z).toHaveLength(CASCADE_MAX_DANGER);
    expect(z[0]).toEqual([200, OVERFLOW_TICKS_THRESHOLD]);
    expect(log.endData(400)).toEqual({ end_step: 400, lid_step: 100, z_cut: 4 });
  });

  it("stops at CASCADE_MAX_UNITS units and says how many it left out", () => {
    const { units, sink } = unitsSink();
    const log = createCascadeLog(sink);
    log.start();
    for (let u = 0; u < CASCADE_MAX_UNITS + 3; u += 1) {
      log.drop(u, 100, 0);
      log.close(); // a background flush after every drop: the costliest case
    }
    expect(units).toHaveLength(CASCADE_MAX_UNITS);
    expect(units.at(-1)!.n).toBe(CASCADE_MAX_UNITS);
    expect(log.endData(9)).toEqual({ end_step: 9, rec_cut: 3 });
    expect(log.saveState()).toEqual({
      unit: CASCADE_MAX_UNITS,
      danger: 0,
      unitsCut: 3,
      dangerCut: 0,
    });
  });

  it("a restored game numbers its units after the save's and marks the first one", () => {
    const { units, sink } = unitsSink();
    const log = createCascadeLog(sink);
    log.start();
    log.restored({ unit: 6 });
    expect(log.saveState().unit).toBe(7); // the restored mark waits as unit 7
    log.drop(12, 150, 1);
    log.close();
    expect(units[0]).toEqual({
      n: 7,
      events: [{ type: "drop", data: { d: [[12, 1500, 1]], rs: 1 } }],
    });
    log.drop(30, 150, 1);
    log.close();
    expect(units[1]!.n).toBe(8);
    expect(units[1]!.events[0]!.data).not.toHaveProperty("rs");
    // A save from an older build (no unit) or a lower one never moves the numbering back.
    log.restored(undefined);
    log.restored({ unit: Number.NaN });
    log.restored({ unit: 2 });
    log.close();
    expect(units[2]!.n).toBe(9);
  });

  it("a restored game keeps its per-game cap counts: they are not reset by the relaunch", () => {
    const { units, sink } = unitsSink();
    const before = createCascadeLog(sink);
    before.start();
    for (let i = 0; i < CASCADE_MAX_DANGER - 2; i += 1) before.danger(i, 50);
    const saved = before.saveState();
    expect(saved).toEqual({ unit: 1, danger: CASCADE_MAX_DANGER - 2, unitsCut: 0, dangerCut: 0 });
    // The relaunch: a new log, started, then restored from the save.
    const after = createCascadeLog(sink);
    after.start();
    after.restored(saved);
    for (let i = 0; i < 5; i += 1) after.danger(1000 + i, 50);
    after.close();
    expect(units.at(-1)!.events[0]!.data.z).toHaveLength(2);
    expect(after.endData(2000)).toMatchObject({ z_cut: 3 });
  });

  it("a test seam's reseed marks the next unit as not re-simulable", () => {
    const { units, sink } = unitsSink();
    const log = createCascadeLog(sink);
    log.start();
    log.drop(5, 100, 0);
    log.markUnreplayable();
    log.close();
    expect(units[0]!.events[0]!.data).toEqual({ d: [[5, 1000, 0]], rs: 1 });
  });

  it("the engine's open danger moment is flushed when a game ends without the engine ending it", () => {
    const engine = new CascadeEngine({ seed: 1 });
    expect(engine.flushDanger()).toEqual([]);
    const pieces: { tier: number; x: number; y: number }[] = [];
    let bottom = WORLD_HEIGHT - FLOOR_THICKNESS;
    for (const tier of [10, 9, 7, 4]) {
      pieces.push({ tier, x: 121, y: bottom - tierRadius(tier) });
      bottom -= 2 * tierRadius(tier);
    }
    engine.restore(pieces, 0);
    for (let i = 0; i < 150; i += 1) engine.step(FIXED_STEP_MS);
    const start = OVERFLOW_IGNORE_MERGE_TICKS + 1;
    expect(engine.flushDanger()).toEqual([{ type: "danger", start, peak: 150 - start + 1 }]);
    expect(engine.flushDanger()).toEqual([]); // closed: flushed once
    engine.destroy();
  });

  it("start() clears the last game", () => {
    const { units, sink } = unitsSink();
    const log = createCascadeLog(sink);
    log.start();
    log.drop(1, 30, 0);
    log.merge(2, CAPSTONE_TIER - 1);
    log.danger(3, 60);
    log.start();
    log.close();
    expect(units).toHaveLength(0);
    expect(log.endData(0)).toEqual({ end_step: 0 });
  });

  it("logEngineEvents takes the merges and danger moments, nothing else", () => {
    const { units, sink } = unitsSink();
    const log = createCascadeLog(sink);
    log.start();
    const events: EngineEvent[] = [
      { type: "score", delta: 2, total: 2 },
      {
        type: "merge",
        tierA: 2,
        tierB: 2,
        result: 3,
        x: 1,
        y: 2,
        id: 9,
        parentIds: [1, 2],
        step: 44,
      },
      { type: "land", id: 3, tier: 1, x: 0, y: 0, speed: 1 },
      { type: "danger", start: 40, peak: 30 },
      { type: "gameOver", reason: "overflow" },
    ];
    logEngineEvents(log, events);
    log.close();
    expect(units[0]!.events).toEqual([
      { type: "drop", data: { d: [], z: [[40, 30]] } },
      { type: "merge", data: { m: [[44, 2, 1]] } },
    ]);
  });
});

describe("the event caps (eventQueueConfig)", () => {
  it("register drop (1 KB, never split) and merge (1 KB, split on m), 32 KB a session", () => {
    const config = recordingConfigFor("cascade");
    expect(config.sessionMaxBytes).toBe(CASCADE_SESSION_MAX_BYTES);
    expect(config.events.drop).toEqual({ maxBytes: CASCADE_DROP_MAX_BYTES });
    expect(config.events.merge).toEqual({ maxBytes: CASCADE_MERGE_MAX_BYTES, chunkField: "m" });
  });

  it("the widest honest drop event, with the envelope, fits its cap", () => {
    const saves: EnqueueEventInput[][] = [];
    const recorder = recorderInto(saves, () => 2_147_483_647);
    recorder.beginUnit(CASCADE_MAX_UNITS);
    const d = Array.from({ length: CASCADE_DROPS_PER_UNIT }, () => [999_999, 3800, 5]);
    const z = Array.from({ length: CASCADE_MAX_DANGER }, () => [999_999, OVERFLOW_TICKS_THRESHOLD]);
    recorder.record("drop", { d, z, rs: 1 });
    recorder.endSession();
    const size = JSON.stringify(saves[0]![0]!.data).length;
    expect(size).toBeLessThanOrEqual(CASCADE_DROP_MAX_BYTES);
  });

  it("an oversized merge event is split on m into parts, whole and in order", () => {
    const saves: EnqueueEventInput[][] = [];
    const recorder = recorderInto(saves);
    const m = Array.from({ length: 120 }, (_, i) => [30_000 + i, i % 9, i + 1]);
    recorder.record("merge", { m });
    recorder.endSession();
    const parts = saves.flat();
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flatMap((p) => p.data!.m as unknown[])).toEqual(m);
    for (const p of parts) {
      expect(JSON.stringify(p.data).length).toBeLessThanOrEqual(CASCADE_MERGE_MAX_BYTES);
    }
  });
});

describe("the engine's step counter and danger events", () => {
  it("counts fixed steps, whatever the frame lengths", () => {
    const engine = new CascadeEngine({ seed: 1 });
    expect(engine.steps).toBe(0);
    engine.step(FIXED_STEP_MS);
    engine.step(FIXED_STEP_MS / 2);
    engine.step(FIXED_STEP_MS / 2);
    engine.step(45); // a hitch: two fixed steps
    expect(engine.steps).toBe(4);
    engine.destroy();
  });

  it("a merge carries the fixed step it happened in", () => {
    const engine = new CascadeEngine({ seed: 1 });
    const r = tierRadius(0);
    engine.restore(
      [
        { tier: 0, x: 200 - r, y: 580 - r },
        { tier: 0, x: 200 + r, y: 580 - r },
      ],
      0
    );
    const merges: Extract<EngineEvent, { type: "merge" }>[] = [];
    for (let i = 0; i < 30 && merges.length === 0; i += 1) {
      for (const ev of engine.step(FIXED_STEP_MS).events) if (ev.type === "merge") merges.push(ev);
    }
    expect(merges[0]!.step).toBe(engine.steps);
    engine.destroy();
  });

  it("a pile held over the lid ends the game with one danger event at the threshold", () => {
    // engine.lid.test.ts's COLUMN: a capstone and tiers 9, 7 and 4 stacked at x = 121, the top
    // edge over the lid, and a Cherry in the empty lane. Restore's grace, then the full count.
    const pieces: { tier: number; x: number; y: number }[] = [];
    let bottom = WORLD_HEIGHT - FLOOR_THICKNESS;
    for (const tier of [10, 9, 7, 4]) {
      pieces.push({ tier, x: 121, y: bottom - tierRadius(tier) });
      bottom -= 2 * tierRadius(tier);
    }
    pieces.push({ tier: 0, x: 360, y: WORLD_HEIGHT - FLOOR_THICKNESS - tierRadius(0) });
    const engine = new CascadeEngine({ seed: 1 });
    engine.restore(pieces, 0);
    const events: EngineEvent[] = [];
    for (let i = 0; i < 600 && !engine.getState().gameOver; i += 1) {
      events.push(...engine.step(FIXED_STEP_MS).events);
    }
    expect(events.filter((e) => e.type !== "land")).toEqual([
      {
        type: "danger",
        start: OVERFLOW_IGNORE_MERGE_TICKS + 1,
        peak: OVERFLOW_TICKS_THRESHOLD,
      },
      { type: "gameOver", reason: "overflow" },
    ]);
    expect(engine.steps).toBe(OVERFLOW_IGNORE_MERGE_TICKS + OVERFLOW_TICKS_THRESHOLD);
    engine.destroy();
  });

  it("a restore drops a running count without an event: the restored board starts afresh", () => {
    const engine = new CascadeEngine({ seed: 1 });
    const pieces: { tier: number; x: number; y: number }[] = [];
    let bottom = WORLD_HEIGHT - FLOOR_THICKNESS;
    for (const tier of [10, 9, 7, 4]) {
      pieces.push({ tier, x: 121, y: bottom - tierRadius(tier) });
      bottom -= 2 * tierRadius(tier);
    }
    engine.restore(pieces, 0);
    const events: EngineEvent[] = [];
    for (let i = 0; i < OVERFLOW_IGNORE_MERGE_TICKS + 40; i += 1) {
      events.push(...engine.step(FIXED_STEP_MS).events);
    }
    // The count has run 40 steps; a restore (a relaunch, a test set-up) is a new board.
    engine.restore(pieces, 0);
    events.push(...engine.step(FIXED_STEP_MS).events);
    expect(events.filter((e) => e.type === "danger")).toEqual([]);
    engine.destroy();
  });
});

describe("rebuild refuses what it cannot replay", () => {
  const started = startedData("fruits", { queue: 3, engine: 4 });
  const drop = (d: unknown, extra: Record<string, unknown> = {}) => ({
    type: "drop",
    data: { d, ...extra, v: 1, unit: 1, t_ms: 0 },
  });

  it("an engine_version it does not know", () => {
    const r = rebuild({ ...started, engine_version: 2 }, []);
    expect(r).toEqual({
      ok: false,
      reason: "incompatible engine: engine_version 2, this reader rebuilds 1",
    });
  });

  it("another tuning, no engine seed, a restored game, a malformed or out-of-order drop", () => {
    expect(rebuild({ ...started, tuning: "old" }, [])).toMatchObject({ ok: false });
    expect(rebuild({ ...started, engine_seed: undefined }, [])).toMatchObject({ ok: false });
    expect(rebuild(started, [drop([[1, 2000, 0]], { rs: 1 })])).toEqual({
      ok: false,
      reason: "a restored game: not re-simulated",
    });
    expect(rebuild(started, [drop([[1, 2000]])])).toMatchObject({ ok: false });
    expect(
      rebuild(started, [
        drop([
          [60, 2000, 0],
          [30, 2000, 0],
        ]),
      ])
    ).toEqual({ ok: false, reason: "a drop out of order at step 30" });
  });

  it("replays a short game: the drops land, at the recorded steps", () => {
    const r = rebuild(started, [drop([[0, 2000, 0]]), drop([[90, 2000, 0]])], 400);
    expect(r).toMatchObject({ ok: true, drops: 2, outcome: null, endStep: 400 });
    expect(r.ok && r.merges.length).toBe(1); // two cherries, one on the other, merge
    expect(r.ok && r.score).toBe(2);
  });

  it("is keyed by the version the app records today", () => {
    expect(REPLAY_ENGINES.current).toBe(ENGINE_VERSION);
    expect(REPLAY_ENGINES.resolve(started).kind).toBe("current");
  });
});

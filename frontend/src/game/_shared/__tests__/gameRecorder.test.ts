/**
 * GameRecorder unit tests (#3274): envelope, ordering, the two send policies,
 * the size caps (chunk or report, never stub) and the session's end.
 */

import * as Sentry from "@sentry/react-native";

import type { EnqueueEventInput } from "../gameEventClient";
import {
  DEFAULT_RECORDING_CONFIG,
  WAVE_STATS_MAX_BYTES,
  WAVE_STATS_RUN_MAX_BYTES,
  logConfig,
  recordingConfigFor,
  recordingEventCap,
  resetLogConfig,
  type GameRecordingConfig,
} from "../eventQueueConfig";
import {
  GameRecorder,
  scheduleIdle,
  type GameRecorderOptions,
  type RecordingDropReport,
} from "../gameRecorder";

interface Harness {
  recorder: GameRecorder;
  /** Each sink call, in order. */
  saves: EnqueueEventInput[][];
  /** Scheduled tasks not run yet; `runIdle()` runs them. */
  tasks: (() => void)[];
  runIdle: () => void;
  reports: RecordingDropReport[];
  clock: { t: number };
}

function harness(overrides: Partial<GameRecorderOptions> = {}): Harness {
  const saves: EnqueueEventInput[][] = [];
  const tasks: (() => void)[] = [];
  const reports: RecordingDropReport[] = [];
  const clock = { t: 1000 };
  const recorder = new GameRecorder({
    gameType: "hearts",
    sink: (events) => saves.push([...events]),
    now: () => clock.t,
    schedule: (task) => tasks.push(task),
    report: (r) => reports.push(r),
    ...overrides,
  });
  const runIdle = () => {
    while (tasks.length > 0) tasks.shift()?.();
  };
  return { recorder, saves, tasks, runIdle, reports, clock };
}

const all = (saves: EnqueueEventInput[][]) => saves.flat();

describe("GameRecorder", () => {
  afterEach(() => {
    resetLogConfig();
    jest.clearAllMocks();
  });

  describe("envelope", () => {
    it("stamps v, unit, t_ms and actor on every event", () => {
      const h = harness();
      h.recorder.startSession();
      h.recorder.beginUnit(3);
      h.clock.t = 1250;
      h.recorder.record(
        "card_played",
        { c: "QS" },
        { seat: 2, kind: "cpu", cpu_type: "shark", difficulty: "hard" }
      );
      h.clock.t = 1400;
      h.recorder.record("trick_won", { by: 2 });
      h.recorder.endSession();
      expect(all(h.saves)).toEqual([
        {
          type: "card_played",
          data: {
            c: "QS",
            v: 1,
            unit: 3,
            t_ms: 250,
            actor: { seat: 2, kind: "cpu", cpu_type: "shark", difficulty: "hard" },
          },
        },
        { type: "trick_won", data: { by: 2, v: 1, unit: 3, t_ms: 400 } },
      ]);
    });

    it("writes the type's schema version as v", () => {
      const config: GameRecordingConfig = {
        ...DEFAULT_RECORDING_CONFIG,
        events: { roll: { maxBytes: 512, v: 4 } },
      };
      const h = harness({ config });
      h.recorder.record("roll", { d: [1, 2] });
      h.recorder.endSession();
      expect(all(h.saves)[0]?.data?.v).toBe(4);
    });

    it("numbers units from 1 by default and counts t_ms from the session's start", () => {
      const h = harness();
      h.recorder.startSession();
      h.clock.t = 1100;
      expect(h.recorder.beginUnit()).toBe(1);
      h.recorder.record("a");
      expect(h.recorder.beginUnit()).toBe(2); // closes unit 1
      h.clock.t = 1300;
      h.recorder.record("b");
      h.recorder.endSession();
      const data = all(h.saves).map((e) => [e.type, e.data?.unit, e.data?.t_ms]);
      expect(data).toEqual([
        ["a", 1, 100],
        ["b", 2, 300],
      ]);
    });

    it("opens a unit (and a session) for a record with none open", () => {
      const h = harness();
      h.recorder.record("move", { x: 1 });
      h.recorder.endSession();
      expect(all(h.saves)).toEqual([{ type: "move", data: { x: 1, v: 1, unit: 1, t_ms: 0 } }]);
    });

    it("writes the envelope over data fields of the same name", () => {
      const h = harness();
      h.recorder.record("move", { unit: 99, v: 99, t_ms: -1, part: 5, parts: 6, actor: "x" });
      h.recorder.endSession();
      expect(all(h.saves)[0]?.data).toEqual({ unit: 1, v: 1, t_ms: 0 });
    });

    it("restarts units and t_ms for the next session", () => {
      const h = harness();
      h.recorder.startSession();
      h.recorder.beginUnit(5);
      h.recorder.record("a");
      h.recorder.endSession();
      h.clock.t = 9000;
      h.recorder.startSession();
      h.clock.t = 9010;
      h.recorder.record("b");
      h.recorder.endSession();
      expect(all(h.saves)[1]?.data).toEqual({ v: 1, unit: 1, t_ms: 10 });
    });
  });

  describe("on_unit_close", () => {
    it("saves a closed unit at the next idle moment, not inside closeUnit", () => {
      const h = harness();
      h.recorder.beginUnit();
      h.recorder.record("a");
      h.recorder.record("b");
      h.recorder.closeUnit();
      expect(h.saves).toHaveLength(0);
      expect(h.tasks).toHaveLength(1);
      h.runIdle();
      expect(h.saves).toHaveLength(1);
      expect(h.saves[0]?.map((e) => e.type)).toEqual(["a", "b"]);
    });

    it("saves units closed before the idle callback together, in order, with one schedule", () => {
      const h = harness();
      for (const n of [1, 2, 3]) {
        h.recorder.beginUnit(n);
        h.recorder.record(`e${n}a`);
        h.recorder.record(`e${n}b`);
        h.recorder.closeUnit();
      }
      expect(h.tasks).toHaveLength(1);
      h.runIdle();
      expect(h.saves).toHaveLength(1);
      expect(h.saves[0]?.map((e) => e.type)).toEqual(["e1a", "e1b", "e2a", "e2b", "e3a", "e3b"]);
    });

    it("saves each unit separately when idle runs between them", () => {
      const h = harness();
      h.recorder.record("a");
      h.recorder.closeUnit();
      h.runIdle();
      h.recorder.record("b");
      h.recorder.closeUnit();
      h.runIdle();
      expect(h.saves.map((s) => s.map((e) => e.type))).toEqual([["a"], ["b"]]);
    });

    it("saves nothing for an empty unit", () => {
      const h = harness();
      h.recorder.beginUnit();
      h.recorder.closeUnit();
      expect(h.tasks).toHaveLength(0);
      h.recorder.endSession();
      expect(h.saves).toHaveLength(0);
    });

    it("saves what is still waiting, the open unit too, synchronously at endSession", () => {
      const h = harness();
      h.recorder.record("a");
      h.recorder.closeUnit(); // scheduled, not run
      h.recorder.beginUnit();
      h.recorder.record("b"); // still open
      h.recorder.endSession();
      expect(h.saves).toEqual([
        [
          { type: "a", data: { v: 1, unit: 1, t_ms: 0 } },
          { type: "b", data: { v: 1, unit: 2, t_ms: 0 } },
        ],
      ]);
      h.runIdle(); // the late idle callback finds nothing to save
      expect(h.saves).toHaveLength(1);
    });
  });

  describe("on_session_end", () => {
    it("keeps closed units in memory and saves the session in one call at its end", () => {
      const h = harness({ policy: "on_session_end" });
      for (const n of [1, 2, 3]) {
        h.recorder.beginUnit(n);
        h.recorder.record("wave", { n });
        h.recorder.closeUnit();
      }
      expect(h.tasks).toHaveLength(0);
      h.runIdle();
      expect(h.saves).toHaveLength(0);
      h.recorder.endSession();
      expect(h.saves).toHaveLength(1);
      expect(h.saves[0]?.map((e) => e.data?.n)).toEqual([1, 2, 3]);
    });

    it("endSession with nothing recorded saves and reports nothing", () => {
      const h = harness({ policy: "on_session_end" });
      h.recorder.startSession();
      h.recorder.endSession();
      h.recorder.endSession();
      expect(h.saves).toHaveLength(0);
      expect(h.reports).toHaveLength(0);
    });
  });

  describe("size caps", () => {
    const config: GameRecordingConfig = {
      sessionMaxBytes: 64 * 1024,
      defaultEventMaxBytes: 200,
      events: { trace: { maxBytes: 200, chunkField: "pts" } },
    };

    it("splits an oversized chunkable event into parts that each fit, in order", () => {
      const h = harness({ config });
      const pts = Array.from({ length: 60 }, (_, i) => i * 3);
      h.recorder.record("trace", { id: 7, pts });
      h.recorder.endSession();
      const parts = all(h.saves);
      expect(parts.length).toBeGreaterThan(1);
      parts.forEach((p, i) => {
        expect(p.type).toBe("trace");
        expect(JSON.stringify(p.data).length).toBeLessThanOrEqual(200);
        expect(p.data).toMatchObject({
          id: 7,
          v: 1,
          unit: 1,
          t_ms: 0,
          part: i,
          parts: parts.length,
        });
      });
      expect(parts.flatMap((p) => p.data?.pts as number[])).toEqual(pts);
      expect(h.reports).toHaveLength(0);
    });

    it("drops an oversized event of a type that cannot be split and reports it by counts and sizes", () => {
      const h = harness({ config });
      h.recorder.record("small", { a: 1 });
      h.recorder.record("blob", { s: "x".repeat(500) });
      h.recorder.record("small", { a: 2 });
      h.recorder.endSession();
      expect(all(h.saves).map((e) => e.data?.a)).toEqual([1, 2]);
      expect(h.reports).toEqual([
        {
          game_type: "hearts",
          recorded: 3,
          saved: 2,
          chunked: 0,
          parts: 0,
          dropped_oversize: 1,
          dropped_session_cap: 0,
          saved_bytes: expect.any(Number),
          largest_bytes: expect.any(Number),
        },
      ]);
      expect(h.reports[0]?.largest_bytes).toBeGreaterThan(500);
    });

    it("drops a chunkable event when one item cannot fit a part on its own", () => {
      const h = harness({ config });
      h.recorder.record("trace", { pts: ["y".repeat(300), 1] });
      h.recorder.endSession();
      expect(h.saves).toHaveLength(0);
      expect(h.reports[0]?.dropped_oversize).toBe(1);
    });

    it("never hands the store an event it would stub: the per-event cap stays under the queue's row cap", () => {
      logConfig.MAX_EVENT_PAYLOAD_BYTES = 100;
      const big: GameRecordingConfig = { ...config, defaultEventMaxBytes: 10_000 };
      expect(recordingEventCap(big, "anything")).toBe(100);
      const h = harness({ config: big });
      h.recorder.record("blob", { s: "x".repeat(150) });
      h.recorder.record("ok", { s: "x".repeat(20) });
      h.recorder.endSession();
      for (const e of all(h.saves)) {
        expect(JSON.stringify(e.data).length).toBeLessThanOrEqual(
          logConfig.MAX_EVENT_PAYLOAD_BYTES
        );
        expect(e.data).not.toHaveProperty("_truncated");
      }
      expect(h.reports[0]?.dropped_oversize).toBe(1);
    });

    it("stops at the session cap: a clean prefix, the rest dropped and reported once", () => {
      const tight: GameRecordingConfig = { ...config, sessionMaxBytes: 200 };
      const h = harness({ config: tight });
      for (let i = 0; i < 10; i += 1) h.recorder.record("e", { i, pad: "p".repeat(20) });
      h.recorder.record("tiny");
      h.recorder.endSession();
      const saved = all(h.saves);
      const bytes = saved.reduce((n, e) => n + JSON.stringify(e.data).length, 0);
      expect(bytes).toBeLessThanOrEqual(200);
      expect(saved.map((e) => e.data?.i)).toEqual(saved.map((_, i) => i));
      expect(h.reports).toHaveLength(1);
      expect(h.reports[0]).toMatchObject({
        recorded: 11,
        saved: saved.length,
        dropped_session_cap: 11 - saved.length,
        saved_bytes: bytes,
      });
    });

    it("reports to Sentry by default, by counts and sizes only, once per session", () => {
      const h = harness({ config, report: undefined });
      h.recorder.record("blob", { secret: "x".repeat(500) });
      h.recorder.record("blob", { secret: "x".repeat(500) });
      h.recorder.endSession();
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      const [, ctx] = (Sentry.captureMessage as jest.Mock).mock.calls[0] as [
        string,
        { extra: Record<string, unknown> },
      ];
      expect(JSON.stringify(ctx)).not.toContain("xxx");
      expect(ctx.extra.dropped_oversize).toBe(2);
    });
  });

  describe("performance rules", () => {
    it("does not serialise anything while recording", () => {
      const h = harness();
      const spy = jest.spyOn(JSON, "stringify");
      h.recorder.beginUnit();
      for (let i = 0; i < 50; i += 1) h.recorder.record("move", { i });
      h.recorder.closeUnit();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("adds no Sentry breadcrumb or console output per event", () => {
      const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
      const h = harness();
      for (let i = 0; i < 20; i += 1) h.recorder.record("move", { i });
      h.recorder.endSession();
      expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    });

    it("schedules saves without timers when requestIdleCallback is missing", async () => {
      const g = globalThis as { requestIdleCallback?: unknown };
      const saved = g.requestIdleCallback;
      delete g.requestIdleCallback;
      const timeout = jest.spyOn(global, "setTimeout");
      const task = jest.fn();
      scheduleIdle(task);
      expect(task).not.toHaveBeenCalled();
      await Promise.resolve();
      expect(task).toHaveBeenCalledTimes(1);
      expect(timeout).not.toHaveBeenCalled();
      timeout.mockRestore();
      if (saved !== undefined) g.requestIdleCallback = saved;
    });

    it("uses requestIdleCallback when the runtime has it", () => {
      const g = globalThis as { requestIdleCallback?: unknown };
      const saved = g.requestIdleCallback;
      const ric = jest.fn();
      g.requestIdleCallback = ric;
      const task = jest.fn();
      scheduleIdle(task);
      expect(ric).toHaveBeenCalledWith(task);
      if (saved === undefined) delete g.requestIdleCallback;
      else g.requestIdleCallback = saved;
    });
  });

  describe("recording dial (#3279 hook point)", () => {
    it("records nothing for a session the dial turns off, read once at its start", () => {
      const enabled = jest.fn(() => false);
      const h = harness({ enabled });
      h.recorder.startSession();
      h.recorder.record("move");
      h.recorder.record("move");
      h.recorder.endSession();
      expect(h.saves).toHaveLength(0);
      expect(enabled).toHaveBeenCalledTimes(1);
      expect(enabled).toHaveBeenCalledWith("hearts");
    });
  });

  describe("sink", () => {
    it("keeps closed units until a sink is set", () => {
      const h = harness({ sink: undefined });
      const saves: EnqueueEventInput[][] = [];
      h.recorder.record("a");
      h.recorder.closeUnit();
      h.runIdle();
      h.recorder.setSink((events) => saves.push([...events]));
      h.recorder.endSession();
      expect(saves).toEqual([[{ type: "a", data: { v: 1, unit: 1, t_ms: 0 } }]]);
    });

    it("isolates a throwing sink", () => {
      const h = harness({
        sink: () => {
          throw new Error("boom");
        },
      });
      h.recorder.record("a");
      expect(() => h.recorder.endSession()).not.toThrow();
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });
  });
});

describe("recording caps config", () => {
  it("holds Star Swarm's wave caps (moved from the engine)", () => {
    const ss = recordingConfigFor("starswarm");
    expect(WAVE_STATS_MAX_BYTES).toBe(4096);
    expect(WAVE_STATS_RUN_MAX_BYTES).toBe(64 * 1024);
    expect(ss.sessionMaxBytes).toBe(WAVE_STATS_RUN_MAX_BYTES);
    expect(recordingEventCap(ss, "wave_completed")).toBe(WAVE_STATS_MAX_BYTES);
  });

  it("gives a game without an entry the defaults", () => {
    expect(recordingConfigFor("yacht")).toBe(DEFAULT_RECORDING_CONFIG);
  });
});

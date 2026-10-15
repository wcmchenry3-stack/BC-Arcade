/**
 * GameRecorder unit tests (#3274): envelope, ordering, the two send policies,
 * the size caps (chunk or report, never stub) and the session's end.
 */

import * as Sentry from "@sentry/react-native";

import type { EnqueueEventInput } from "../gameEventClient";
import {
  DEFAULT_RECORDING_CONFIG,
  RECORDER_IDLE_TIMEOUT_MS,
  RECORDER_MAX_RAW_EVENTS,
  RECORDER_MEASURE_EVERY,
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
  memoryEventCeiling,
  scheduleIdle,
  type GameRecorderOptions,
  type RecorderSink,
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

/** A sink from an enqueue function; it can always accept unless told otherwise. */
function sinkOf(
  enqueueMany: (events: readonly EnqueueEventInput[]) => boolean,
  canAccept: () => boolean = () => true
): RecorderSink {
  return { canAccept, enqueueMany };
}

function harness(overrides: Partial<GameRecorderOptions> = {}): Harness {
  const saves: EnqueueEventInput[][] = [];
  const tasks: (() => void)[] = [];
  const reports: RecordingDropReport[] = [];
  const clock = { t: 1000 };
  const recorder = new GameRecorder({
    gameType: "hearts",
    sink: sinkOf((events) => {
      saves.push([...events]);
      return true;
    }),
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

    describe("envelope: false (#3280)", () => {
      const config: GameRecordingConfig = {
        ...DEFAULT_RECORDING_CONFIG,
        sessionMaxBytes: 200,
        events: {
          bare: { maxBytes: 40, envelope: false },
          bareChunk: { maxBytes: 40, envelope: false, chunkField: "items" },
          framed: { maxBytes: 80 },
        },
      };

      it("with the envelope (the default), v / unit / t_ms are added and counted", () => {
        const h = harness({ config });
        h.recorder.record("framed", { a: 1 }, { seat: 1, kind: "human" });
        h.recorder.endSession();
        expect(all(h.saves)).toEqual([
          {
            type: "framed",
            data: { a: 1, v: 1, unit: 1, t_ms: 0, actor: { seat: 1, kind: "human" } },
          },
        ]);
      });

      it("without it, sends data exactly as recorded: no v, unit, t_ms or actor", () => {
        const h = harness({ config });
        h.clock.t = 5000;
        const data = { wave: 3, outcome: "cleared", v: 7 };
        h.recorder.record("bare", data, { seat: 1, kind: "human" });
        h.recorder.endSession();
        expect(all(h.saves)).toEqual([
          { type: "bare", data: { wave: 3, outcome: "cleared", v: 7 } },
        ]);
        expect(JSON.stringify(all(h.saves)[0]?.data)).toBe(JSON.stringify(data));
      });

      it("measures what it sends: JSON of the data alone against the cap and the session", () => {
        const h = harness({ config });
        const data = { k: "x".repeat(40 - `{"k":""}`.length) };
        expect(JSON.stringify(data).length).toBe(40); // exactly the cap: an envelope would not fit
        h.recorder.record("bare", data);
        h.recorder.record("bare", { k: "x".repeat(41 - `{"k":""}`.length) }); // one over
        h.recorder.endSession();
        expect(all(h.saves)).toHaveLength(1);
        expect(h.reports[0]).toMatchObject({
          saved: 1,
          dropped_oversize: 1,
          saved_bytes: 40,
          largest_bytes: 41,
        });
      });

      it("is never chunked: an oversized event is dropped, not split", () => {
        const h = harness({ config });
        h.recorder.record("bareChunk", { items: ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb", "cccc"] });
        h.recorder.endSession();
        expect(all(h.saves)).toEqual([]);
        expect(h.reports[0]).toMatchObject({ dropped_oversize: 1, chunked: 0, parts: 0 });
      });

      it("a mix keeps each type's own form, in order", () => {
        const h = harness({ config });
        h.recorder.record("bare", { n: 1 });
        h.recorder.record("framed", { n: 2 });
        h.recorder.endSession();
        expect(all(h.saves).map((e) => e.data)).toEqual([
          { n: 1 },
          { n: 2, v: 1, unit: 1, t_ms: 0 },
        ]);
      });
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
    it("measures closed units at idle, holds them, and saves the session in one call at its end", () => {
      const h = harness({ policy: "on_session_end" });
      for (const n of [1, 2, 3]) {
        h.recorder.beginUnit(n);
        h.recorder.record("wave", { n });
        h.recorder.closeUnit();
      }
      expect(h.tasks).toHaveLength(1); // one measuring task, not a save
      expect(h.recorder.held).toBe(3);
      h.runIdle();
      expect(h.recorder.held).toBe(0); // measured: the raw events are released
      expect(h.saves).toHaveLength(0);
      h.recorder.endSession();
      expect(h.saves).toHaveLength(1);
      expect(h.saves[0]?.map((e) => e.data?.n)).toEqual([1, 2, 3]);
    });

    it("releases an oversized event at idle and trips the session cap early", () => {
      const config: GameRecordingConfig = {
        sessionMaxBytes: 100,
        defaultEventMaxBytes: 80,
        events: {},
      };
      const h = harness({ policy: "on_session_end", config });
      h.recorder.record("blob", { s: "x".repeat(500) }); // oversize
      for (let i = 0; i < 4; i += 1) h.recorder.record("e", { pad: "p".repeat(10) });
      h.recorder.closeUnit();
      h.runIdle(); // measured: the blob is gone, and the session is full
      expect(h.recorder.held).toBe(0);
      h.recorder.record("late", { i: 1 }); // full: not kept
      expect(h.recorder.held).toBe(0);
      h.recorder.endSession();
      expect(h.saves).toHaveLength(1);
      expect(h.reports[0]).toMatchObject({ dropped_oversize: 1 });
      expect(h.reports[0]?.dropped_session_cap).toBeGreaterThanOrEqual(2);
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
          dropped_invalid: 0,
          dropped_unsent: 0,
          dropped_memory: 0,
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

    it("sends the drop report through the Sentry throttle, keyed by game type", () => {
      for (let session = 0; session < 3; session += 1) {
        const h = harness({ config, report: undefined });
        h.recorder.record("blob", { s: "x".repeat(500) });
        h.recorder.endSession();
      }
      // one per key per app session, however many sessions dropped events
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      const [, ctx] = (Sentry.captureMessage as jest.Mock).mock.calls[0] as [
        string,
        { level: string; fingerprint: string[]; tags: Record<string, string> },
      ];
      expect(ctx.level).toBe("warning");
      expect(ctx.fingerprint).toEqual(["gameRecorder.drop.hearts"]);
      expect(ctx.tags.game_type).toBe("hearts");
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

    it("falls back to setTimeout(task, 0) when requestIdleCallback is missing", () => {
      const g = globalThis as { requestIdleCallback?: unknown };
      const saved = g.requestIdleCallback;
      delete g.requestIdleCallback;
      const timeout = jest.spyOn(global, "setTimeout");
      const task = jest.fn();
      scheduleIdle(task);
      expect(task).not.toHaveBeenCalled();
      expect(timeout).toHaveBeenCalledWith(task, 0);
      timeout.mockRestore();
      if (saved !== undefined) g.requestIdleCallback = saved;
    });

    it("uses requestIdleCallback with RN's own timeout deadline when the runtime has it", () => {
      const g = globalThis as { requestIdleCallback?: unknown };
      const saved = g.requestIdleCallback;
      const ric = jest.fn();
      g.requestIdleCallback = ric;
      const timeout = jest.spyOn(global, "setTimeout");
      const task = jest.fn();
      scheduleIdle(task);
      expect(ric).toHaveBeenCalledWith(task, { timeout: RECORDER_IDLE_TIMEOUT_MS });
      expect(RECORDER_IDLE_TIMEOUT_MS).toBe(2000);
      expect(timeout).not.toHaveBeenCalled();
      timeout.mockRestore();
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
      h.recorder.setSink(
        sinkOf((events) => {
          saves.push([...events]);
          return true;
        })
      );
      h.recorder.endSession();
      expect(saves).toEqual([[{ type: "a", data: { v: 1, unit: 1, t_ms: 0 } }]]);
    });

    it("isolates a throwing sink", () => {
      const h = harness({
        sink: sinkOf(() => {
          throw new Error("boom");
        }),
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
    expect(recordingConfigFor("hearts")).toBe(DEFAULT_RECORDING_CONFIG);
  });
});

describe("GameRecorder review fixes (#3315)", () => {
  afterEach(() => {
    resetLogConfig();
    jest.clearAllMocks();
  });

  it("drops an event that cannot be serialised as invalid, and saves the rest", () => {
    const h = harness();
    const cycle: Record<string, unknown> = { k: 1 };
    cycle.self = cycle;
    h.recorder.record("ok", { a: 1 });
    h.recorder.record("big", { n: BigInt(1) });
    h.recorder.record("loop", cycle);
    h.recorder.record("ok", { a: 2 });
    expect(() => h.recorder.endSession()).not.toThrow();
    expect(all(h.saves).map((e) => e.data?.a)).toEqual([1, 2]);
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]).toMatchObject({ recorded: 4, saved: 2, dropped_invalid: 2 });
  });

  it("holds measured events while the sink cannot accept, without measuring them again", () => {
    let open = false;
    const saves: EnqueueEventInput[][] = [];
    const enqueueMany = jest.fn((events: readonly EnqueueEventInput[]) => {
      saves.push([...events]);
      return true;
    });
    const h = harness({ sink: sinkOf(enqueueMany, () => open) });
    const spy = jest.spyOn(JSON, "stringify");
    h.recorder.beginUnit();
    h.recorder.record("a");
    h.recorder.closeUnit();
    h.runIdle(); // cannot accept: measured once, held
    h.recorder.beginUnit();
    h.recorder.record("b");
    h.recorder.closeUnit();
    h.runIdle(); // still cannot accept: only "b" is measured
    expect(spy).toHaveBeenCalledTimes(2);
    expect(enqueueMany).not.toHaveBeenCalled();
    open = true;
    h.recorder.endSession();
    expect(spy).toHaveBeenCalledTimes(2); // nothing measured again
    spy.mockRestore();
    expect(saves).toEqual([
      [
        { type: "a", data: { v: 1, unit: 1, t_ms: 0 } },
        { type: "b", data: { v: 1, unit: 2, t_ms: 0 } },
      ],
    ]);
  });

  it("counts a refused save once: the report's saved and saved_bytes are exact", () => {
    let refuse = true;
    const saves: EnqueueEventInput[][] = [];
    const config: GameRecordingConfig = { ...DEFAULT_RECORDING_CONFIG, defaultEventMaxBytes: 100 };
    const h = harness({
      config,
      sink: sinkOf((events) => {
        if (refuse) {
          refuse = false;
          return false;
        }
        saves.push([...events]);
        return true;
      }),
    });
    h.recorder.record("a", { k: 1 });
    h.recorder.closeUnit();
    h.runIdle(); // refused once
    h.recorder.record("b", { k: 2 });
    h.recorder.record("blob", { s: "x".repeat(500) }); // forces a report
    h.recorder.endSession();
    const sent = all(saves);
    expect(sent.map((e) => e.type)).toEqual(["a", "b"]);
    const bytes = sent.reduce((n, e) => n + JSON.stringify(e.data).length, 0);
    expect(h.reports[0]).toMatchObject({ saved: 2, saved_bytes: bytes, dropped_oversize: 1 });
  });

  it("refuses to record after endSession until startSession: nothing leaks into the next session", () => {
    const h = harness();
    h.recorder.startSession();
    h.recorder.record("first");
    h.recorder.endSession();
    h.clock.t = 5000;
    expect(h.recorder.beginUnit()).toBe(1);
    h.recorder.record("between"); // after the session ended: belongs to no game
    h.recorder.closeUnit();
    expect(h.recorder.inSession).toBe(false);
    expect(h.recorder.held).toBe(0);
    h.clock.t = 6000;
    h.recorder.startSession();
    h.clock.t = 6040;
    h.recorder.record("second");
    h.recorder.endSession();
    expect(h.saves).toEqual([
      [{ type: "first", data: { v: 1, unit: 1, t_ms: 0 } }],
      [{ type: "second", data: { v: 1, unit: 1, t_ms: 40 } }],
    ]);
  });

  it("freezes data in development before the ended, dial and ceiling checks", () => {
    const off = harness({ enabled: () => false });
    const a = { x: 1 };
    off.recorder.record("e", a);
    expect(Object.isFrozen(a)).toBe(true);

    const ended = harness();
    ended.recorder.endSession();
    const b = { x: 1 };
    ended.recorder.record("e", b);
    expect(Object.isFrozen(b)).toBe(true);

    const config: GameRecordingConfig = { ...DEFAULT_RECORDING_CONFIG, sessionMaxBytes: 16 };
    const ceiling = harness({ config });
    ceiling.recorder.record("e", { x: 0 }); // the one event the ceiling allows
    const c = { x: 1 };
    ceiling.recorder.record("e", c);
    expect(ceiling.recorder.held).toBe(1);
    expect(Object.isFrozen(c)).toBe(true);
  });

  it("flush saves what is waiting and keeps the session: numbering and t_ms carry on", () => {
    const h = harness({ policy: "on_session_end" });
    h.recorder.startSession();
    h.recorder.beginUnit(3);
    h.clock.t = 1100;
    h.recorder.record("a");
    h.recorder.flush();
    expect(h.saves).toEqual([[{ type: "a", data: { v: 1, unit: 3, t_ms: 100 } }]]);
    h.clock.t = 1200;
    h.recorder.record("b"); // same unit, still open
    h.recorder.beginUnit();
    h.recorder.record("c");
    h.recorder.endSession();
    expect(h.saves[1]).toEqual([
      { type: "b", data: { v: 1, unit: 3, t_ms: 200 } },
      { type: "c", data: { v: 1, unit: 4, t_ms: 200 } },
    ]);
  });

  it("shallow-freezes data in development, so a later change throws there", () => {
    expect(__DEV__).toBe(true);
    const h = harness();
    const data: Record<string, unknown> = { a: 1, nested: { b: 2 } };
    h.recorder.record("move", data);
    expect(Object.isFrozen(data)).toBe(true);
    // App modules are strict, where this assignment throws; the test file may
    // run sloppy, where it is ignored. Either way the recorded value stands.
    try {
      data.a = 2;
    } catch (e) {
      expect(e).toBeInstanceOf(TypeError);
    }
    expect(data.a).toBe(1);
    // shallow only: no deep clone or deep freeze
    expect(Object.isFrozen(data.nested)).toBe(false);
  });

  it("stops keeping events in memory past the ceiling derived from the session cap", () => {
    // Oversized events never fill the session, so only the ceiling stops them.
    const config: GameRecordingConfig = {
      sessionMaxBytes: 320,
      defaultEventMaxBytes: 80,
      events: {},
    };
    expect(memoryEventCeiling(config)).toBe(20);
    const h = harness({ config, policy: "on_session_end" });
    for (let i = 0; i < 100; i += 1) h.recorder.record("blob", { i, s: "x".repeat(200) });
    expect(h.recorder.held).toBe(20);
    h.recorder.endSession();
    expect(h.reports[0]).toMatchObject({
      recorded: 100,
      saved: 0,
      dropped_oversize: 20,
      dropped_session_cap: 80,
    });
  });

  it("measures nothing more once a save has filled the session", () => {
    const config: GameRecordingConfig = { ...DEFAULT_RECORDING_CONFIG, sessionMaxBytes: 100 };
    const h = harness({ config });
    for (let i = 0; i < 5; i += 1) h.recorder.record("e", { pad: "p".repeat(20) });
    h.recorder.closeUnit();
    h.runIdle(); // fills the session
    expect(h.recorder.held).toBe(0);
    const spy = jest.spyOn(JSON, "stringify");
    h.recorder.record("e", { pad: "p".repeat(500) }); // dropped in record: never kept
    expect(h.recorder.held).toBe(0);
    h.recorder.beginUnit();
    h.recorder.endSession();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    // largest_bytes stays at the most seen before the session filled
    expect(h.reports[0]?.largest_bytes).toBeLessThan(100);
    expect(h.reports[0]?.dropped_session_cap).toBeGreaterThanOrEqual(2);
  });

  it("a save scheduled in an earlier session does nothing in the current one", () => {
    const h = harness();
    h.recorder.startSession();
    h.recorder.record("old");
    h.recorder.closeUnit(); // task 1 scheduled
    h.recorder.endSession(); // saves "old" now
    h.recorder.startSession();
    h.recorder.record("new");
    h.recorder.closeUnit(); // task 2: the reset cleared saveScheduled
    expect(h.tasks).toHaveLength(2);
    h.tasks.shift()?.(); // the stale task
    expect(h.saves.map((s) => s.map((e) => e.type))).toEqual([["old"]]);
    h.tasks.shift()?.();
    expect(h.saves.map((s) => s.map((e) => e.type))).toEqual([["old"], ["new"]]);
  });
});

describe("GameRecorder review fixes, round 3 (#3315)", () => {
  afterEach(() => {
    resetLogConfig();
    jest.clearAllMocks();
  });

  it("keeps a clean prefix: a small event after the one that tripped the cap is not saved", () => {
    const config: GameRecordingConfig = {
      sessionMaxBytes: 200,
      defaultEventMaxBytes: 200,
      events: {},
    };
    const h = harness({ config });
    h.recorder.record("a", { p: "a".repeat(100) });
    h.recorder.record("b", { p: "b".repeat(100) }); // a + b > 200: trips the cap
    h.recorder.record("c", { k: 1 }); // would fit after a, but must not
    const sizes = [{ p: "a".repeat(100) }, { p: "b".repeat(100) }, { k: 1 }].map(
      (d) => JSON.stringify({ ...d, v: 1, unit: 1, t_ms: 0 }).length
    );
    expect(sizes[0]! + sizes[2]!).toBeLessThanOrEqual(200);
    expect(sizes[0]! + sizes[1]!).toBeGreaterThan(200);
    h.recorder.endSession();
    expect(all(h.saves).map((e) => e.type)).toEqual(["a"]);
    expect(h.reports[0]).toMatchObject({ saved: 1, dropped_session_cap: 2 });
  });

  it("counts events the sink cannot take at endSession as dropped_unsent, not saved", () => {
    const h = harness({
      sink: sinkOf(
        () => true,
        () => false
      ),
    });
    h.recorder.record("a", { k: 1 });
    h.recorder.record("b", { k: 2 });
    h.recorder.endSession();
    expect(h.reports[0]).toMatchObject({ saved: 0, saved_bytes: 0, dropped_unsent: 2 });
  });

  it("counts events the sink refuses at endSession as dropped_unsent, not saved", () => {
    const h = harness({ sink: sinkOf(() => false) });
    h.recorder.record("a", { k: 1 });
    h.recorder.endSession();
    expect(h.reports[0]).toMatchObject({ saved: 0, saved_bytes: 0, dropped_unsent: 1 });
  });

  it("a handoff carries the session's cap usage: the per-game cap does not reset", () => {
    const config: GameRecordingConfig = {
      sessionMaxBytes: 200,
      defaultEventMaxBytes: 200,
      events: {},
    };
    const a = harness({ config });
    a.recorder.record("big", { p: "x".repeat(120) });
    a.recorder.closeUnit();
    a.runIdle(); // measured and saved: ~145 of 200 used
    const handoff = a.recorder.endSession();
    expect(handoff?.sessionBytes).toBeGreaterThan(100);

    const b = harness({ config });
    if (handoff) b.recorder.continueFrom(handoff);
    b.recorder.record("more", { p: "y".repeat(80) }); // fits a fresh session, not this one
    b.recorder.endSession();
    expect(b.saves).toHaveLength(0);
    expect(b.reports[0]).toMatchObject({ saved: 0, dropped_session_cap: 1 });
  });

  it("endSession's handoff counts the open unit it measured on the way out", () => {
    const config: GameRecordingConfig = {
      sessionMaxBytes: 200,
      defaultEventMaxBytes: 200,
      events: {},
    };
    const a = harness({ config });
    a.recorder.beginUnit(3);
    a.recorder.record("big", { p: "x".repeat(120) }); // open, never measured at idle
    const handoff = a.recorder.endSession();
    expect(all(a.saves).map((e) => e.type)).toEqual(["big"]);
    expect(handoff).toMatchObject({ lastUnit: 3, taken: 1 });
    expect(handoff?.sessionBytes).toBeGreaterThan(100);

    const b = harness({ config });
    if (handoff) b.recorder.continueFrom(handoff);
    b.recorder.record("more", { p: "y".repeat(80) }); // would exceed the shared cap
    b.recorder.endSession();
    expect(b.saves).toHaveLength(0);
    expect(b.reports[0]).toMatchObject({ dropped_session_cap: 1 });
  });

  it("a handoff carries a full session and the events taken", () => {
    const config: GameRecordingConfig = { ...DEFAULT_RECORDING_CONFIG, sessionMaxBytes: 320 };
    const b = harness({ config });
    b.recorder.continueFrom({ t0: 1000, lastUnit: 2, sessionBytes: 300, taken: 0, full: true });
    b.recorder.record("e", { k: 1 });
    expect(b.recorder.held).toBe(0); // full: not kept

    const c = harness({ config });
    // memoryEventCeiling(config) is 20: 20 already taken leaves no room
    c.recorder.continueFrom({ t0: 1000, lastUnit: 2, sessionBytes: 0, taken: 20, full: false });
    c.recorder.record("e", { k: 1 });
    expect(c.recorder.held).toBe(0);
  });

  it("bounds the raw events a long open unit holds when idle never comes", () => {
    const config: GameRecordingConfig = {
      sessionMaxBytes: 10 * 1024 * 1024,
      defaultEventMaxBytes: 2048,
      events: {},
    };
    const h = harness({ config, policy: "on_session_end" });
    h.recorder.beginUnit(9);
    let most = 0;
    for (let i = 0; i < 1000; i += 1) {
      h.recorder.record("e", { i, p: "z".repeat(500) });
      most = Math.max(most, h.recorder.held);
    }
    expect(most).toBe(RECORDER_MAX_RAW_EVENTS);
    expect(h.tasks.length).toBeGreaterThan(0); // the long unit asked for idle measuring
    h.recorder.endSession();
    expect(h.reports[0]).toMatchObject({
      saved: RECORDER_MAX_RAW_EVENTS,
      dropped_memory: 1000 - RECORDER_MAX_RAW_EVENTS,
    });
    expect(new Set(all(h.saves).map((e) => e.data?.unit))).toEqual(new Set([9]));
  });

  it("measures a long open unit in pieces at idle, keeping its number and order", () => {
    const config: GameRecordingConfig = {
      sessionMaxBytes: 10 * 1024 * 1024,
      defaultEventMaxBytes: 2048,
      events: {},
    };
    const h = harness({ config, policy: "on_session_end" });
    h.recorder.beginUnit(9);
    let most = 0;
    for (let i = 0; i < 1000; i += 1) {
      h.recorder.record("e", { i, p: "z".repeat(500) });
      most = Math.max(most, h.recorder.held);
      if (i % 50 === 49) h.runIdle();
    }
    expect(most).toBeLessThanOrEqual(RECORDER_MEASURE_EVERY + 50);
    h.recorder.closeUnit();
    h.recorder.beginUnit();
    h.recorder.record("next");
    h.recorder.endSession();
    const saved = all(h.saves);
    expect(saved).toHaveLength(1001);
    expect(saved.slice(0, 1000).map((e) => e.data?.i)).toEqual(
      Array.from({ length: 1000 }, (_, i) => i)
    );
    expect(new Set(saved.slice(0, 1000).map((e) => e.data?.unit))).toEqual(new Set([9]));
    expect(saved[1000]?.data?.unit).toBe(10);
    expect(h.reports).toHaveLength(0);
  });
});

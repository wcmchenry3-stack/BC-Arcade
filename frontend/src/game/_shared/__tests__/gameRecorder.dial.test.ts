/**
 * The recorder and the replay dial (#3279).
 *
 * AC: with the game's flag off, the recorder records nothing for that game and
 * does no work — no sink call, nothing scheduled, nothing reported. With it
 * on, `stats()` gives the counts for the game_ended summary, and
 * `useGameRecorder.complete` passes them on.
 */

import * as Sentry from "@sentry/react-native";
import { act, renderHook } from "@testing-library/react-native";

import { GameRecorder, type RecorderSink } from "../gameRecorder";
import { __resetReplayDialForTests } from "../replayDial";
import { useGameRecorder } from "../useGameRecorder";

const mockCompletes: { id: string; payload: unknown }[] = [];
const mockSaved: string[] = [];
let mockNextId = 0;
/** Each game's stored replay mode (decided at its start, kept across a resume). */
const mockModes = new Map<string, "full" | "local" | "off">();
let mockResumeId: string | null = null;

jest.mock("../gameEventClient", () => ({
  gameEventClient: {
    startGame: () => {
      mockNextId += 1;
      return `g${mockNextId}`;
    },
    markStarted: () => undefined,
    enqueueEvent: () => undefined,
    enqueueEvents: (id: string, events: { type: string }[]) => {
      for (const e of events) mockSaved.push(`${id}:${e.type}`);
    },
    completeGame: (id: string, _summary: unknown, payload: unknown) =>
      mockCompletes.push({ id, payload }),
    discardGame: () => undefined,
    resumeGame: () => mockResumeId,
    replayMode: (id: string) => mockModes.get(id) ?? null,
    setProgressOutcome: () => undefined,
    reportBug: () => undefined,
  },
}));

function counting() {
  const calls = { canAccept: 0, enqueueMany: 0, schedule: 0, report: 0 };
  const sink: RecorderSink = {
    canAccept: () => {
      calls.canAccept += 1;
      return true;
    },
    enqueueMany: () => {
      calls.enqueueMany += 1;
      return true;
    },
  };
  return { calls, sink };
}

describe("GameRecorder and the replay dial (#3279)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCompletes.length = 0;
    mockSaved.length = 0;
    mockNextId = 0;
    mockModes.clear();
    mockResumeId = null;
  });

  describe("useGameRecorder follows the session's stored mode, not a fresh dial read (S2)", () => {
    async function resumeAndRecord(): Promise<void> {
      const { result } = await renderHook(() => useGameRecorder("hearts"));
      await act(() => {
        expect(result.current.resume()).toBe(true);
        result.current.beginUnit(5);
        result.current.record("card_played", { c: "2C" });
        result.current.complete({ outcome: "completed" });
      });
    }

    it("a resumed local session records after the dial flipped off", async () => {
      mockModes.set("k1", "local"); // decided in the killed process
      mockResumeId = "k1";
      __resetReplayDialForTests({ fallback: { enabled: false, rate: 0.1 } }); // the dial now
      await resumeAndRecord();
      expect(mockSaved).toEqual(["k1:card_played"]);
    });

    it("a resumed off session records nothing after the dial flipped on", async () => {
      mockModes.set("k2", "off");
      mockResumeId = "k2";
      __resetReplayDialForTests({ fallback: { enabled: true, rate: 1 } });
      await resumeAndRecord();
      expect(mockSaved).toEqual([]);
    });

    it("units recorded before start() are dropped when the new game is off", async () => {
      __resetReplayDialForTests({ fallback: { enabled: true, rate: 1 } }); // no game yet: dial on
      const { result } = await renderHook(() => useGameRecorder("hearts"));
      await act(() => {
        result.current.beginUnit(1);
        result.current.record("card_played", { c: "AS" });
        mockModes.set("g1", "off"); // what startGame decides for g1
        result.current.start();
        result.current.record("card_played", { c: "KS" });
        result.current.complete({ outcome: "completed" });
      });
      expect(mockSaved).toEqual([]);
    });
  });

  it("flag off: nothing recorded, no sink call, nothing scheduled, no Sentry call", () => {
    __resetReplayDialForTests({ fallback: { enabled: false, rate: 1 } });
    const { calls, sink } = counting();
    const recorder = new GameRecorder({
      gameType: "hearts",
      sink,
      schedule: () => {
        calls.schedule += 1;
      },
      report: () => {
        calls.report += 1;
      },
    });
    recorder.startSession();
    for (let unit = 1; unit <= 3; unit += 1) {
      recorder.beginUnit(unit);
      for (let i = 0; i < 100; i += 1) recorder.record("card_played", { c: i });
      recorder.closeUnit();
    }
    recorder.requestSave();
    recorder.flush();
    expect(recorder.held).toBe(0);
    recorder.endSession();
    expect(calls).toEqual({ canAccept: 0, enqueueMany: 0, schedule: 0, report: 0 });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(recorder.stats()).toEqual({ u: 3, n: 0, b: 0 });
  });

  it("flag on: records as before, whatever the sample rate", () => {
    __resetReplayDialForTests({ fallback: { enabled: true, rate: 0 } });
    const tasks: (() => void)[] = [];
    const { calls, sink } = counting();
    const recorder = new GameRecorder({
      gameType: "hearts",
      sink,
      schedule: (t) => tasks.push(t),
    });
    recorder.startSession();
    recorder.beginUnit(1);
    recorder.record("card_played", { c: "2C" });
    recorder.closeUnit();
    tasks.splice(0).forEach((t) => t());
    expect(calls.enqueueMany).toBe(1);
  });

  it("a handoff carries the saved and dropped counts: stats() covers the whole session (Codex P2)", () => {
    const config = { sessionMaxBytes: 64 * 1024, defaultEventMaxBytes: 60, events: {} };
    const sink: RecorderSink = { canAccept: () => true, enqueueMany: () => true };
    const reports: unknown[] = [];
    const a = new GameRecorder({
      gameType: "hearts",
      sink,
      config,
      schedule: () => undefined,
      report: (r) => reports.push(r),
    });
    a.startSession();
    a.beginUnit(1);
    a.record("card_played", { c: "2C" });
    a.record("card_played", { c: "3C" });
    a.record("card_played", { big: "x".repeat(200) }); // over the 60 cap: dropped
    const handoff = a.endSession();
    expect(handoff?.counts).toMatchObject({ saved: 2, droppedOversize: 1 });
    expect(reports).toHaveLength(1); // a reports its own drop

    const b = new GameRecorder({
      gameType: "starswarm",
      sink,
      config,
      schedule: () => undefined,
      report: (r) => reports.push(r),
    });
    if (handoff) b.continueFrom(handoff);
    b.beginUnit(2);
    b.record("wave_completed", { w: 1 });
    b.flush();
    expect(b.stats()).toMatchObject({ u: 2, n: 3, x: 1 });
    b.endSession();
    expect(b.stats()).toMatchObject({ u: 2, n: 3, x: 1 });
    // b dropped nothing itself: a's drop is not reported again.
    expect(reports).toHaveLength(1);
  });

  it("stats(): the session's counts, then the ended session's, with drops only when there are any", () => {
    const recorder = new GameRecorder({ gameType: "hearts", schedule: () => undefined });
    expect(recorder.stats()).toBeNull();
    recorder.startSession();
    recorder.beginUnit(4);
    recorder.record("card_played", { c: "2C" });
    recorder.record("card_played", { c: "3C" });
    recorder.flush();
    const live = recorder.stats();
    expect(live).toMatchObject({ u: 4, n: 2 });
    expect(live?.b).toBeGreaterThan(0);
    expect(live).not.toHaveProperty("x");
    recorder.endSession(); // no sink: the two are dropped unsent
    expect(recorder.stats()).toEqual({ u: 4, n: 0, b: 0, x: 2 });
  });

  it("useGameRecorder.complete passes the counts as the payload's replay field", async () => {
    const { result } = await renderHook(() => useGameRecorder("hearts"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.beginUnit(1);
      result.current.record("card_played", { c: "2C" });
      result.current.complete({ outcome: "completed" }, { final_score: 5 });
    });
    expect(mockCompletes).toHaveLength(1);
    const payload = mockCompletes[0]?.payload as { final_score: number; replay: unknown };
    expect(payload.final_score).toBe(5);
    expect(payload.replay).toMatchObject({ u: 1, n: 1 });
  });
});

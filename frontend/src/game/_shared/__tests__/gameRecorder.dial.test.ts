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
let mockNextId = 0;

jest.mock("../gameEventClient", () => ({
  gameEventClient: {
    startGame: () => {
      mockNextId += 1;
      return `g${mockNextId}`;
    },
    markStarted: () => undefined,
    enqueueEvent: () => undefined,
    enqueueEvents: () => undefined,
    completeGame: (id: string, _summary: unknown, payload: unknown) =>
      mockCompletes.push({ id, payload }),
    discardGame: () => undefined,
    resumeGame: () => null,
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
    mockNextId = 0;
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

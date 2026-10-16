/**
 * Saves off the interaction path (#3275, epic #3273): with its production
 * defaults — no injected `schedule` — the recorder never serialises or saves
 * inside the call that records or closes a unit (a gesture handler, an
 * animation callback, Star Swarm's tick). Its work is handed to
 * `requestIdleCallback` with RN's own deadline, and the save happens there.
 * `useGameRecorder` builds its recorder with those defaults.
 */

import { act, renderHook } from "@testing-library/react-native";

import type { EnqueueEventInput } from "../gameEventClient";
import { RECORDER_IDLE_TIMEOUT_MS, RECORDER_MEASURE_EVERY } from "../eventQueueConfig";
import { GameRecorder } from "../gameRecorder";
import { useGameRecorder } from "../useGameRecorder";

const mockEnqueueEvents = jest.fn();

jest.mock("../gameEventClient", () => ({
  gameEventClient: {
    startGame: () => "g1",
    markStarted: () => undefined,
    enqueueEvent: () => undefined,
    enqueueEvents: (...args: unknown[]) => mockEnqueueEvents(...args),
    completeGame: () => undefined,
    discardGame: () => undefined,
    resumeGame: () => null,
    setProgressOutcome: () => undefined,
    reportBug: () => undefined,
  },
}));

type IdleTask = () => void;
const g = globalThis as { requestIdleCallback?: unknown };

describe("GameRecorder saves off the interaction path (#3275)", () => {
  const saved = g.requestIdleCallback;
  let idle: IdleTask[];
  let ric: jest.Mock;
  let stringify: jest.SpyInstance;

  /** Run what the JS thread would run when it next idles. */
  function runIdle(): void {
    while (idle.length > 0) idle.shift()?.();
  }

  beforeEach(() => {
    idle = [];
    ric = jest.fn((task: IdleTask) => idle.push(task));
    g.requestIdleCallback = ric;
    mockEnqueueEvents.mockClear();
    stringify = jest.spyOn(JSON, "stringify");
  });

  afterEach(() => {
    stringify.mockRestore();
    if (saved === undefined) delete g.requestIdleCallback;
    else g.requestIdleCallback = saved;
  });

  function defaultRecorder(policy: "on_unit_close" | "on_session_end") {
    const saves: EnqueueEventInput[][] = [];
    const recorder = new GameRecorder({
      gameType: policy === "on_session_end" ? "starswarm" : "hearts",
      policy,
      sink: {
        canAccept: () => true,
        enqueueMany: (events) => {
          saves.push([...events]);
          return true;
        },
      },
      report: () => undefined,
    });
    return { recorder, saves };
  }

  it("on_unit_close: a gesture handler that records and closes a unit saves nothing in it", () => {
    const { recorder, saves } = defaultRecorder("on_unit_close");
    const onCardTap = () => {
      recorder.beginUnit();
      recorder.record("card_played", { c: "QS" });
      recorder.closeUnit();
    };
    onCardTap();
    expect(saves).toEqual([]);
    expect(stringify).not.toHaveBeenCalled();
    expect(ric).toHaveBeenCalledTimes(1);
    expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: RECORDER_IDLE_TIMEOUT_MS });

    runIdle();
    expect(saves).toHaveLength(1);
    expect(saves[0]?.map((e) => e.type)).toEqual(["card_played"]);
  });

  it("on_session_end: Star Swarm's ticks record without serialising or saving; only endSession saves", () => {
    const { recorder, saves } = defaultRecorder("on_session_end");
    // Many frames' worth of records across waves, more than one measure batch.
    const tick = (frame: number) => {
      if (frame % 100 === 0) recorder.beginUnit();
      recorder.record("hit", { f: frame });
      if (frame % 100 === 99) recorder.closeUnit();
    };
    for (let frame = 0; frame < RECORDER_MEASURE_EVERY * 4; frame += 1) tick(frame);
    expect(stringify).not.toHaveBeenCalled();
    expect(saves).toEqual([]);
    expect(ric).toHaveBeenCalled(); // measuring was handed to idle

    runIdle(); // idle measures, and still does not save under on_session_end
    expect(saves).toEqual([]);

    recorder.endSession();
    expect(saves).toHaveLength(1);
  });

  it("useGameRecorder uses the idle scheduler: nothing is saved inside the act that records", async () => {
    const { result } = await renderHook(() => useGameRecorder("hearts"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
    });
    ric.mockClear();
    idle = [];
    mockEnqueueEvents.mockClear();

    await act(() => {
      result.current.beginUnit(1);
      result.current.record("card_played", { c: "2C" });
      result.current.closeUnit();
    });
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: RECORDER_IDLE_TIMEOUT_MS });

    await act(() => runIdle());
    expect(mockEnqueueEvents).toHaveBeenCalledTimes(1);
    expect(mockEnqueueEvents).toHaveBeenCalledWith("g1", expect.any(Array));
  });
});

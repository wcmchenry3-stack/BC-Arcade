/**
 * useGameRecorder (#3274): the recorder's session follows useGameSync's, and
 * what it holds is saved before the session's game_ended — on complete,
 * close, restart and unmount.
 */

import { act, renderHook } from "@testing-library/react-native";

import { useGameRecorder } from "../useGameRecorder";

/** Every gameEventClient call, in order: [method, gameId, detail]. */
const mockCalls: [string, string, unknown][] = [];
let mockNextId = 0;

jest.mock("../gameEventClient", () => ({
  gameEventClient: {
    startGame: () => {
      mockNextId += 1;
      const id = `g${mockNextId}`;
      mockCalls.push(["startGame", id, null]);
      return id;
    },
    markStarted: (id: string) => mockCalls.push(["markStarted", id, null]),
    enqueueEvent: (id: string, e: { type: string }) => mockCalls.push(["enqueueEvent", id, e.type]),
    enqueueEvents: (id: string, events: { type: string; data?: Record<string, unknown> }[]) =>
      mockCalls.push(["enqueueEvents", id, events.map((e) => [e.type, e.data?.unit])]),
    completeGame: (id: string, summary: { outcome: string }) =>
      mockCalls.push(["completeGame", id, summary.outcome]),
    discardGame: (id: string) => mockCalls.push(["discardGame", id, null]),
    resumeGame: () => null,
    setProgressOutcome: () => undefined,
    reportBug: () => undefined,
  },
}));

/** Let the default idle scheduler's callbacks run. */
async function idle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe("useGameRecorder", () => {
  beforeEach(() => {
    mockCalls.length = 0;
    mockNextId = 0;
  });

  it("on_unit_close: saves a closed unit off the call, for the open session", async () => {
    const { result } = await renderHook(() => useGameRecorder("hearts"));
    let savedDuringCall: unknown[] = [];
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.beginUnit(1);
      result.current.record("card_played", { c: "2C" });
      result.current.record("card_played", { c: "3C" });
      result.current.closeUnit();
      savedDuringCall = mockCalls.filter((c) => c[0] === "enqueueEvents");
    });
    expect(savedDuringCall).toEqual([]);
    await idle();
    expect(mockCalls.filter((c) => c[0] === "enqueueEvents")).toEqual([
      [
        "enqueueEvents",
        "g1",
        [
          ["card_played", 1],
          ["card_played", 1],
        ],
      ],
    ]);
  });

  it("complete saves what is held before game_ended", async () => {
    const { result } = await renderHook(() =>
      useGameRecorder("starswarm", { policy: "on_session_end" })
    );
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.beginUnit();
      result.current.record("wave_completed", { w: 1 });
      result.current.closeUnit();
      result.current.beginUnit();
      result.current.record("wave_completed", { w: 2 });
      result.current.complete({ outcome: "completed", finalScore: 10 });
    });
    expect(mockCalls.map((c) => c[0])).toEqual([
      "startGame",
      "markStarted",
      "enqueueEvents",
      "completeGame",
    ]);
    expect(mockCalls[2]?.[2]).toEqual([
      ["wave_completed", 1],
      ["wave_completed", 2],
    ]);
  });

  it("unmount saves what is held before the abandon", async () => {
    const { result, unmount } = await renderHook(() =>
      useGameRecorder("hearts", { policy: "on_session_end" })
    );
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.record("card_played", { c: "QS" });
    });
    await unmount();
    expect(mockCalls.map((c) => c.slice(0, 2))).toEqual([
      ["startGame", "g1"],
      ["markStarted", "g1"],
      ["enqueueEvents", "g1"],
      ["completeGame", "g1"],
    ]);
    expect(mockCalls[3]?.[2]).toBe("abandoned");
  });

  it("restart saves the old session's events to the old session, then records the new one from unit 1", async () => {
    const { result } = await renderHook(() =>
      useGameRecorder("hearts", { policy: "on_session_end" })
    );
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.beginUnit(4);
      result.current.record("card_played");
      result.current.restart();
      result.current.markStarted();
      result.current.record("card_played");
      result.current.close();
    });
    expect(mockCalls).toEqual([
      ["startGame", "g1", null],
      ["markStarted", "g1", null],
      ["enqueueEvents", "g1", [["card_played", 4]]],
      ["completeGame", "g1", "abandoned"],
      ["startGame", "g2", null],
      ["markStarted", "g2", null],
      ["enqueueEvents", "g2", [["card_played", 1]]],
      ["completeGame", "g2", "abandoned"],
    ]);
  });

  it("saves nothing after the session completed", async () => {
    const { result } = await renderHook(() => useGameRecorder("hearts"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.complete({ outcome: "completed" });
      result.current.record("card_played");
      result.current.closeUnit();
    });
    await idle();
    expect(mockCalls.filter((c) => c[0] === "enqueueEvents")).toEqual([]);
  });
});

/**
 * useGameRecorder (#3274): the recorder's session follows useGameSync's, and
 * what it holds is saved before the session's game_ended — on complete,
 * close, restart and unmount.
 */

import { act, renderHook } from "@testing-library/react-native";
import React from "react";

import { useGameRecorder } from "../useGameRecorder";

/** Every gameEventClient call, in order: [method, gameId, detail]. */
const mockCalls: [string, string, unknown][] = [];
let mockNextId = 0;
/** Every saved event: [gameId, type, unit, t_ms]. */
const mockSaved: [string, string, unknown, unknown][] = [];
/** What gameEventClient.resumeGame returns: null resumes nothing. */
let mockResumeId: string | null = null;

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
    enqueueEvents: (id: string, events: { type: string; data?: Record<string, unknown> }[]) => {
      for (const e of events) mockSaved.push([id, e.type, e.data?.unit, e.data?.t_ms]);
      mockCalls.push(["enqueueEvents", id, events.map((e) => [e.type, e.data?.unit])]);
    },
    completeGame: (id: string, summary: { outcome: string }) =>
      mockCalls.push(["completeGame", id, summary.outcome]),
    discardGame: (id: string) => mockCalls.push(["discardGame", id, null]),
    resumeGame: () => mockResumeId,
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
    mockSaved.length = 0;
    mockNextId = 0;
    mockResumeId = null;
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
      useGameRecorder("hearts", { policy: "on_session_end" })
    );
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.beginUnit();
      result.current.record("card_played", { w: 1 });
      result.current.closeUnit();
      result.current.beginUnit();
      result.current.record("card_played", { w: 2 });
      result.current.complete({ outcome: "completed", finalScore: 10 });
    });
    expect(mockCalls.map((c) => c[0])).toEqual([
      "startGame",
      "markStarted",
      "enqueueEvents",
      "completeGame",
    ]);
    expect(mockCalls[2]?.[2]).toEqual([
      ["card_played", 1],
      ["card_played", 2],
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

  /** The units of everything saved, per game id, in order. */
  function savedUnits(): [string, unknown][] {
    return mockCalls
      .filter((c) => c[0] === "enqueueEvents")
      .flatMap((c) => (c[2] as [string, unknown][]).map(([, unit]) => [c[1], unit]));
  }

  it("a failed resume saves what is waiting and keeps the numbering and clock", async () => {
    let clock = 10_000;
    const now = jest.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const { result } = await renderHook(() =>
        useGameRecorder("hearts", { policy: "on_session_end" })
      );
      await act(() => {
        result.current.start(); // t0 = 10 000
        result.current.markStarted();
        result.current.beginUnit(3);
        clock = 10_250;
        result.current.record("card_played");
        expect(result.current.resume()).toBe(false); // the mock resumes nothing
        clock = 10_400;
        result.current.record("card_played"); // still unit 3, clock not reset
        result.current.beginUnit();
        clock = 10_600;
        result.current.record("card_played");
        result.current.complete({ outcome: "completed" });
      });
      expect(mockSaved).toEqual([
        ["g1", "card_played", 3, 250],
        ["g1", "card_played", 3, 400],
        ["g1", "card_played", 4, 600],
      ]);
      // saved before the resume call, and the rest at complete
      expect(mockCalls.filter((c) => c[0] === "enqueueEvents")).toHaveLength(2);
    } finally {
      now.mockRestore();
    }
  });

  it("what is recorded after complete() belongs to no game: the next game holds only its own events", async () => {
    let clock = 1_000;
    const now = jest.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const { result } = await renderHook(() => useGameRecorder("hearts"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
        result.current.beginUnit(4);
        result.current.record("card_played");
        result.current.complete({ outcome: "completed" });
        clock = 2_000;
        result.current.beginUnit();
        result.current.record("stray"); // between games
        result.current.closeUnit();
      });
      await idle();
      await act(() => {
        clock = 3_000;
        result.current.start(); // the second game, t0 = 3 000
        result.current.markStarted();
        clock = 3_120;
        result.current.record("card_played");
        result.current.complete({ outcome: "completed" });
      });
      expect(mockSaved).toEqual([
        ["g1", "card_played", 4, 0],
        ["g2", "card_played", 1, 120],
      ]);
    } finally {
      now.mockRestore();
    }
  });

  it("units recorded before start() are saved under the new game, numbering continuous", async () => {
    const { result } = await renderHook(() => useGameRecorder("hearts"));
    await act(() => {
      result.current.beginUnit();
      result.current.record("card_played");
      result.current.closeUnit();
    });
    await idle(); // no game yet: the save is refused, the unit waits
    expect(savedUnits()).toEqual([]);
    await act(() => {
      result.current.start();
      result.current.markStarted();
    });
    await idle(); // start() asks for a save of what waited
    await act(() => {
      result.current.record("card_played"); // unit 2
      result.current.complete({ outcome: "completed" });
    });
    expect(savedUnits()).toEqual([
      ["g1", 1],
      ["g1", 2],
    ]);
    expect(mockCalls.map((c) => c[0])).toEqual([
      "startGame",
      "markStarted",
      "enqueueEvents",
      "enqueueEvents",
      "completeGame",
    ]);
  });

  it("a new gameType ends the old recorder's session; the new one carries the open game's clock and numbering", async () => {
    let clock = 1_000;
    const now = jest.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const { result, rerender } = await renderHook(
        ({ type }: { type: "hearts" | "yacht" }) =>
          useGameRecorder(type, { policy: "on_session_end" }),
        { initialProps: { type: "hearts" } }
      );
      await act(() => {
        result.current.start(); // t0 = 1 000
        result.current.markStarted();
        result.current.beginUnit(5);
        clock = 1_100;
        result.current.record("card_played");
      });
      await act(async () => rerender({ type: "yacht" }));
      expect(mockSaved).toEqual([["g1", "card_played", 5, 100]]); // the old session ended
      await act(() => {
        clock = 1_300;
        result.current.record("roll"); // the new recorder: unit 6, same clock
        result.current.complete({ outcome: "completed" });
      });
      expect(mockSaved).toEqual([
        ["g1", "card_played", 5, 100],
        ["g1", "roll", 6, 300],
      ]);
    } finally {
      now.mockRestore();
    }
  });

  it("a new gameType counts the old recorder's unmeasured open unit against the shared session cap", async () => {
    // Default caps: 2 KB per event, 64 KB per session. 37 events of ~1.7 KB
    // fit; a 38th does not.
    const big = () => ({ p: "x".repeat(1700) });
    const { result, rerender } = await renderHook(
      ({ type }: { type: "hearts" | "yacht" }) =>
        useGameRecorder(type, { policy: "on_session_end" }),
      { initialProps: { type: "hearts" } }
    );
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.beginUnit(1);
      for (let i = 0; i < 37; i += 1) result.current.record("e", big()); // open, unmeasured
    });
    await act(async () => rerender({ type: "yacht" }));
    expect(mockSaved).toHaveLength(37);
    await act(() => {
      result.current.record("late", big()); // over the session's cap
      result.current.complete({ outcome: "completed" });
    });
    expect(mockSaved.map((e) => e[1])).not.toContain("late");
  });

  it("a new gameType with no game open starts the new recorder fresh", async () => {
    const { result, rerender } = await renderHook(
      ({ type }: { type: "hearts" | "yacht" }) => useGameRecorder(type),
      { initialProps: { type: "hearts" } }
    );
    await act(() => {
      result.current.beginUnit(5);
      result.current.record("card_played"); // no game: dropped with the old recorder
    });
    await act(async () => rerender({ type: "yacht" }));
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.record("roll");
      result.current.complete({ outcome: "completed" });
    });
    expect(mockSaved.map((e) => [e[0], e[1], e[2]])).toEqual([["g1", "roll", 1]]);
  });

  it("a successful resume with no game open keeps the units recorded before it, under the resumed id", async () => {
    mockResumeId = "orphan";
    const { result } = await renderHook(() => useGameRecorder("hearts"));
    await act(() => {
      result.current.beginUnit(7); // the game's own number, from its restored state
      result.current.record("card_played");
      result.current.closeUnit();
    });
    await idle(); // no game yet: refused, waiting
    expect(savedUnits()).toEqual([]);
    await act(() => {
      expect(result.current.resume()).toBe(true);
    });
    await idle(); // resume() asks for a save of what waited
    await act(() => {
      result.current.record("card_played"); // still the game's numbering: unit 8
      result.current.complete({ outcome: "completed" });
    });
    expect(savedUnits()).toEqual([
      ["orphan", 7],
      ["orphan", 8],
    ]);
  });

  it("a resume over an open game saves that game's units and restarts recording for the resumed one", async () => {
    const { result } = await renderHook(() =>
      useGameRecorder("hearts", { policy: "on_session_end" })
    );
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.beginUnit(2);
      result.current.record("card_played");
    });
    mockResumeId = "orphan";
    await act(() => {
      expect(result.current.resume()).toBe(true);
      // a resuming game passes its own unit number: the default would restart at 1
      result.current.beginUnit(5);
      result.current.record("card_played");
      result.current.complete({ outcome: "completed" });
    });
    expect(savedUnits()).toEqual([
      ["g1", 2],
      ["orphan", 5],
    ]);
  });

  it("under React.StrictMode, a record before start() is saved under the game", async () => {
    const { result } = await renderHook(() => useGameRecorder("hearts"), {
      wrapper: React.StrictMode,
    });
    await act(() => {
      result.current.beginUnit();
      result.current.record("card_played");
      result.current.closeUnit();
      result.current.start();
      result.current.markStarted();
      result.current.record("card_played");
      result.current.complete({ outcome: "completed" });
    });
    expect(mockSaved.map((e) => [e[0], e[1], e[2]])).toEqual([
      ["g1", "card_played", 1],
      ["g1", "card_played", 2],
    ]);
  });
});

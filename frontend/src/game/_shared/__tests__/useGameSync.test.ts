import { renderHook, act } from "@testing-library/react-native";
import { useGameSync } from "../useGameSync";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockStartGame = jest.fn<string, any[]>(() => "test-game-id");
const mockEnqueueEvent = jest.fn();
const mockCompleteGame = jest.fn();
const mockReportBug = jest.fn();

jest.mock("../gameEventClient", () => ({
  gameEventClient: {
    startGame: (...args: unknown[]) => mockStartGame(...args),
    enqueueEvent: (...args: unknown[]) => mockEnqueueEvent(...args),
    completeGame: (...args: unknown[]) => mockCompleteGame(...args),
    reportBug: (...args: unknown[]) => mockReportBug(...args),
  },
}));

describe("useGameSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStartGame.mockReturnValue("test-game-id");
  });

  // ---------------------------------------------------------------------------
  // start
  // ---------------------------------------------------------------------------

  it("start() calls gameEventClient.startGame with the game type", async () => {
    const { result } = await renderHook(() => useGameSync("yacht"));
    await act(() => {
      result.current.start({ initial_score: 0 });
    });
    expect(mockStartGame).toHaveBeenCalledWith("yacht", {}, { initial_score: 0 });
  });

  it("start() without eventData calls startGame with empty object", async () => {
    const { result } = await renderHook(() => useGameSync("twenty48"));
    await act(() => {
      result.current.start();
    });
    expect(mockStartGame).toHaveBeenCalledWith("twenty48", {}, {});
  });

  it("start() with metadata passes it as the second arg to startGame", async () => {
    const { result } = await renderHook(() => useGameSync("sudoku"));
    await act(() => {
      result.current.start({ difficulty: "hard" }, { difficulty: "hard" });
    });
    expect(mockStartGame).toHaveBeenCalledWith(
      "sudoku",
      { difficulty: "hard" },
      { difficulty: "hard" }
    );
  });

  // ---------------------------------------------------------------------------
  // enqueue
  // ---------------------------------------------------------------------------

  it("enqueue() after start() calls gameEventClient.enqueueEvent", async () => {
    const { result } = await renderHook(() => useGameSync("yacht"));
    await act(() => {
      result.current.start();
      result.current.enqueue({ type: "roll", data: { dice: [1, 2, 3] } });
    });
    expect(mockEnqueueEvent).toHaveBeenCalledWith("test-game-id", {
      type: "roll",
      data: { dice: [1, 2, 3] },
    });
  });

  it("enqueue() before start() is a no-op", async () => {
    const { result } = await renderHook(() => useGameSync("yacht"));
    await act(() => {
      result.current.enqueue({ type: "roll" });
    });
    expect(mockEnqueueEvent).not.toHaveBeenCalled();
  });

  it("enqueue() after complete() is a no-op", async () => {
    const { result } = await renderHook(() => useGameSync("yacht"));
    await act(() => {
      result.current.start();
      result.current.complete({ finalScore: 100, outcome: "completed" });
      result.current.enqueue({ type: "roll" });
    });
    expect(mockEnqueueEvent).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // complete
  // ---------------------------------------------------------------------------

  it("complete() calls gameEventClient.completeGame with summary and payload", async () => {
    const { result } = await renderHook(() => useGameSync("yacht"));
    await act(() => {
      result.current.start();
      result.current.complete(
        { finalScore: 250, outcome: "completed", result: { final_score: 250 } },
        { final_score: 250 }
      );
    });
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "test-game-id",
      { finalScore: 250, outcome: "completed", result: { final_score: 250 } },
      { final_score: 250 }
    );
  });

  // #2619 (#2469 item 1): the event payload is analytics only — it is never
  // copied into the PATCH result block.
  it("complete() sends only the explicit result, never the event payload", async () => {
    const { result } = await renderHook(() => useGameSync("yacht"));
    await act(() => {
      result.current.start();
      result.current.complete({ finalScore: 250, outcome: "completed" }, { final_score: 250 });
    });
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "test-game-id",
      { finalScore: 250, outcome: "completed" },
      { final_score: 250 }
    );
    const summary = mockCompleteGame.mock.calls[0]![1] as Record<string, unknown>;
    expect(summary).not.toHaveProperty("result");
  });

  it("complete() keeps an explicit summary.result over the payload", async () => {
    const { result } = await renderHook(() => useGameSync("solitaire"));
    await act(() => {
      result.current.start();
      result.current.complete(
        { outcome: "completed", result: { won: true, moves: 3 } },
        { final_score: 9, outcome: "completed" }
      );
    });
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "test-game-id",
      { outcome: "completed", result: { won: true, moves: 3 } },
      { final_score: 9, outcome: "completed" }
    );
  });

  it("complete() without payload passes empty object", async () => {
    const { result } = await renderHook(() => useGameSync("yacht"));
    await act(() => {
      result.current.start();
      result.current.complete({ outcome: "completed" });
    });
    expect(mockCompleteGame).toHaveBeenCalledWith("test-game-id", { outcome: "completed" }, {});
  });

  it("complete() is idempotent — only the first call fires", async () => {
    const { result } = await renderHook(() => useGameSync("yacht"));
    await act(() => {
      result.current.start();
      result.current.complete({ outcome: "completed" });
      result.current.complete({ outcome: "completed" });
    });
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // unmount cleanup
  // ---------------------------------------------------------------------------

  it("unmount without markStarted does not abandon the session", async () => {
    const { result, unmount } = await renderHook(() => useGameSync("twenty48"));
    await act(() => {
      result.current.start();
      // player never took an action — no markStarted()
    });
    await unmount();
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("unmount after markStarted but without complete abandons the open session", async () => {
    const { result, unmount } = await renderHook(() => useGameSync("twenty48"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
    });
    await unmount();
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "test-game-id",
      { outcome: "abandoned" },
      { outcome: "abandoned" }
    );
  });

  // ---------------------------------------------------------------------------
  // progress snapshot (#2450) — abandon paths carry score + result block
  // ---------------------------------------------------------------------------

  it("unmount abandon merges the registered snapshot's result into summary and event", async () => {
    const { result, unmount } = await renderHook(() => useGameSync("solitaire"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.setProgressSnapshot(() => ({ result: { won: false, moves: 12 } }));
    });
    await unmount();
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "test-game-id",
      { outcome: "abandoned", result: { won: false, moves: 12 } },
      { won: false, moves: 12, outcome: "abandoned" }
    );
  });

  it("snapshot getter is read at abandon time, not registration time", async () => {
    let moves = 0;
    const { result, unmount } = await renderHook(() => useGameSync("solitaire"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.setProgressSnapshot(() => ({ result: { won: false, moves } }));
    });
    moves = 30;
    await unmount();
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "test-game-id",
      { outcome: "abandoned", result: { won: false, moves: 30 } },
      { won: false, moves: 30, outcome: "abandoned" }
    );
  });

  it("restart() abandon merges the registered snapshot", async () => {
    mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
    const { result } = await renderHook(() => useGameSync("mahjong"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.setProgressSnapshot(() => ({ result: { won: false, pairs: 5 } }));
    });
    await act(() => {
      result.current.restart();
    });
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "session-1",
      { outcome: "abandoned", result: { won: false, pairs: 5 } },
      { won: false, pairs: 5, outcome: "abandoned" }
    );
  });

  it("a hook-driven abandon never carries a score, so it cannot rank on a leaderboard", async () => {
    const { result, unmount } = await renderHook(() => useGameSync("cascade"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.setProgressSnapshot(() => ({ result: { total_drops: 9 } }));
    });
    await unmount();
    const summary = mockCompleteGame.mock.calls[0]![1] as Record<string, unknown>;
    expect(summary).not.toHaveProperty("finalScore");
  });

  it("a throwing snapshot getter degrades to a bare abandon", async () => {
    const { result, unmount } = await renderHook(() => useGameSync("solitaire"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.setProgressSnapshot(() => {
        throw new Error("state gone");
      });
    });
    await unmount();
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "test-game-id",
      { outcome: "abandoned" },
      { outcome: "abandoned" }
    );
  });

  it("abandon without a snapshot sends no result (backend then skips validation)", async () => {
    const { result, unmount } = await renderHook(() => useGameSync("yacht"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
    });
    await unmount();
    const summary = mockCompleteGame.mock.calls[0]![1] as Record<string, unknown>;
    expect(summary).not.toHaveProperty("result");
  });

  it("unmount after complete does not call completeGame again", async () => {
    const { result, unmount } = await renderHook(() => useGameSync("twenty48"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.complete({ finalScore: 512, outcome: "completed" });
    });
    await unmount();
    // Only one call: the explicit complete(); unmount cleanup should be silent.
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
  });

  it("unmount without start does not call completeGame", async () => {
    const { unmount } = await renderHook(() => useGameSync("cascade"));
    await unmount();
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // restart
  // ---------------------------------------------------------------------------

  it("restart() abandons a started session and starts a new one", async () => {
    mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
    const { result } = await renderHook(() => useGameSync("cascade"));
    await act(() => {
      result.current.start({ fruit_set: "fruits" });
      result.current.markStarted();
    });
    await act(() => {
      result.current.restart({ fruit_set: "cosmos" });
    });
    // First session abandoned
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "session-1",
      { outcome: "abandoned" },
      { outcome: "abandoned" }
    );
    // Second session started
    expect(mockStartGame).toHaveBeenCalledTimes(2);
    expect(mockStartGame).toHaveBeenLastCalledWith("cascade", {}, { fruit_set: "cosmos" });
  });

  // #2619: same guard as the unmount path — a game the player never touched is
  // not an abandon.
  it("restart() before markStarted() sends no abandon but still starts a new session", async () => {
    mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
    const { result } = await renderHook(() => useGameSync("cascade"));
    await act(() => {
      result.current.start();
      result.current.setProgressSnapshot(() => ({ result: { total_drops: 0 } }));
    });
    await act(() => {
      result.current.restart({ fruit_set: "cosmos" });
    });
    expect(mockCompleteGame).not.toHaveBeenCalled();
    expect(mockStartGame).toHaveBeenCalledTimes(2);
    expect(result.current.getGameId()).toBe("session-2");
  });

  it("restart() after markStarted() sends the abandon", async () => {
    mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
    const { result } = await renderHook(() => useGameSync("cascade"));
    await act(() => {
      result.current.start();
    });
    await act(() => {
      result.current.markStarted();
      result.current.restart();
    });
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "session-1",
      { outcome: "abandoned" },
      { outcome: "abandoned" }
    );
  });

  it("restart() after complete() does not double-abandon", async () => {
    mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
    const { result } = await renderHook(() => useGameSync("cascade"));
    await act(() => {
      result.current.start();
      result.current.complete({ outcome: "completed" });
      result.current.restart();
    });
    // completeGame called once for the explicit complete, not again for restart
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame).toHaveBeenCalledWith("session-1", { outcome: "completed" }, {});
    // New session started
    expect(mockStartGame).toHaveBeenCalledTimes(2);
  });

  it("restart() resets markStarted so unmount of new session without action does not abandon", async () => {
    mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
    const { result, unmount } = await renderHook(() => useGameSync("cascade"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.restart(); // resets startedRef
    });
    await unmount();
    // session-1 was abandoned by restart(); session-2 was never markStarted so no extra abandon
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "session-1",
      { outcome: "abandoned" },
      { outcome: "abandoned" }
    );
  });

  it("enqueue() after restart() sends to the new session id", async () => {
    mockStartGame.mockReturnValueOnce("old-id").mockReturnValueOnce("new-id");
    const { result } = await renderHook(() => useGameSync("cascade"));
    await act(() => {
      result.current.start();
      result.current.restart();
      result.current.enqueue({ type: "drop", data: { tier: 2 } });
    });
    expect(mockEnqueueEvent).toHaveBeenCalledWith("new-id", { type: "drop", data: { tier: 2 } });
  });

  // ---------------------------------------------------------------------------
  // reportBug
  // ---------------------------------------------------------------------------

  it("reportBug() delegates to gameEventClient.reportBug", async () => {
    const { result } = await renderHook(() => useGameSync("yacht"));
    await act(() => {
      result.current.reportBug("warn", "yacht.engine", "unexpected state", { round: 3 });
    });
    expect(mockReportBug).toHaveBeenCalledWith("warn", "yacht.engine", "unexpected state", {
      round: 3,
    });
  });
});

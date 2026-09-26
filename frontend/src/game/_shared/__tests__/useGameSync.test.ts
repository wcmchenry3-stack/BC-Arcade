import { renderHook, act } from "@testing-library/react-native";
import { AppState } from "react-native";
import { __resetForegroundClockForTests } from "../foregroundClock";
import { IDLE_GAP_CAP_MS, useGameSync } from "../useGameSync";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockStartGame = jest.fn<string, any[]>(() => "test-game-id");
const mockEnqueueEvent = jest.fn();
const mockMarkStarted = jest.fn();
const mockCompleteGame = jest.fn();
const mockReportBug = jest.fn();
const mockDiscardGame = jest.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockResumeGame = jest.fn<string | null, any[]>(() => null);
const mockSetProgressOutcome = jest.fn();

jest.mock("../gameEventClient", () => ({
  gameEventClient: {
    startGame: (...args: unknown[]) => mockStartGame(...args),
    markStarted: (...args: unknown[]) => mockMarkStarted(...args),
    enqueueEvent: (...args: unknown[]) => mockEnqueueEvent(...args),
    completeGame: (...args: unknown[]) => mockCompleteGame(...args),
    reportBug: (...args: unknown[]) => mockReportBug(...args),
    discardGame: (...args: unknown[]) => mockDiscardGame(...args),
    resumeGame: (...args: unknown[]) => mockResumeGame(...args),
    setProgressOutcome: (...args: unknown[]) => mockSetProgressOutcome(...args),
  },
}));

// The hook runs against the real foreground clock here, not the shared mock
// jest.setup.ts pins for every other file (#2710).
jest.unmock("../foregroundClock");

// The active-play window (#2684) reads foregroundNow(), which runs on
// performance.now(); fake timers keep it still unless a test advances it, so
// the tests below see exact summaries. The foreground clock is reset each test
// so its one AppState subscription lands in `appStateListeners`.
let appStateListeners: ((state: string) => void)[] = [];

async function fireAppState(state: string) {
  await act(() => {
    appStateListeners.forEach((h) => h(state));
  });
}

describe("useGameSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: 1_700_000_000_000 });
    mockStartGame.mockReturnValue("test-game-id");
    mockResumeGame.mockReturnValue(null);
    appStateListeners = [];
    (AppState.addEventListener as jest.Mock).mockImplementation(
      (_event: string, handler: (state: string) => void) => {
        appStateListeners.push(handler);
        return {
          remove: jest.fn(() => {
            appStateListeners = appStateListeners.filter((h) => h !== handler);
          }),
        };
      }
    );
    __resetForegroundClockForTests();
  });

  afterEach(() => {
    __resetForegroundClockForTests();
    jest.useRealTimers();
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

  // #2706: callers used to read getGameId() before complete() closed the
  // session, so a later edit moving that read below complete() silently got
  // null. complete() now hands back the id it closed, so there is nothing to
  // read beforehand.
  describe("complete() return value (#2706)", () => {
    it("returns the id of the session it closed", async () => {
      const { result } = await renderHook(() => useGameSync("yacht"));
      let closedId: string | null = null;
      await act(() => {
        result.current.start();
        closedId = result.current.complete({ outcome: "completed" });
      });
      expect(closedId).toBe("test-game-id");
      expect(result.current.getGameId()).toBeNull();
    });

    it("returns null when no session is open", async () => {
      const { result } = await renderHook(() => useGameSync("yacht"));
      let closedId: string | null = "unset";
      await act(() => {
        closedId = result.current.complete({ outcome: "completed" });
      });
      expect(closedId).toBeNull();
      expect(mockCompleteGame).not.toHaveBeenCalled();
    });

    it("returns null on a second call — the session is already completed", async () => {
      const { result } = await renderHook(() => useGameSync("yacht"));
      let firstId: string | null = null;
      let secondId: string | null = "unset";
      await act(() => {
        result.current.start();
        firstId = result.current.complete({ outcome: "completed" });
        secondId = result.current.complete({ outcome: "completed" });
      });
      expect(firstId).toBe("test-game-id");
      expect(secondId).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // unmount cleanup
  // ---------------------------------------------------------------------------

  it("unmount without markStarted discards the session instead of abandoning it", async () => {
    const { result, unmount } = await renderHook(() => useGameSync("twenty48"));
    await act(() => {
      result.current.start();
      // player never took an action — no markStarted()
    });
    await unmount();
    expect(mockCompleteGame).not.toHaveBeenCalled();
    // Not left pending on the device for the rest of the process (#2654 review).
    expect(mockDiscardGame).toHaveBeenCalledWith("test-game-id");
  });

  it("unmount after complete() discards nothing", async () => {
    const { result, unmount } = await renderHook(() => useGameSync("twenty48"));
    await act(() => {
      result.current.start();
      result.current.complete({ outcome: "completed" });
    });
    await unmount();
    expect(mockDiscardGame).not.toHaveBeenCalled();
  });

  it("an unmount whose discardGame throws is isolated", async () => {
    mockDiscardGame.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const { result, unmount } = await renderHook(() => useGameSync("twenty48"));
    await act(() => {
      result.current.start();
    });
    await expect(unmount()).resolves.toBeUndefined();
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

  it("unmount abandon records a win when the snapshot already reports one (#2682)", async () => {
    const { result, unmount } = await renderHook(() => useGameSync("blackjack"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.setProgressSnapshot(() => ({
        result: { hands_won: 3 },
        outcome: "win",
      }));
    });
    await unmount();
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "test-game-id",
      { outcome: "win", result: { hands_won: 3 } },
      { hands_won: 3, outcome: "win" }
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

  // ---------------------------------------------------------------------------
  // progress outcome override (#2682) — mirrored to the device for the
  // killed-process sweep, so a "win" the snapshot reports survives a kill.
  // ---------------------------------------------------------------------------

  it("markStarted mirrors a win outcome the snapshot already reports", async () => {
    const { result } = await renderHook(() => useGameSync("blackjack"));
    await act(() => {
      result.current.start();
      result.current.setProgressSnapshot(() => ({ outcome: "win" }));
      result.current.markStarted();
    });
    expect(mockSetProgressOutcome).toHaveBeenCalledWith("test-game-id", "win");
  });

  it("enqueue mirrors a win outcome reported after the session already started", async () => {
    const { result } = await renderHook(() => useGameSync("blackjack"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
    });
    mockSetProgressOutcome.mockClear();
    await act(() => {
      result.current.setProgressSnapshot(() => ({ outcome: "win" }));
      result.current.enqueue({ type: "hand_won" });
    });
    expect(mockSetProgressOutcome).toHaveBeenCalledWith("test-game-id", "win");
  });

  it("mirrors nothing while the snapshot reports no outcome", async () => {
    const { result } = await renderHook(() => useGameSync("blackjack"));
    await act(() => {
      result.current.start();
      result.current.setProgressSnapshot(() => ({ result: {} }));
      result.current.markStarted();
      result.current.enqueue({ type: "hand_dealt" });
    });
    expect(mockSetProgressOutcome).not.toHaveBeenCalled();
  });

  it("a throwing snapshot getter is isolated from the win mirror", async () => {
    const { result } = await renderHook(() => useGameSync("blackjack"));
    await act(() => {
      result.current.start();
      result.current.setProgressSnapshot(() => {
        throw new Error("state gone");
      });
      result.current.markStarted();
    });
    expect(mockSetProgressOutcome).not.toHaveBeenCalled();
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
  // start() over an open session (#2654 review)
  // ---------------------------------------------------------------------------

  it("start() over an untouched open session discards it", async () => {
    mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
    const { result } = await renderHook(() => useGameSync("sudoku"));
    await act(() => {
      result.current.start();
      result.current.start();
    });
    expect(mockDiscardGame).toHaveBeenCalledWith("session-1");
    expect(mockCompleteGame).not.toHaveBeenCalled();
    expect(result.current.getGameId()).toBe("session-2");
  });

  it("start() over a started open session abandons it", async () => {
    mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
    const { result } = await renderHook(() => useGameSync("sudoku"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.start();
    });
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "session-1",
      { outcome: "abandoned" },
      { outcome: "abandoned" }
    );
    expect(mockDiscardGame).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // resume (#2654): a restored game continues the killed process's session
  // ---------------------------------------------------------------------------

  describe("resume()", () => {
    it("adopts the killed process's session: no new session, already started", async () => {
      mockResumeGame.mockReturnValueOnce("orphan-id");
      const { result, unmount } = await renderHook(() => useGameSync("twenty48"));
      let resumed = false;
      await act(() => {
        resumed = result.current.resume();
        result.current.markStarted();
        result.current.enqueue({ type: "move" });
      });
      expect(resumed).toBe(true);
      expect(mockResumeGame).toHaveBeenCalledWith("twenty48", undefined);
      expect(mockStartGame).not.toHaveBeenCalled();
      expect(mockMarkStarted).not.toHaveBeenCalled(); // it is started already
      expect(result.current.getGameId()).toBe("orphan-id");
      expect(mockEnqueueEvent).toHaveBeenCalledWith("orphan-id", { type: "move" });
      // Leaving the screen abandons it, like any started session.
      await unmount();
      expect(mockCompleteGame).toHaveBeenCalledWith(
        "orphan-id",
        { outcome: "abandoned" },
        { outcome: "abandoned" }
      );
    });

    it("completes the adopted session", async () => {
      mockResumeGame.mockReturnValueOnce("orphan-id");
      const { result } = await renderHook(() => useGameSync("twenty48"));
      await act(() => {
        result.current.resume();
        result.current.complete({ outcome: "completed", finalScore: 64 });
      });
      expect(mockCompleteGame).toHaveBeenCalledWith(
        "orphan-id",
        { outcome: "completed", finalScore: 64 },
        {}
      );
    });

    it("passes a metadata match through", async () => {
      const { result } = await renderHook(() => useGameSync("daily_word"));
      await act(() => {
        result.current.resume({ puzzle_id: "p1" });
      });
      expect(mockResumeGame).toHaveBeenCalledWith("daily_word", { puzzle_id: "p1" });
    });

    it("with nothing to resume, changes nothing and returns false", async () => {
      const { result } = await renderHook(() => useGameSync("cascade"));
      let resumed = true;
      await act(() => {
        result.current.start();
        resumed = result.current.resume();
      });
      expect(resumed).toBe(false);
      expect(result.current.getGameId()).toBe("test-game-id");
      expect(mockDiscardGame).not.toHaveBeenCalled();
    });

    it("replaces an untouched open session, which is discarded", async () => {
      mockResumeGame.mockReturnValueOnce("orphan-id");
      const { result } = await renderHook(() => useGameSync("cascade"));
      await act(() => {
        result.current.start();
        result.current.resume();
      });
      expect(mockDiscardGame).toHaveBeenCalledWith("test-game-id");
      expect(result.current.getGameId()).toBe("orphan-id");
    });

    it("a throwing resumeGame is isolated: false, and the screen starts as usual", async () => {
      mockResumeGame.mockImplementationOnce(() => {
        throw new Error("boom");
      });
      const { result } = await renderHook(() => useGameSync("cascade"));
      let resumed = true;
      await act(() => {
        resumed = result.current.resume();
      });
      expect(resumed).toBe(false);
      expect(result.current.getGameId()).toBeNull();
    });
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
  // not an abandon. It is discarded instead, so it is not left pending.
  it("restart() before markStarted() discards the old session instead of abandoning it", async () => {
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
    expect(mockDiscardGame).toHaveBeenCalledTimes(1);
    expect(mockDiscardGame).toHaveBeenCalledWith("session-1");
    expect(mockStartGame).toHaveBeenCalledTimes(2);
    expect(result.current.getGameId()).toBe("session-2");
  });

  // close() (#2628): restart()'s close without the new session.
  describe("close()", () => {
    it("abandons a started session with its snapshot and opens no new one", async () => {
      const { result } = await renderHook(() => useGameSync("blackjack"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
        result.current.setProgressSnapshot(() => ({ result: { hands_won: 0 } }));
      });
      await act(() => {
        result.current.close();
      });
      expect(mockCompleteGame).toHaveBeenCalledWith(
        "test-game-id",
        { outcome: "abandoned", result: { hands_won: 0 } },
        { hands_won: 0, outcome: "abandoned" }
      );
      expect(mockStartGame).toHaveBeenCalledTimes(1);
      expect(result.current.getGameId()).toBeNull();
    });

    it("discards a session the player never started", async () => {
      const { result, unmount } = await renderHook(() => useGameSync("blackjack"));
      await act(() => {
        result.current.start();
      });
      await act(() => {
        result.current.close();
      });
      expect(mockCompleteGame).not.toHaveBeenCalled();
      expect(mockDiscardGame).toHaveBeenCalledWith("test-game-id");
      // Nothing left open for the unmount to close.
      await unmount();
      expect(mockCompleteGame).not.toHaveBeenCalled();
      expect(mockDiscardGame).toHaveBeenCalledTimes(1);
    });

    it("does nothing after complete()", async () => {
      const { result } = await renderHook(() => useGameSync("blackjack"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
        result.current.complete({ outcome: "win" });
      });
      await act(() => {
        result.current.close();
      });
      expect(mockCompleteGame).toHaveBeenCalledTimes(1);
      expect(mockDiscardGame).not.toHaveBeenCalled();
    });
  });

  it("restart() still starts a new session when discardGame throws", async () => {
    mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
    mockDiscardGame.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const { result } = await renderHook(() => useGameSync("cascade"));
    await act(() => {
      result.current.start();
    });
    await act(() => {
      result.current.restart();
    });
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
    expect(mockDiscardGame).not.toHaveBeenCalled();
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
  // markStarted -> gameEventClient (#2654): the deferred create waits on it
  // ---------------------------------------------------------------------------

  it("markStarted() tells gameEventClient once per session", async () => {
    const { result } = await renderHook(() => useGameSync("yacht"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.markStarted();
    });
    expect(mockMarkStarted).toHaveBeenCalledTimes(1);
    expect(mockMarkStarted).toHaveBeenCalledWith("test-game-id");
  });

  it("markStarted() after restart() marks the new session", async () => {
    mockStartGame.mockReturnValueOnce("first-id").mockReturnValueOnce("second-id");
    const { result } = await renderHook(() => useGameSync("cascade"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
      result.current.restart();
      result.current.markStarted();
    });
    expect(mockMarkStarted.mock.calls).toEqual([["first-id"], ["second-id"]]);
  });

  it("markStarted() with no open session does not reach gameEventClient", async () => {
    const { result } = await renderHook(() => useGameSync("yacht"));
    await act(() => {
      result.current.markStarted();
    });
    await act(() => {
      result.current.start();
      result.current.complete({ outcome: "completed" });
      result.current.markStarted();
    });
    expect(mockMarkStarted).not.toHaveBeenCalled();
  });

  it("a throwing gameEventClient.markStarted does not break the session", async () => {
    mockMarkStarted.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const { result, unmount } = await renderHook(() => useGameSync("yacht"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
    });
    await unmount();
    // Still counted as started: the unmount abandons it.
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "test-game-id",
      { outcome: "abandoned" },
      { outcome: "abandoned" }
    );
  });

  // ---------------------------------------------------------------------------
  // active-play window (#2684): games without their own duration still send one
  // ---------------------------------------------------------------------------

  describe("active-play window", () => {
    const MIN = 60 * 1000;

    function sentSummary(call = 0) {
      return mockCompleteGame.mock.calls[call]![1] as Record<string, unknown>;
    }

    async function advance(ms: number) {
      await act(() => {
        jest.advanceTimersByTime(ms);
      });
    }

    it("counts the thinking time before the first action", async () => {
      const { result } = await renderHook(() => useGameSync("daily_word"));
      await advance(40_000); // reading the board
      await act(() => {
        result.current.start(); // the screen opens its session at the first move
        result.current.markStarted();
      });
      await advance(2_000);
      await act(() => {
        result.current.complete({ outcome: "win" });
      });
      expect(sentSummary().durationMs).toBe(42_000);
    });

    it("a game won on its first action gets a duration", async () => {
      const { result } = await renderHook(() => useGameSync("freecell"));
      await advance(15_000);
      await act(() => {
        result.current.start();
        result.current.complete({ outcome: "completed" }); // never markStarted
      });
      expect(mockCompleteGame).toHaveBeenCalledWith(
        "test-game-id",
        { outcome: "completed", durationMs: 15_000 },
        {}
      );
    });

    it("a 30-minute idle gap counts 10 minutes", async () => {
      expect(IDLE_GAP_CAP_MS).toBe(10 * MIN);
      const { result } = await renderHook(() => useGameSync("yacht"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
      });
      await advance(1 * MIN);
      await act(() => result.current.enqueue({ type: "roll" }));
      await advance(30 * MIN); // screen left awake
      await act(() => result.current.enqueue({ type: "roll" }));
      await advance(2 * MIN);
      await act(() => {
        result.current.complete({ outcome: "completed" });
      });
      expect(sentSummary().durationMs).toBe(1 * MIN + 10 * MIN + 2 * MIN);
    });

    it("caps the open gap too: an idle screen's abandon counts at most 10 minutes", async () => {
      const { result, unmount } = await renderHook(() => useGameSync("sort"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
      });
      await advance(3 * 60 * MIN);
      await unmount();
      expect(sentSummary()).toEqual({ outcome: "abandoned", durationMs: 10 * MIN });
    });

    it.each(["background", "inactive"])("does not count time the app is %s", async (state) => {
      const { result } = await renderHook(() => useGameSync("daily_word"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
      });
      await advance(10_000);
      await fireAppState(state);
      await advance(60 * MIN); // an hour away: not even the cap counts
      await fireAppState("active");
      await advance(3_000);
      await act(() => {
        result.current.complete({ outcome: "win" });
      });
      expect(sentSummary().durationMs).toBe(13_000);
    });

    it("the game's own durationMs > 0 wins over the window", async () => {
      const { result } = await renderHook(() => useGameSync("solitaire"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
      });
      await advance(90_000);
      await act(() => {
        result.current.complete({ outcome: "completed", durationMs: 12_345 });
      });
      expect(sentSummary().durationMs).toBe(12_345);
    });

    it.each([0, null, -5, Number.NaN])(
      "a game durationMs of %p falls back to the window",
      async (own) => {
        const { result } = await renderHook(() => useGameSync("hearts"));
        await act(() => {
          result.current.start();
          result.current.markStarted();
        });
        await advance(7_000);
        await act(() => {
          result.current.complete({ outcome: "completed", durationMs: own });
        });
        expect(sentSummary().durationMs).toBe(7_000);
      }
    );

    it("unmount abandon sends the window", async () => {
      const { result, unmount } = await renderHook(() => useGameSync("yacht"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
      });
      await advance(20_000);
      await unmount();
      expect(mockCompleteGame).toHaveBeenCalledWith(
        "test-game-id",
        { outcome: "abandoned", durationMs: 20_000 },
        { outcome: "abandoned" }
      );
    });

    it("a snapshot durationMs > 0 wins over the window on the hook's abandon", async () => {
      const { result, unmount } = await renderHook(() => useGameSync("solitaire"));
      await act(() => {
        result.current.setProgressSnapshot(() => ({ result: { moves: 3 }, durationMs: 4_000 }));
        result.current.start();
        result.current.markStarted();
      });
      await advance(20_000);
      await unmount();
      expect(sentSummary()).toEqual({
        outcome: "abandoned",
        result: { moves: 3 },
        durationMs: 4_000,
      });
    });

    it("restart() abandons with the old session's window, then the new one starts from zero", async () => {
      mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
      const { result } = await renderHook(() => useGameSync("freecell"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
      });
      await advance(30_000);
      await act(() => {
        result.current.restart();
      });
      await advance(4_000);
      await act(() => {
        result.current.markStarted();
        result.current.complete({ outcome: "completed" });
      });
      expect(mockCompleteGame.mock.calls[0]![0]).toBe("session-1");
      expect(sentSummary(0)).toEqual({ outcome: "abandoned", durationMs: 30_000 });
      expect(mockCompleteGame.mock.calls[1]![0]).toBe("session-2");
      expect(sentSummary(1).durationMs).toBe(4_000);
    });

    // #2710 — a session ending pauses the window at zero; start() resumes it.
    it("close() of an unstarted session pauses the window until the next start()", async () => {
      mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
      const { result } = await renderHook(() => useGameSync("blackjack"));
      await act(() => {
        result.current.start();
      });
      await advance(50_000);
      await act(() => {
        result.current.close(); // never started: discarded, sends nothing
      });
      expect(mockDiscardGame).toHaveBeenCalledWith("session-1");
      await advance(6_000); // on a menu
      await act(() => {
        result.current.start();
      });
      await advance(3_000);
      await act(() => {
        result.current.markStarted();
        result.current.complete({ outcome: "win" });
      });
      expect(mockCompleteGame).toHaveBeenCalledTimes(1);
      expect(sentSummary(0).durationMs).toBe(3_000);
    });

    it("close() on a started session abandons with the window, then pauses it", async () => {
      mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
      const { result } = await renderHook(() => useGameSync("blackjack"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
      });
      await advance(8_000);
      await act(() => {
        result.current.close();
      });
      await advance(60_000); // on the table picker
      await act(() => {
        result.current.start();
      });
      await advance(2_000);
      await act(() => {
        result.current.complete({ outcome: "loss" });
      });
      expect(sentSummary(0)).toEqual({ outcome: "abandoned", durationMs: 8_000 });
      expect(sentSummary(1).durationMs).toBe(2_000);
    });

    it("complete() pauses the window: time on the result card is not counted", async () => {
      mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
      const { result } = await renderHook(() => useGameSync("yacht"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
      });
      await advance(8_000);
      await act(() => {
        result.current.complete({ outcome: "win" });
      });
      await advance(3 * MIN); // on the result card
      await act(() => {
        result.current.start(); // Play Again
      });
      await advance(4_000);
      await act(() => {
        result.current.complete({ outcome: "win" });
      });
      expect(sentSummary(0).durationMs).toBe(8_000);
      expect(sentSummary(1).durationMs).toBe(4_000);
    });

    it("while paused, pings add nothing", async () => {
      mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
      const { result } = await renderHook(() => useGameSync("starswarm"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
        result.current.complete({ outcome: "completed" });
      });
      await advance(5 * MIN);
      await act(() => {
        result.current.enqueue({ type: "menu_tap", data: {} });
        result.current.markStarted();
      });
      await advance(5 * MIN);
      await act(() => {
        result.current.restart(); // New Run
      });
      await advance(7_000);
      await act(() => {
        result.current.markStarted();
        result.current.complete({ outcome: "completed" });
      });
      expect(sentSummary(1).durationMs).toBe(7_000);
    });

    it("start() right after a pause sends no duration for a session with no time in it", async () => {
      mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
      const { result } = await renderHook(() => useGameSync("yacht"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
      });
      await advance(8_000);
      await act(() => {
        result.current.complete({ outcome: "win" });
      });
      await advance(2 * MIN);
      await act(() => {
        result.current.start();
        result.current.complete({ outcome: "win" });
      });
      expect(sentSummary(1)).toEqual({ outcome: "win" });
    });

    it("start() leaves a running window alone: the time before the first game's first move counts", async () => {
      mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
      const { result } = await renderHook(() => useGameSync("freecell"));
      await advance(20_000); // looking at the first deal
      await act(() => {
        result.current.start();
        result.current.start(); // a second start() with nothing played between
      });
      await advance(5_000);
      await act(() => {
        result.current.markStarted();
        result.current.complete({ outcome: "completed" });
      });
      // session-1 was never started: discarded, and the window pauses; the
      // second start() resumes it from zero.
      expect(mockDiscardGame).toHaveBeenCalledWith("session-1");
      expect(sentSummary(0).durationMs).toBe(5_000);
    });

    // #2710 — a screen that shows a menu or result card before the next puzzle
    // restarts the window when the puzzle appears.
    it("resetPlayWindow() drops the time before it: the next session counts from the reset", async () => {
      const { result } = await renderHook(() => useGameSync("sort"));
      await advance(5 * MIN); // browsing the level grid
      await act(() => {
        result.current.resetPlayWindow(); // a level appears
      });
      await advance(20_000);
      await act(() => {
        result.current.start(); // the first move opens the session
        result.current.markStarted();
      });
      await advance(5_000);
      await act(() => {
        result.current.complete({ outcome: "completed" });
      });
      expect(sentSummary().durationMs).toBe(25_000);
    });

    it("resetPlayWindow() after a pause runs the window from the new deal, before the first move", async () => {
      mockStartGame.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
      const { result } = await renderHook(() => useGameSync("freecell"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
      });
      await advance(8_000);
      await act(() => {
        result.current.complete({ outcome: "completed" });
      });
      await advance(3 * MIN); // on the win card
      await act(() => {
        result.current.resetPlayWindow(); // a new deal
      });
      await advance(4_000); // thinking before the first move
      await act(() => {
        result.current.start(); // a running window: left alone
      });
      await advance(1_000);
      await act(() => {
        result.current.complete({ outcome: "completed" });
      });
      expect(sentSummary(0).durationMs).toBe(8_000);
      expect(sentSummary(1).durationMs).toBe(5_000);
    });

    it("an unstarted session's discard sends nothing", async () => {
      const { result, unmount } = await renderHook(() => useGameSync("yacht"));
      await act(() => {
        result.current.start();
      });
      await advance(60_000);
      await unmount();
      expect(mockCompleteGame).not.toHaveBeenCalled();
      expect(mockDiscardGame).toHaveBeenCalledWith("test-game-id");
    });

    it("a still clock sends no duration", async () => {
      const { result } = await renderHook(() => useGameSync("yacht"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
        result.current.complete({ outcome: "completed", finalScore: 10 });
      });
      expect(sentSummary()).toEqual({ outcome: "completed", finalScore: 10 });
    });

    it("resume() counts from the resume, not the mount or the killed session's start", async () => {
      mockResumeGame.mockReturnValueOnce("orphan-id");
      const { result } = await renderHook(() => useGameSync("daily_word"));
      await advance(2 * MIN); // on a menu before Continue
      await act(() => {
        result.current.resume({ puzzle_id: "p1" });
      });
      await advance(9_000);
      await act(() => {
        result.current.complete({ outcome: "loss" });
      });
      expect(mockCompleteGame).toHaveBeenCalledWith(
        "orphan-id",
        { outcome: "loss", durationMs: 9_000 },
        {}
      );
    });

    it("resume() after a pause restarts the window from the resume", async () => {
      mockStartGame.mockReturnValueOnce("session-1");
      mockResumeGame.mockReturnValueOnce("orphan-id");
      const { result } = await renderHook(() => useGameSync("sort"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
        result.current.complete({ outcome: "completed" });
      });
      await advance(MIN);
      await act(() => {
        result.current.resume();
      });
      await advance(6_000);
      await act(() => {
        result.current.complete({ outcome: "completed" });
      });
      expect(sentSummary(1).durationMs).toBe(6_000);
    });

    it("resume() over a started session abandons it with its own window", async () => {
      mockStartGame.mockReturnValueOnce("session-1");
      mockResumeGame.mockReturnValueOnce("orphan-id");
      const { result } = await renderHook(() => useGameSync("daily_word"));
      await act(() => {
        result.current.start();
        result.current.markStarted();
      });
      await advance(6_000);
      await act(() => {
        result.current.resume();
      });
      await advance(1_000);
      await act(() => {
        result.current.complete({ outcome: "win" });
      });
      expect(sentSummary(0)).toEqual({ outcome: "abandoned", durationMs: 6_000 });
      expect(sentSummary(1).durationMs).toBe(1_000);
    });

    it("hook instances share one AppState subscription", async () => {
      const a = await renderHook(() => useGameSync("yacht"));
      const b = await renderHook(() => useGameSync("sort"));
      await act(() => {
        a.result.current.restart();
      });
      await b.rerender({});
      expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
      expect(appStateListeners).toHaveLength(1);
      await a.unmount();
      await b.unmount();
    });
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

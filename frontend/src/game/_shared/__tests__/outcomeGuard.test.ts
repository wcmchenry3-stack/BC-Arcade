/**
 * The outcome guard (#2642): a game with no winner never records `win`,
 * `loss` or `push`. Checked for the rule itself, its development and
 * production behaviour, and every path in `useGameSync` that writes an
 * outcome. The killed-session sweep is in `outcomeGuard.sweep.test.ts`.
 */

import * as Sentry from "@sentry/react-native";
import { act, renderHook } from "@testing-library/react-native";
import {
  GAME_OUTCOMES,
  GAME_TYPES,
  HAS_WINNER,
  LIFECYCLE_OUTCOMES,
  RESULT_OUTCOMES,
} from "../../../api/vocab";
import {
  assertOutcomeAllowed,
  isOutcomeAllowed,
  OutcomeNotAllowedError,
  setOutcomeGuardStrictForTests,
} from "../outcomeGuard";
import { useGameSync } from "../useGameSync";

const mockCompleteGame = jest.fn();
const mockSetProgressOutcome = jest.fn();
jest.mock("../gameEventClient", () => ({
  gameEventClient: {
    startGame: jest.fn(() => "game-1"),
    markStarted: jest.fn(),
    enqueueEvent: jest.fn(),
    completeGame: (...args: unknown[]) => mockCompleteGame(...args),
    reportBug: jest.fn(),
    discardGame: jest.fn(),
    resumeGame: jest.fn(() => null),
    setProgressOutcome: (...args: unknown[]) => mockSetProgressOutcome(...args),
  },
}));

const captureMessage = Sentry.captureMessage as jest.Mock;

const WINNERLESS = GAME_TYPES.filter((g) => !HAS_WINNER[g]);

beforeEach(() => {
  mockCompleteGame.mockReset();
  mockSetProgressOutcome.mockReset();
  captureMessage.mockClear();
  setOutcomeGuardStrictForTests(null);
});

afterAll(() => {
  setOutcomeGuardStrictForTests(null);
});

describe("the rule", () => {
  it("has games of both kinds to apply to", () => {
    expect(WINNERLESS.length).toBeGreaterThan(0);
    expect(WINNERLESS.length).toBeLessThan(GAME_TYPES.length);
  });

  it("splits the outcomes into result and lifecycle outcomes", () => {
    expect([...RESULT_OUTCOMES, ...LIFECYCLE_OUTCOMES].sort()).toEqual([...GAME_OUTCOMES].sort());
  });

  it.each(GAME_TYPES)("%s: allows exactly the outcomes HAS_WINNER says", (game) => {
    for (const outcome of LIFECYCLE_OUTCOMES) expect(isOutcomeAllowed(game, outcome)).toBe(true);
    for (const outcome of RESULT_OUTCOMES) {
      expect(isOutcomeAllowed(game, outcome)).toBe(HAS_WINNER[game]);
    }
    expect(isOutcomeAllowed(game, undefined)).toBe(true);
  });

  it("has no rule for an unknown game type", () => {
    expect(isOutcomeAllowed("not_a_game", "win")).toBe(true);
  });
});

describe("assertOutcomeAllowed", () => {
  it("throws in tests (development) with a clear message", () => {
    expect(() => assertOutcomeAllowed("starswarm", "win", "complete")).toThrow(
      OutcomeNotAllowedError
    );
    expect(() => assertOutcomeAllowed("freecell", "push", "complete")).toThrow(
      /freecell has no winner .* recorded "push" \(complete\)/
    );
    expect(() => assertOutcomeAllowed("hearts", "win", "complete")).not.toThrow();
    expect(() => assertOutcomeAllowed("starswarm", "completed", "complete")).not.toThrow();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("in production never throws, and reports once per game and outcome", () => {
    setOutcomeGuardStrictForTests(false);
    expect(() => assertOutcomeAllowed("starswarm", "win", "complete")).not.toThrow();
    assertOutcomeAllowed("starswarm", "win", "abandon");
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('starswarm has no winner (has_winner is false) but recorded "win"'),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ subsystem: "outcomeGuard", gameType: "starswarm" }),
      })
    );
    assertOutcomeAllowed("starswarm", "loss", "complete");
    expect(captureMessage).toHaveBeenCalledTimes(2);
    assertOutcomeAllowed("hearts", "loss", "complete");
    expect(captureMessage).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// useGameSync: every path that writes an outcome
// ---------------------------------------------------------------------------

async function openStarted(game: (typeof GAME_TYPES)[number]) {
  const hook = await renderHook(() => useGameSync(game));
  await act(() => {
    hook.result.current.start();
    hook.result.current.markStarted();
  });
  return hook;
}

function sentOutcomes(): unknown[] {
  return mockCompleteGame.mock.calls.map((c) => (c[1] as { outcome?: unknown }).outcome);
}

describe("useGameSync", () => {
  it.each(WINNERLESS)(
    "%s: complete() with a result outcome throws and sends nothing",
    async (g) => {
      const { result } = await openStarted(g);
      for (const outcome of RESULT_OUTCOMES) {
        expect(() => result.current.complete({ outcome })).toThrow(OutcomeNotAllowedError);
      }
      expect(mockCompleteGame).not.toHaveBeenCalled();
      // The session is still open: the right outcome goes through.
      await act(() => {
        result.current.complete({ outcome: "completed" });
      });
      expect(sentOutcomes()).toEqual(["completed"]);
    }
  );

  it("a game with a winner records its results", async () => {
    const { result } = await openStarted("hearts");
    await act(() => {
      result.current.complete({ outcome: "push" });
    });
    expect(sentOutcomes()).toEqual(["push"]);
  });

  it("a win snapshot in a game with no winner throws at the next ping, before reaching the device", async () => {
    const { result } = await openStarted("starswarm");
    result.current.setProgressSnapshot(() => ({ outcome: "win" }));
    expect(() => result.current.enqueue({ type: "wave_cleared" })).toThrow(
      /starswarm .* recorded "win" \(progressSnapshot\)/
    );
    expect(mockSetProgressOutcome).not.toHaveBeenCalled();
    // Clear it, or the abandon on the test's cleanup unmount would throw too.
    result.current.setProgressSnapshot(() => ({}));
  });

  it("a win snapshot in a game with no winner throws on the unmount abandon", async () => {
    const hook = await openStarted("starswarm");
    hook.result.current.setProgressSnapshot(() => ({ outcome: "win" }));
    await expect(hook.unmount()).rejects.toThrow(/recorded "win" \(abandon\)/);
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("a win snapshot in a game with no winner throws on restart's abandon", async () => {
    const hook = await renderHook(() => useGameSync("starswarm"));
    await act(() => {
      hook.result.current.start();
      hook.result.current.markStarted();
    });
    // Registered after the last ping, so only the abandon sees it.
    hook.result.current.setProgressSnapshot(() => ({ outcome: "win" }));
    expect(() => hook.result.current.restart()).toThrow(/recorded "win" \(abandon\)/);
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("a win snapshot in a game with a winner is mirrored and recorded on unmount", async () => {
    const hook = await openStarted("blackjack");
    await act(() => {
      hook.result.current.setProgressSnapshot(() => ({ outcome: "win" }));
      hook.result.current.enqueue({ type: "hand_won" });
    });
    expect(mockSetProgressOutcome).toHaveBeenCalledWith("game-1", "win");
    await hook.unmount();
    expect(sentOutcomes()).toEqual(["win"]);
  });

  describe("in production", () => {
    beforeEach(() => setOutcomeGuardStrictForTests(false));

    it("complete() sends the outcome unchanged and reports it once", async () => {
      const { result } = await openStarted("starswarm");
      await act(() => {
        result.current.complete({ outcome: "win" });
      });
      expect(sentOutcomes()).toEqual(["win"]);
      expect(captureMessage).toHaveBeenCalledTimes(1);
    });

    it("a win snapshot is mirrored and recorded on unmount unchanged, reported once", async () => {
      const hook = await openStarted("starswarm");
      await act(() => {
        hook.result.current.setProgressSnapshot(() => ({ outcome: "win" }));
        hook.result.current.enqueue({ type: "wave_cleared" });
      });
      expect(mockSetProgressOutcome).toHaveBeenCalledWith("game-1", "win");
      await hook.unmount();
      expect(sentOutcomes()).toEqual(["win"]);
      expect(captureMessage).toHaveBeenCalledTimes(1);
    });
  });
});

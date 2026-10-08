import { act, renderHook } from "@testing-library/react-native";
import { createSeededRng, newGame, setRng } from "../engine";
import type { GameState } from "../types";
import { holdStrategy, scoreStrategy } from "../ai";
import { useYachtCpuOpponent, type YachtCpuOpponentOptions } from "../useYachtCpuOpponent";

jest.mock("../ai", () => ({
  holdStrategy: jest.fn(),
  scoreStrategy: jest.fn(),
}));
jest.mock("../oracle/oracle", () => ({
  preloadOracleTable: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the global Sentry mock from jest.setup.ts
const Sentry = require("@sentry/react-native") as { captureException: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the jest.mock above
const { preloadOracleTable } = require("../oracle/oracle") as { preloadOracleTable: jest.Mock };

const mockHold = holdStrategy as jest.Mock;
const mockScore = scoreStrategy as jest.Mock;
const ALL_HELD = [true, true, true, true, true];

function render(options: Partial<YachtCpuOpponentOptions> = {}) {
  return renderHook(() =>
    useYachtCpuOpponent({ difficulty: "medium", initialState: newGame(), ...options })
  );
}

/** Runs the turn's paced steps to the end. */
async function playOut() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  setRng(createSeededRng(7));
  mockHold.mockReturnValue(ALL_HELD);
  mockScore.mockReturnValue("chance");
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useYachtCpuOpponent", () => {
  it("starts idle, with the restored scorecard", async () => {
    const initial = newGame();
    const { result } = await render({ initialState: initial });
    expect(result.current.isTurn).toBe(false);
    expect(result.current.state).toBe(initial);
    expect(result.current.rollingIndices).toEqual([]);
  });

  it("has no scorecard in a solo game, and a started turn does nothing", async () => {
    const { result } = await render({ difficulty: null, initialState: null });
    expect(result.current.state).toBeNull();
    await act(async () => result.current.startTurn());
    await playOut();
    expect(mockScore).not.toHaveBeenCalled();
  });

  it("preloads the oracle table only with an opponent", async () => {
    await render({ difficulty: null, initialState: null });
    expect(preloadOracleTable).not.toHaveBeenCalled();
    await render({ difficulty: "hard" });
    expect(preloadOracleTable).toHaveBeenCalledTimes(1);
  });

  it("plays a turn: rolls all dice, scores, hands back control and reports the scorecard", async () => {
    const onTurnDone = jest.fn();
    const { result } = await render({ onTurnDone });

    await act(async () => result.current.startTurn());
    expect(result.current.isTurn).toBe(true);
    // The opening roll is applied before its animation starts.
    expect(result.current.state!.rolls_used).toBe(1);
    expect(result.current.rollingIndices).toEqual([0, 1, 2, 3, 4]);

    await playOut();
    expect(result.current.isTurn).toBe(false);
    expect(result.current.rollingIndices).toEqual([]);
    expect(mockScore).toHaveBeenCalledWith(expect.anything(), "medium");
    expect(result.current.state!.scores.chance).not.toBeNull();
    expect(result.current.state!.round).toBe(2);
    expect(onTurnDone).toHaveBeenCalledTimes(1);
    expect(onTurnDone).toHaveBeenCalledWith(result.current.state);
  });

  it("re-rolls the dice it does not hold, up to three rolls", async () => {
    mockHold.mockReturnValue([true, false, true, false, false]);
    const { result } = await render();
    await act(async () => result.current.startTurn());
    // Opening roll, settle pause, hold decision.
    for (const ms of [1000, 800, 800]) {
      await act(async () => {
        jest.advanceTimersByTime(ms);
      });
    }
    // The hold decision is shown, then only the free dice roll.
    expect(result.current.state!.rolls_used).toBe(2);
    expect(result.current.rollingIndices).toEqual([1, 3, 4]);
    await playOut();
    expect(result.current.state!.round).toBe(2);
    expect(mockHold).toHaveBeenCalledTimes(2);
  });

  it("resumes a turn killed after it rolled, keeping its dice (#2203)", async () => {
    const midTurn: GameState = { ...newGame(), dice: [6, 6, 6, 6, 6], rolls_used: 3 };
    const { result } = await render({ initialState: midTurn, resumeTurn: true });
    expect(result.current.isTurn).toBe(true);
    await playOut();
    expect(mockHold).not.toHaveBeenCalled();
    expect(mockScore).toHaveBeenCalledWith(
      expect.objectContaining({ dice: [6, 6, 6, 6, 6] }),
      "medium"
    );
    expect(result.current.isTurn).toBe(false);
  });

  it("finishes the turn with the fallback when it throws, so the computer never falls behind", async () => {
    mockScore.mockImplementation(() => {
      throw new Error("strategy failed");
    });
    const onTurnDone = jest.fn();
    const { result } = await render({ onTurnDone });
    await act(async () => result.current.startTurn());
    await playOut();
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { subsystem: "yacht.ai", op: "runAiTurn" },
    });
    expect(result.current.isTurn).toBe(false);
    expect(result.current.state!.round).toBe(2);
    expect(onTurnDone).toHaveBeenCalledWith(result.current.state);
  });

  it("endTurn cancels a running turn at its next step", async () => {
    const onTurnDone = jest.fn();
    const { result } = await render({ onTurnDone });
    await act(async () => result.current.startTurn());
    await act(async () => result.current.endTurn());
    await playOut();
    expect(result.current.isTurn).toBe(false);
    expect(result.current.state!.round).toBe(1);
    expect(mockScore).not.toHaveBeenCalled();
    expect(onTurnDone).not.toHaveBeenCalled();
  });

  it("unmounting cancels a running turn", async () => {
    const onTurnDone = jest.fn();
    const { result, unmount } = await render({ onTurnDone });
    await act(async () => result.current.startTurn());
    await act(async () => unmount());
    await playOut();
    expect(mockScore).not.toHaveBeenCalled();
    expect(onTurnDone).not.toHaveBeenCalled();
  });

  it("onAppBackground drops the roll animation mid-turn", async () => {
    const { result } = await render();
    await act(async () => result.current.startTurn());
    expect(result.current.rollingIndices).toHaveLength(5);
    await act(async () => result.current.onAppBackground());
    expect(result.current.rollingIndices).toEqual([]);
  });

  it("mirrors the latest scorecard and difficulty into its refs", async () => {
    const next = { ...newGame(), round: 4 };
    const { result } = await render({ difficulty: "easy" });
    await act(async () => result.current.setState(next));
    expect(result.current.stateRef.current).toBe(next);
    expect(result.current.difficultyRef.current).toBe("easy");
  });
});

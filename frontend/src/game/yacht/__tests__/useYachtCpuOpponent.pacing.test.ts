/**
 * The computer's pacing (#3749), from `motion.ts`: a roll is its tumble plus a settle, a hold
 * 500 ms, a score beat 600 ms, at most 5 s a turn; its last turn after yours at 2x; under Reduce
 * Motion half the pauses (still step by step); a game reopened on its last turn scored at once.
 */
import { act, renderHook } from "@testing-library/react-native";
import { createSeededRng, newGame, setRng } from "../engine";
import type { GameState } from "../types";
import { holdStrategy, scoreStrategy } from "../ai";
import { useYachtCpuOpponent, type YachtCpuOpponentOptions } from "../useYachtCpuOpponent";
import { CPU_HOLD_MS, CPU_SETTLE_MS, cpuRollMs, cpuTurnMaxMs, tumbleTotalMs } from "../motion";

jest.mock("../ai", () => ({
  holdStrategy: jest.fn(),
  scoreStrategy: jest.fn(),
  scoreEvs: jest.fn(() => [0, 0]),
}));
jest.mock("../oracle/oracle", () => ({
  preloadOracleTable: jest.fn().mockResolvedValue(undefined),
}));

const mockHold = holdStrategy as jest.Mock;
const mockScore = scoreStrategy as jest.Mock;
const ALL_HELD = [true, true, true, true, true];
const NONE_HELD = [false, false, false, false, false];
/** Re-rolls the last two dice. */
const KEEP_THREE = [true, true, true, false, false];

function render(options: Partial<YachtCpuOpponentOptions> = {}) {
  return renderHook(
    (props: Partial<YachtCpuOpponentOptions>) =>
      useYachtCpuOpponent({ difficulty: "medium", initialState: newGame(), ...options, ...props }),
    { initialProps: {} }
  );
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

/** Plays a started turn to its end, and says how long it took (ms). */
async function turnLength(result: { current: { isTurn: boolean } }): Promise<number> {
  let t = 0;
  while (result.current.isTurn && t < 20_000) {
    await advance(5);
    t += 5;
  }
  return t;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  setRng(createSeededRng(7));
  mockHold.mockReturnValue(NONE_HELD);
  mockScore.mockReturnValue("chance");
});

afterEach(() => {
  jest.useRealTimers();
  setRng(Math.random);
});

describe("the computer's pacing (#3749)", () => {
  it("its longest turn (a roll and two re-rolls of five) takes cpuTurnMaxMs, 5 s or less", async () => {
    const { result } = await render();
    await act(async () => result.current.startTurn());
    const ms = await turnLength(result);
    expect(ms).toBe(cpuTurnMaxMs());
    expect(ms).toBeLessThanOrEqual(5000);
    expect(mockHold).toHaveBeenCalledTimes(2);
  });

  it("each roll tumbles for its dice's tumble, then settles; the hold shows before the re-roll", async () => {
    mockHold.mockReturnValue(KEEP_THREE);
    const { result } = await render();
    await act(async () => result.current.startTurn());
    // The opening roll: five dice tumble, then the board is still for the settle.
    expect(result.current.rollingIndices).toEqual([0, 1, 2, 3, 4]);
    expect(result.current.tumbleSpeed).toBe(1);
    await advance(tumbleTotalMs(5) - 5);
    expect(result.current.rollingIndices).toHaveLength(5);
    await advance(5);
    expect(result.current.rollingIndices).toEqual([]);
    // Settle, then the hold decision is shown on the dice it rolled.
    await advance(CPU_SETTLE_MS);
    expect(result.current.state!.held).toEqual(KEEP_THREE);
    expect(result.current.state!.rolls_used).toBe(1);
    await advance(CPU_HOLD_MS);
    // Only the two free dice tumble, for two dice's tumble.
    expect(result.current.rollingIndices).toEqual([3, 4]);
    expect(result.current.state!.rolls_used).toBe(2);
    await advance(tumbleTotalMs(2) - 5);
    expect(result.current.rollingIndices).toEqual([3, 4]);
    await advance(5);
    expect(result.current.rollingIndices).toEqual([]);
  });

  it("a turn that scores after one roll: roll, settle, score beat", async () => {
    mockHold.mockReturnValue(ALL_HELD);
    const { result } = await render();
    await act(async () => result.current.startTurn());
    expect(await turnLength(result)).toBe(cpuRollMs(5) + 600);
  });

  it("its last turn after yours plays at 2x: half the pauses and the tumbles", async () => {
    const { result } = await render();
    await act(async () => result.current.startTurn({ lastTurn: true }));
    expect(result.current.tumbleSpeed).toBe(2);
    await advance(tumbleTotalMs(5) / 2);
    expect(result.current.rollingIndices).toEqual([]);
    const rest = await turnLength(result);
    expect(rest + tumbleTotalMs(5) / 2).toBe(cpuTurnMaxMs(2));
  });

  it("a normal turn after a last one is at normal speed again", async () => {
    mockHold.mockReturnValue(ALL_HELD);
    const { result } = await render();
    await act(async () => result.current.startTurn({ lastTurn: true }));
    await turnLength(result);
    await act(async () => result.current.startTurn());
    expect(result.current.tumbleSpeed).toBe(1);
    expect(await turnLength(result)).toBe(cpuRollMs(5) + 600);
  });

  it("under Reduce Motion: half the pauses, still step by step", async () => {
    mockHold.mockReturnValue(KEEP_THREE);
    const { result } = await render({ reduceMotion: true });
    await act(async () => result.current.startTurn());
    // The roll still happens on screen (its sound plays as its dice start), the Die doesn't tumble.
    expect(result.current.state!.rolls_used).toBe(1);
    await advance(cpuRollMs(5) / 2);
    // The hold is shown as a step of its own.
    expect(result.current.state!.held).toEqual(KEEP_THREE);
    expect(result.current.state!.rolls_used).toBe(1);
    await advance(CPU_HOLD_MS / 2);
    expect(result.current.state!.rolls_used).toBe(2);
  });

  it("under Reduce Motion its longest turn takes half as long", async () => {
    const { result } = await render({ reduceMotion: true });
    await act(async () => result.current.startTurn());
    expect(await turnLength(result)).toBe(cpuTurnMaxMs(2));
  });

  it("its last turn under Reduce Motion is 2x and halved: a quarter", async () => {
    const { result } = await render({ reduceMotion: true });
    await act(async () => result.current.startTurn({ lastTurn: true }));
    // Measured in 5 ms steps: the first step at or after it.
    const ms = await turnLength(result);
    expect(ms).toBeGreaterThanOrEqual(cpuTurnMaxMs(4));
    expect(ms).toBeLessThan(cpuTurnMaxMs(4) + 5);
  });

  it("Reduce Motion turned on mid-turn halves the steps still to come", async () => {
    mockHold.mockReturnValue(ALL_HELD);
    const { result, rerender } = await render();
    await act(async () => result.current.startTurn());
    await advance(tumbleTotalMs(5)); // the tumble is over; the settle is waiting
    await rerender({ reduceMotion: true });
    // The settle already waiting runs at its time; the score beat after it is halved.
    const rest = await turnLength(result);
    expect(rest).toBe(CPU_SETTLE_MS + 600 / 2);
  });

  it("a turn ended (New Game) never resumes when a new turn starts before its pause is up (review round 1)", async () => {
    mockHold.mockReturnValue(ALL_HELD);
    const onScored = jest.fn();
    const { result } = await render({ onScored });
    await act(async () => result.current.startTurn());
    await advance(100); // the old turn waits out its tumble
    await act(async () => result.current.endTurn());
    await act(async () => result.current.startTurn());
    await turnLength(result);
    await advance(5000);
    // Only the new turn scored: the old loop stopped at its next step.
    expect(onScored).toHaveBeenCalledTimes(1);
    expect(mockScore).toHaveBeenCalledTimes(1);
  });

  it("tells the screen when it scores, in the same batch as the score (not restored)", async () => {
    mockHold.mockReturnValue(ALL_HELD);
    const onScored = jest.fn();
    const { result } = await render({ onScored });
    await act(async () => result.current.startTurn());
    await turnLength(result);
    expect(onScored).toHaveBeenCalledTimes(1);
    const [scored, info] = onScored.mock.calls[0]!;
    expect(info).toEqual({ restored: false });
    expect((scored as GameState).scores.chance).not.toBeNull();
    expect(result.current.state).toBe(scored);
  });
});

describe("a game reopened on the computer's last turn (#3749, owner)", () => {
  it("scores it at once: no steps, no tumble, no sounds (no events), told it was restored", async () => {
    mockHold.mockReturnValue(KEEP_THREE);
    const onScored = jest.fn();
    const { result } = await render({ resumeTurn: true, resumeInstantly: true, onScored });
    // Already done, with no time passing.
    expect(result.current.isTurn).toBe(false);
    expect(result.current.rollingIndices).toEqual([]);
    expect(result.current.state!.scores.chance).not.toBeNull();
    expect(result.current.state!.events).toBeUndefined();
    expect(onScored).toHaveBeenCalledWith(result.current.state, { restored: true });
    expect(mockHold).toHaveBeenCalledTimes(2);
  });

  it("keeps the dice it had rolled before the app was closed", async () => {
    mockHold.mockReturnValue(ALL_HELD);
    const midTurn: GameState = { ...newGame(), dice: [6, 6, 6, 6, 6], rolls_used: 2 };
    const { result } = await render({
      initialState: midTurn,
      resumeTurn: true,
      resumeInstantly: true,
    });
    expect(result.current.isTurn).toBe(false);
    expect(mockScore).toHaveBeenCalledWith(
      expect.objectContaining({ dice: [6, 6, 6, 6, 6] }),
      "medium"
    );
  });

  it("only that restored turn: the next live turn is paced as usual", async () => {
    mockHold.mockReturnValue(ALL_HELD);
    const { result } = await render({ resumeTurn: true, resumeInstantly: true });
    expect(result.current.isTurn).toBe(false);
    await act(async () => result.current.startTurn());
    expect(result.current.rollingIndices).toHaveLength(5);
    expect(await turnLength(result)).toBe(cpuRollMs(5) + 600);
  });
});

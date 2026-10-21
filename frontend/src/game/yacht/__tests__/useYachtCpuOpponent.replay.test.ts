/**
 * The computer's turn is recorded (#3282): `onTurn` gets one turn, when the
 * computer scores — never during the dice animation — with the rolls it made,
 * the hold masks it chose, the alternatives and the oracle's EVs.
 */

import { act, renderHook } from "@testing-library/react-native";
import * as engine from "../engine";
import { CATEGORIES, createSeededRng, newGame, setRng } from "../engine";
import { resetSentryThrottle } from "../../_shared/sentryThrottle";
import type { GameState } from "../types";
import { holdStrategy, scoreEvs, scoreStrategy } from "../ai";
import { useYachtCpuOpponent, type YachtCpuOpponentOptions } from "../useYachtCpuOpponent";
import type { TurnData } from "../replay";

jest.mock("../ai", () => ({
  holdStrategy: jest.fn(),
  scoreStrategy: jest.fn(),
  scoreEvs: jest.fn(),
}));
jest.mock("../oracle/oracle", () => ({
  preloadOracleTable: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the global Sentry mock from jest.setup.ts
const Sentry = require("@sentry/react-native") as { captureException: jest.Mock };

const mockHold = holdStrategy as jest.Mock;
const mockScore = scoreStrategy as jest.Mock;
const mockEvs = scoreEvs as jest.Mock;
const ALL_HELD = [true, true, true, true, true];

function render(options: Partial<YachtCpuOpponentOptions> = {}) {
  return renderHook(() =>
    useYachtCpuOpponent({ difficulty: "medium", initialState: newGame(), ...options })
  );
}

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
  resetSentryThrottle();
  setRng(createSeededRng(7));
  mockHold.mockReturnValue(ALL_HELD);
  mockScore.mockReturnValue("chance");
  mockEvs.mockReturnValue([201.26, 203.94]);
});

afterEach(() => {
  jest.useRealTimers();
  setRng(Math.random);
});

describe("useYachtCpuOpponent — replay (#3282)", () => {
  it("hands over one turn when the computer scores, not before", async () => {
    const onTurn = jest.fn();
    const { result } = await render({ onTurn });
    await act(async () => result.current.startTurn());
    // The opening roll is made and animating: nothing is handed over yet.
    expect(result.current.rollingIndices).toEqual([0, 1, 2, 3, 4]);
    expect(onTurn).not.toHaveBeenCalled();
    await playOut();
    expect(onTurn).toHaveBeenCalledTimes(1);
    const turn = onTurn.mock.calls[0]![0] as TurnData;
    expect(turn.r).toBe(1);
    expect(turn.rolls).toHaveLength(1);
    expect(turn.rolls[0]![0]).toHaveLength(5);
    expect(turn.rolls[0]![0]!.every((d) => d >= 1 && d <= 6)).toBe(true);
    expect(turn.s[0]).toBe(12); // chance
    expect(turn.ev).toEqual([201.3, 203.9]);
    expect(turn.alt).toHaveLength(24);
    expect(turn.tot).toBe(result.current.state!.total_score);
    expect(result.current.isTurn).toBe(false);
  });

  it("records each re-roll with the hold mask the computer chose", async () => {
    const onTurn = jest.fn();
    mockHold.mockReturnValue([true, false, true, false, false]);
    const { result } = await render({ onTurn });
    await act(async () => result.current.startTurn());
    await playOut();
    const turn = onTurn.mock.calls[0]![0] as TurnData;
    // Three rolls; the second and third went in with dice 0 and 2 held (0b00101).
    expect(turn.rolls).toHaveLength(3);
    expect(turn.rolls[0]).toHaveLength(1);
    expect(turn.rolls[1]![1]).toBe(0b00101);
    expect(turn.rolls[2]![1]).toBe(0b00101);
    // The held dice keep their values.
    expect(turn.rolls[1]![0]![0]).toBe(turn.rolls[0]![0]![0]);
    expect(turn.rolls[2]![0]![2]).toBe(turn.rolls[0]![0]![2]);
    // The computer taps nothing.
    expect(turn.h).toBeUndefined();
    expect(mockEvs).toHaveBeenCalledTimes(1);
  });

  it("notes the rolls lost when it resumes a turn killed after it rolled", async () => {
    const onTurn = jest.fn();
    const midTurn: GameState = { ...newGame(), dice: [6, 6, 6, 6, 6], rolls_used: 3 };
    await render({ initialState: midTurn, resumeTurn: true, onTurn });
    await playOut();
    const turn = onTurn.mock.calls[0]![0] as TurnData;
    // Its dice are the only roll it shows; the other two were lost with the process.
    expect(turn.rolls).toEqual([[[6, 6, 6, 6, 6]]]);
    expect(turn.ro).toBe(2);
  });

  it("collects nothing and asks the oracle for no EVs without a listener", async () => {
    const { result } = await render();
    await act(async () => result.current.startTurn());
    await playOut();
    expect(mockEvs).not.toHaveBeenCalled();
    expect(result.current.state!.round).toBe(2);
  });

  it("a failing listener is reported and does not score the turn twice", async () => {
    const onTurn = jest.fn(() => {
      throw new Error("recorder down");
    });
    const { result } = await render({ onTurn });
    await act(async () => result.current.startTurn());
    await playOut();
    expect(onTurn).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "recorder down" }),
      expect.objectContaining({ tags: expect.objectContaining({ op: "cpuTurn" }) })
    );
    // Scored once, and control handed back.
    expect(result.current.state!.round).toBe(2);
    expect(result.current.isTurn).toBe(false);
  });

  it("records the turn the fallback finishes, with no EVs, so the card has no hole", async () => {
    const onTurn = jest.fn();
    // The turn throws after its opening roll; the fallback scores the best category.
    mockHold.mockImplementation(() => {
      throw new Error("hold failed");
    });
    const { result } = await render({ onTurn });
    await act(async () => result.current.startTurn());
    await playOut();
    expect(result.current.state!.round).toBe(2);
    expect(onTurn).toHaveBeenCalledTimes(1);
    const turn = onTurn.mock.calls[0]![0] as TurnData;
    expect(turn.r).toBe(1);
    expect(turn.rolls).toHaveLength(1);
    expect(turn).not.toHaveProperty("ev");
    expect(mockEvs).not.toHaveBeenCalled();
    // It is the category the fallback scored, with the dice it scored on.
    const scored = CATEGORIES[turn.s[0]]!;
    expect(result.current.state!.scores[scored]).toBe(turn.s[1]);
    expect(turn.tot).toBe(result.current.state!.total_score);
  });

  it("records the roll the fallback itself makes when the turn failed before rolling", async () => {
    const onTurn = jest.fn();
    // Fail before the opening roll: an unrolled turn whose preload failed in the loop.
    const spy = jest.spyOn(engine, "roll").mockImplementationOnce(() => {
      throw new Error("roll failed");
    });
    const { result } = await render({ onTurn });
    await act(async () => result.current.startTurn());
    await playOut();
    spy.mockRestore();
    expect(result.current.state!.round).toBe(2);
    const turn = onTurn.mock.calls[0]![0] as TurnData;
    expect(turn.rolls).toHaveLength(1); // the fallback's roll
    expect(turn).not.toHaveProperty("ev");
  });

  it("reports recording failures once per window, not once per turn", async () => {
    const onTurn = jest.fn(() => {
      throw new Error("recorder down");
    });
    const { result } = await render({ onTurn });
    for (let i = 0; i < 3; i += 1) {
      await act(async () => result.current.startTurn());
      await playOut();
    }
    expect(onTurn).toHaveBeenCalledTimes(3);
    expect(result.current.state!.round).toBe(4);
    const recording = Sentry.captureException.mock.calls.filter(
      (c) => (c[1] as { tags: { op: string } }).tags.op === "cpuTurn"
    );
    expect(recording).toHaveLength(1);
  });

  it("builds nothing and asks the oracle for nothing when the recorder is off", async () => {
    const onTurn = jest.fn();
    const { result } = await render({ onTurn, recording: () => false });
    await act(async () => result.current.startTurn());
    await playOut();
    expect(onTurn).not.toHaveBeenCalled();
    expect(mockEvs).not.toHaveBeenCalled();
    expect(result.current.state!.round).toBe(2);
  });

  it("a cancelled turn records nothing", async () => {
    const onTurn = jest.fn();
    const { result } = await render({ onTurn });
    await act(async () => result.current.startTurn());
    await act(async () => result.current.endTurn());
    await playOut();
    expect(onTurn).not.toHaveBeenCalled();
  });
});

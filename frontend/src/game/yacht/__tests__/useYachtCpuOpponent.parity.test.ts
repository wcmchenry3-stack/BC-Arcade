/**
 * Recording must not change the computer's play (#3282): with the real AI and
 * the same seed, the computer makes the same choices with and without `onTurn`
 * (building a turn and asking the oracle for its EVs consume no randomness).
 */

import { act, renderHook } from "@testing-library/react-native";
import { createSeededRng, newGame, setRng } from "../engine";
import { useYachtCpuOpponent } from "../useYachtCpuOpponent";
import type { TurnData } from "../replay";

async function playTurns(turns: number, onTurn?: (t: TurnData) => void) {
  setRng(createSeededRng(99));
  const { result } = await renderHook(() =>
    useYachtCpuOpponent({ difficulty: "medium", initialState: newGame(), onTurn })
  );
  for (let t = 0; t < turns; t += 1) {
    await act(async () => result.current.startTurn());
    for (let i = 0; i < 20; i += 1) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
    }
  }
  return result.current.state!;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  setRng(Math.random);
});

describe("useYachtCpuOpponent — recording does not change its play (#3282)", () => {
  it("makes the same choices with and without a listener", async () => {
    const without = await playTurns(5);
    const turns: TurnData[] = [];
    const withListener = await playTurns(5, (t) => turns.push(t));
    expect(turns).toHaveLength(5);
    expect(withListener.scores).toEqual(without.scores);
    expect(withListener.total_score).toBe(without.total_score);
    expect(withListener.yacht_bonus_count).toBe(without.yacht_bonus_count);
  });
});

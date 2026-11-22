import { renderHook, act } from "@testing-library/react-native";
import { useYachtHint } from "../useYachtHint";
import { newGame } from "../../../game/yacht/engine";
import type { GameState } from "../../../game/yacht/types";

// The warm-up (#3748 review): the oracle table decodes in hundreds of ms, so it is scheduled after
// the first roll of a solo game, never during a render or a Hint press.
const mockPreload = jest.fn(() => Promise.resolve());
jest.mock("../../../game/yacht/oracle/oracle", () => ({
  ...jest.requireActual("../../../game/yacht/oracle/oracle"),
  preloadOracleTable: () => mockPreload(),
}));

const state = (over: Partial<GameState> = {}): GameState => ({ ...newGame(), ...over });

type Props = { available: boolean; gameState: GameState };

function setup(initial: Props) {
  return renderHook(
    ({ available, gameState }: Props) => useYachtHint({ available, gameState, disabled: false }),
    { initialProps: initial }
  );
}

beforeEach(() => mockPreload.mockClear());

describe("the Hint's oracle warm-up", () => {
  it("is not started before the first roll, nor on mount", async () => {
    await setup({ available: true, gameState: state({ rolls_used: 0 }) });
    expect(mockPreload).not.toHaveBeenCalled();
  });

  it("is started once, after the first roll (not during the render that shows it)", async () => {
    const { rerender } = await setup({ available: true, gameState: state({ rolls_used: 0 }) });
    await rerender({ available: true, gameState: state({ rolls_used: 1, dice: [1, 2, 3, 4, 5] }) });
    expect(mockPreload).toHaveBeenCalledTimes(1);
    await rerender({ available: true, gameState: state({ rolls_used: 2, dice: [1, 2, 3, 4, 5] }) });
    await rerender({ available: true, gameState: state({ rolls_used: 1, round: 2 }) });
    expect(mockPreload).toHaveBeenCalledTimes(1);
  });

  it("is started at mount for a game restored after its first roll", async () => {
    await setup({ available: true, gameState: state({ rolls_used: 2, dice: [1, 2, 3, 4, 5] }) });
    expect(mockPreload).toHaveBeenCalledTimes(1);
  });

  it("stays lazy in a game against the computer", async () => {
    const { rerender } = await setup({ available: false, gameState: state({ rolls_used: 1 }) });
    await rerender({ available: false, gameState: state({ rolls_used: 2 }) });
    expect(mockPreload).not.toHaveBeenCalled();
  });

  it("waits for the dice to land: never during the tumble (#3749)", async () => {
    type Live = Props & { disabled: boolean };
    const { rerender } = await renderHook(
      ({ available, gameState, disabled }: Live) =>
        useYachtHint({ available, gameState, disabled }),
      { initialProps: { available: true, gameState: state({ rolls_used: 0 }), disabled: false } }
    );
    const rolled = state({ rolls_used: 1, dice: [1, 2, 3, 4, 5] });
    await rerender({ available: true, gameState: rolled, disabled: true });
    expect(mockPreload).not.toHaveBeenCalled();
    await rerender({ available: true, gameState: rolled, disabled: false });
    expect(mockPreload).toHaveBeenCalledTimes(1);
  });

  it("pressing Hint does not start it", async () => {
    const { result } = await setup({ available: true, gameState: state({ rolls_used: 0 }) });
    await act(async () => result.current.onHint());
    expect(mockPreload).not.toHaveBeenCalled();
  });
});

describe("the real warm-up defers its decode off the render", () => {
  it("preloadOracleTable resolves only after a timer, not synchronously", async () => {
    jest.useFakeTimers();
    try {
      const { preloadOracleTable } = jest.requireActual<
        typeof import("../../../game/yacht/oracle/oracle")
      >("../../../game/yacht/oracle/oracle");
      let done = false;
      void preloadOracleTable().then(() => {
        done = true;
      });
      await Promise.resolve();
      expect(done).toBe(false);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1);
      });
      expect(done).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

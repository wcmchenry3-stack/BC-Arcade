/**
 * #3701: the loss card waits for the game-over sequence (C: 1000 ms), never shows a render early,
 * and takes no input from Reduce Motion, so switching it mid-way cannot hold the card or hide it.
 */
import { act, renderHook } from "@testing-library/react-native";
import { useLossCard } from "../useLossCard";
import { MOTION } from "../../../game/cascade/motion";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

type Props = { gameOver: boolean; won: boolean; gameKey: number };

async function mount(initial: Props) {
  return renderHook((p: Props) => useLossCard(p.gameOver, p.won, p.gameKey), {
    initialProps: initial,
  });
}

it("hidden during play", async () => {
  const { result } = await mount({ gameOver: false, won: false, gameKey: 0 });
  expect(result.current).toBe(false);
});

it("a loss shows the card cardAtMs after the game over, not a render before", async () => {
  const { result, rerender } = await mount({ gameOver: false, won: false, gameKey: 0 });
  await rerender({ gameOver: true, won: false, gameKey: 0 });
  expect(result.current).toBe(false);
  await act(async () => {
    jest.advanceTimersByTime(MOTION.gameOver.cardAtMs - 1);
  });
  expect(result.current).toBe(false);
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(result.current).toBe(true);
});

it("a win shows the card at once (its celebration holds the card itself)", async () => {
  const { result, rerender } = await mount({ gameOver: false, won: false, gameKey: 0 });
  await rerender({ gameOver: true, won: true, gameKey: 0 });
  expect(result.current).toBe(true);
});

it("a new game hides it, and the next loss waits again", async () => {
  const { result, rerender } = await mount({ gameOver: true, won: false, gameKey: 0 });
  await act(async () => {
    jest.advanceTimersByTime(MOTION.gameOver.cardAtMs);
  });
  expect(result.current).toBe(true);
  await rerender({ gameOver: false, won: false, gameKey: 1 });
  expect(result.current).toBe(false);
  await rerender({ gameOver: true, won: false, gameKey: 1 });
  expect(result.current).toBe(false);
  await act(async () => {
    jest.advanceTimersByTime(MOTION.gameOver.cardAtMs);
  });
  expect(result.current).toBe(true);
});

it("a restart before the card is due cancels it", async () => {
  const { result, rerender } = await mount({ gameOver: true, won: false, gameKey: 0 });
  await rerender({ gameOver: false, won: false, gameKey: 1 });
  await act(async () => {
    jest.advanceTimersByTime(5 * MOTION.gameOver.cardAtMs);
  });
  expect(result.current).toBe(false);
});

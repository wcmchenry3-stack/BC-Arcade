/**
 * useSolveBeat (#3774): the result card waits for the solved beat (1.0 s) after the solving move,
 * then shows; under Reduce Motion there is no beat; turning Reduce Motion on mid-beat releases the
 * card at once and cancels the timer; a new game clears the beat; unmounting clears the timer; a
 * game restored already solved shows the card at once.
 */
import { act, renderHook } from "@testing-library/react-native";

import { useSolveBeat } from "../useSolveBeat";
import { SOLVED_BEAT_MS } from "../../../game/sudoku/motion";

let mockReduceMotion = false;
jest.mock("../../shared/useReduceMotion", () => ({
  ...jest.requireActual("../../shared/useReduceMotion"),
  useReduceMotion: () => mockReduceMotion,
}));

beforeEach(() => {
  mockReduceMotion = false;
  jest.useFakeTimers();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** The handle of the beat's timer (the one set for `ms`), to check it is cleared. */
function beatTimer(setSpy: jest.SpyInstance, ms: number) {
  const i = setSpy.mock.calls.findIndex((c) => c[1] === ms);
  expect(i).toBeGreaterThanOrEqual(0);
  return setSpy.mock.results[i]!.value;
}

describe("useSolveBeat", () => {
  it("does not hold while the puzzle is not solved", async () => {
    const hook = await renderHook(({ solved }) => useSolveBeat(solved), {
      initialProps: { solved: false },
    });
    expect(hook.result.current.holding).toBe(false);
  });

  it("holds the card from the render that solves, for 1.0 s, then releases it", async () => {
    const hook = await renderHook(({ solved }) => useSolveBeat(solved), {
      initialProps: { solved: false },
    });
    await hook.rerender({ solved: true });
    // Held in the very render that brings the solved state: no frame with the card showing.
    expect(hook.result.current.holding).toBe(true);
    await act(() => jest.advanceTimersByTime(SOLVED_BEAT_MS - 1));
    expect(hook.result.current.holding).toBe(true);
    await act(() => jest.advanceTimersByTime(1));
    expect(hook.result.current.holding).toBe(false);
  });

  it("under Reduce Motion there is no beat: the card is never held", async () => {
    mockReduceMotion = true;
    const hook = await renderHook(({ solved }) => useSolveBeat(solved), {
      initialProps: { solved: false },
    });
    await hook.rerender({ solved: true });
    expect(hook.result.current.holding).toBe(false);
    expect(hook.result.current.reduceMotion).toBe(true);
  });

  it("turning Reduce Motion on mid-beat releases the card now, and the timer is gone", async () => {
    const setSpy = jest.spyOn(global, "setTimeout");
    const clearSpy = jest.spyOn(global, "clearTimeout");
    const hook = await renderHook(({ solved }) => useSolveBeat(solved), {
      initialProps: { solved: false },
    });
    await hook.rerender({ solved: true });
    const handle = beatTimer(setSpy, SOLVED_BEAT_MS);
    await act(() => jest.advanceTimersByTime(300));
    expect(hook.result.current.holding).toBe(true);

    mockReduceMotion = true;
    await hook.rerender({ solved: true });
    expect(hook.result.current.holding).toBe(false);
    expect(clearSpy).toHaveBeenCalledWith(handle);

    // Turning it off again does not bring the beat back under the card.
    mockReduceMotion = false;
    await hook.rerender({ solved: true });
    expect(hook.result.current.holding).toBe(false);
    await act(() => jest.advanceTimersByTime(SOLVED_BEAT_MS));
    expect(hook.result.current.holding).toBe(false);
  });

  it("a new game clears the beat and its timer, and the next solve gets its own beat", async () => {
    const setSpy = jest.spyOn(global, "setTimeout");
    const clearSpy = jest.spyOn(global, "clearTimeout");
    const hook = await renderHook(({ solved }) => useSolveBeat(solved), {
      initialProps: { solved: false },
    });
    await hook.rerender({ solved: true });
    const handle = beatTimer(setSpy, SOLVED_BEAT_MS);
    await act(() => jest.advanceTimersByTime(200));
    await hook.rerender({ solved: false });
    expect(hook.result.current.holding).toBe(false);
    expect(clearSpy).toHaveBeenCalledWith(handle);
    await act(() => jest.advanceTimersByTime(SOLVED_BEAT_MS));
    expect(hook.result.current.holding).toBe(false);

    // A solve after the beat has run once is held again.
    await hook.rerender({ solved: true });
    expect(hook.result.current.holding).toBe(true);
    await act(() => jest.advanceTimersByTime(SOLVED_BEAT_MS));
    expect(hook.result.current.holding).toBe(false);
    await hook.rerender({ solved: false });
    await hook.rerender({ solved: true });
    expect(hook.result.current.holding).toBe(true);
  });

  it("unmounting clears the timer", async () => {
    const setSpy = jest.spyOn(global, "setTimeout");
    const clearSpy = jest.spyOn(global, "clearTimeout");
    const hook = await renderHook(({ solved }) => useSolveBeat(solved), {
      initialProps: { solved: false },
    });
    await hook.rerender({ solved: true });
    const handle = beatTimer(setSpy, SOLVED_BEAT_MS);
    await hook.unmount();
    expect(clearSpy).toHaveBeenCalledWith(handle);
  });

  it("a game restored already solved shows the card at once, with no beat and no timer", async () => {
    const setSpy = jest.spyOn(global, "setTimeout");
    const hook = await renderHook(({ solved }) => useSolveBeat(solved), {
      initialProps: { solved: false },
    });
    // The restore handler's skip runs in the same batch as the solved state it loaded.
    await act(async () => {
      hook.result.current.skip();
      await hook.rerender({ solved: true });
    });
    expect(hook.result.current.holding).toBe(false);
    expect(setSpy.mock.calls.some((c) => c[1] === SOLVED_BEAT_MS)).toBe(false);
    await act(() => jest.advanceTimersByTime(SOLVED_BEAT_MS));
    expect(hook.result.current.holding).toBe(false);

    // A new game after it is held again when it is solved.
    await hook.rerender({ solved: false });
    await hook.rerender({ solved: true });
    expect(hook.result.current.holding).toBe(true);
  });
});

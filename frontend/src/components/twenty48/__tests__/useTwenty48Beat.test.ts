/**
 * useTwenty48Beat (#3689): the result card waits for the win beat (about 1 s) or the game-over beat
 * (about 0.6 s), then shows; under Reduce Motion there is no beat; turning Reduce Motion on mid-beat
 * releases the card at once and cancels the timer.
 */
import { act, renderHook } from "@testing-library/react-native";

import { useTwenty48Beat } from "../useTwenty48Beat";
import { GAME_OVER_BEAT_MS, WIN_BEAT_MS } from "../../../game/twenty48/motion";

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

describe("useTwenty48Beat", () => {
  it("holds the card for the win beat, then releases it", async () => {
    const hook = await renderHook(() => useTwenty48Beat());
    expect(hook.result.current.beat).toBeNull();
    await act(() => hook.result.current.start("win"));
    expect(hook.result.current.beat).toBe("win");
    await act(() => jest.advanceTimersByTime(WIN_BEAT_MS - 1));
    expect(hook.result.current.beat).toBe("win");
    await act(() => jest.advanceTimersByTime(1));
    expect(hook.result.current.beat).toBeNull();
  });

  it("holds the card for the game-over beat, then releases it", async () => {
    const hook = await renderHook(() => useTwenty48Beat());
    await act(() => hook.result.current.start("gameOver"));
    expect(hook.result.current.beat).toBe("gameOver");
    await act(() => jest.advanceTimersByTime(GAME_OVER_BEAT_MS - 1));
    expect(hook.result.current.beat).toBe("gameOver");
    await act(() => jest.advanceTimersByTime(1));
    expect(hook.result.current.beat).toBeNull();
  });

  it("under Reduce Motion there is no beat: the card is never held", async () => {
    mockReduceMotion = true;
    const hook = await renderHook(() => useTwenty48Beat());
    await act(() => hook.result.current.start("win"));
    expect(hook.result.current.beat).toBeNull();
    await act(() => hook.result.current.start("gameOver"));
    expect(hook.result.current.beat).toBeNull();
  });

  it("turning Reduce Motion on mid-beat releases the card now, and the timer is gone", async () => {
    const setSpy = jest.spyOn(global, "setTimeout");
    const clearSpy = jest.spyOn(global, "clearTimeout");
    const hook = await renderHook(() => useTwenty48Beat());
    await act(() => hook.result.current.start("win"));
    const handle = beatTimer(setSpy, WIN_BEAT_MS);
    await act(() => jest.advanceTimersByTime(300));
    expect(hook.result.current.beat).toBe("win");

    mockReduceMotion = true;
    await hook.rerender({});
    expect(hook.result.current.beat).toBeNull();
    expect(clearSpy).toHaveBeenCalledWith(handle);

    // Turning it off again does not bring the beat back under the card.
    mockReduceMotion = false;
    await hook.rerender({});
    expect(hook.result.current.beat).toBeNull();
    await act(() => jest.advanceTimersByTime(WIN_BEAT_MS));
    expect(hook.result.current.beat).toBeNull();
  });

  it("clear (a new game) ends a beat and its timer", async () => {
    const setSpy = jest.spyOn(global, "setTimeout");
    const clearSpy = jest.spyOn(global, "clearTimeout");
    const hook = await renderHook(() => useTwenty48Beat());
    await act(() => hook.result.current.start("gameOver"));
    const handle = beatTimer(setSpy, GAME_OVER_BEAT_MS);
    await act(() => hook.result.current.clear());
    expect(hook.result.current.beat).toBeNull();
    expect(clearSpy).toHaveBeenCalledWith(handle);
  });

  it("a second beat restarts the timer rather than ending early", async () => {
    const hook = await renderHook(() => useTwenty48Beat());
    await act(() => hook.result.current.start("gameOver"));
    await act(() => jest.advanceTimersByTime(GAME_OVER_BEAT_MS - 100));
    await act(() => hook.result.current.start("win"));
    await act(() => jest.advanceTimersByTime(200));
    expect(hook.result.current.beat).toBe("win");
  });

  it("unmounting mid-beat leaves no timer behind", async () => {
    const setSpy = jest.spyOn(global, "setTimeout");
    const clearSpy = jest.spyOn(global, "clearTimeout");
    const hook = await renderHook(() => useTwenty48Beat());
    await act(() => hook.result.current.start("win"));
    const handle = beatTimer(setSpy, WIN_BEAT_MS);
    await hook.unmount();
    expect(clearSpy).toHaveBeenCalledWith(handle);
  });
});

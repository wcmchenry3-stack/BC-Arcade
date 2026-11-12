/**
 * useYachtEndBeat (#3749): the card waits 1.0 s after a win and 0.6 s after a loss or a tie; a
 * beat after a YACHT! / JOKER! starts only when the celebration is done (audit bug 1); no beat
 * under Reduce Motion; Reduce Motion turned on mid-beat releases the card at once, and turning it
 * off again replays nothing. `onStart` is the moment #3750's end sound plays.
 */
import { act, renderHook } from "@testing-library/react-native";

import { useYachtEndBeat } from "../useYachtEndBeat";
import {
  JACKPOT_WAIT_MAX_MS,
  LOSS_BEAT_MS,
  TIE_BEAT_MS,
  WIN_BEAT_MS,
} from "../../../game/yacht/motion";

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

/** The handle of the timer set for `ms`, to check it is cleared. */
function timerFor(setSpy: jest.SpyInstance, ms: number) {
  const i = setSpy.mock.calls.findIndex((c) => c[1] === ms);
  expect(i).toBeGreaterThanOrEqual(0);
  return setSpy.mock.results[i]!.value;
}

describe("useYachtEndBeat", () => {
  it.each([
    ["win", WIN_BEAT_MS],
    ["loss", LOSS_BEAT_MS],
    ["tie", TIE_BEAT_MS],
  ] as const)("holds the card for the %s beat, then releases it", async (outcome, ms) => {
    const hook = await renderHook(() => useYachtEndBeat());
    expect(hook.result.current.holding).toBe(false);
    await act(() => hook.result.current.start(outcome));
    expect(hook.result.current.holding).toBe(true);
    expect(hook.result.current.outcome).toBe(outcome);
    await act(() => jest.advanceTimersByTime(ms - 1));
    expect(hook.result.current.holding).toBe(true);
    await act(() => jest.advanceTimersByTime(1));
    expect(hook.result.current.holding).toBe(false);
    expect(hook.result.current.outcome).toBe(outcome);
  });

  it("tells #3750 when the beat starts, once, with how long the card waits", async () => {
    const onStart = jest.fn();
    const hook = await renderHook(() => useYachtEndBeat({ onStart }));
    await act(() => hook.result.current.start("loss"));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith("loss", LOSS_BEAT_MS);
    await act(() => jest.advanceTimersByTime(5000));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("after a celebration: holds the card with no beat until the celebration is done, then the beat", async () => {
    const onStart = jest.fn();
    const hook = await renderHook(() => useYachtEndBeat({ onStart }));
    await act(() => hook.result.current.start("win", { afterCelebration: true }));
    expect(hook.result.current.holding).toBe(true);
    // The celebration runs for as long as it runs: the card never covers it.
    await act(() => jest.advanceTimersByTime(2500));
    expect(hook.result.current.holding).toBe(true);
    expect(onStart).not.toHaveBeenCalled();

    await act(() => hook.result.current.celebrationDone());
    expect(onStart).toHaveBeenCalledWith("win", WIN_BEAT_MS);
    expect(hook.result.current.holding).toBe(true);
    await act(() => jest.advanceTimersByTime(WIN_BEAT_MS - 1));
    expect(hook.result.current.holding).toBe(true);
    await act(() => jest.advanceTimersByTime(1));
    expect(hook.result.current.holding).toBe(false);
  });

  it("a celebration that never says it is done can't hold the card for good", async () => {
    const hook = await renderHook(() => useYachtEndBeat());
    await act(() => hook.result.current.start("tie", { afterCelebration: true }));
    await act(() => jest.advanceTimersByTime(JACKPOT_WAIT_MAX_MS));
    expect(hook.result.current.holding).toBe(true); // the beat, now
    await act(() => jest.advanceTimersByTime(TIE_BEAT_MS));
    expect(hook.result.current.holding).toBe(false);
  });

  it("a celebration done with no game ending starts nothing", async () => {
    const onStart = jest.fn();
    const hook = await renderHook(() => useYachtEndBeat({ onStart }));
    await act(() => hook.result.current.celebrationDone());
    expect(onStart).not.toHaveBeenCalled();
    expect(hook.result.current.holding).toBe(false);
  });

  it("under Reduce Motion there is no beat: the card is never held (but #3750 still hears the end)", async () => {
    mockReduceMotion = true;
    const onStart = jest.fn();
    const hook = await renderHook(() => useYachtEndBeat({ onStart }));
    await act(() => hook.result.current.start("win"));
    expect(hook.result.current.holding).toBe(false);
    expect(onStart).toHaveBeenCalledWith("win", 0);
  });

  it("under Reduce Motion a celebration is still waited for, then the card shows at once", async () => {
    mockReduceMotion = true;
    const hook = await renderHook(() => useYachtEndBeat());
    await act(() => hook.result.current.start("win", { afterCelebration: true }));
    expect(hook.result.current.holding).toBe(true);
    await act(() => hook.result.current.celebrationDone());
    expect(hook.result.current.holding).toBe(false);
  });

  it("Reduce Motion turned on mid-beat releases the card and cancels the timer; off again replays nothing", async () => {
    const setSpy = jest.spyOn(global, "setTimeout");
    const clearSpy = jest.spyOn(global, "clearTimeout");
    const hook = await renderHook(() => useYachtEndBeat());
    await act(() => hook.result.current.start("win"));
    expect(hook.result.current.holding).toBe(true);
    const timer = timerFor(setSpy, WIN_BEAT_MS);

    mockReduceMotion = true;
    await hook.rerender({});
    expect(hook.result.current.holding).toBe(false);
    expect(clearSpy).toHaveBeenCalledWith(timer);

    mockReduceMotion = false;
    await hook.rerender({});
    expect(hook.result.current.holding).toBe(false);
    await act(() => jest.advanceTimersByTime(WIN_BEAT_MS));
    expect(hook.result.current.holding).toBe(false);
  });

  it("clear (a new game) ends a beat, a wait and the outcome", async () => {
    const hook = await renderHook(() => useYachtEndBeat());
    await act(() => hook.result.current.start("loss"));
    await act(() => hook.result.current.clear());
    expect(hook.result.current.holding).toBe(false);
    expect(hook.result.current.outcome).toBeNull();

    await act(() => hook.result.current.start("win", { afterCelebration: true }));
    await act(() => hook.result.current.clear());
    expect(hook.result.current.holding).toBe(false);
    // The celebration ending later starts no beat for the old game.
    await act(() => hook.result.current.celebrationDone());
    expect(hook.result.current.holding).toBe(false);
  });

  it("unmounting mid-beat clears its timer", async () => {
    const setSpy = jest.spyOn(global, "setTimeout");
    const clearSpy = jest.spyOn(global, "clearTimeout");
    const hook = await renderHook(() => useYachtEndBeat());
    await act(() => hook.result.current.start("win"));
    const timer = timerFor(setSpy, WIN_BEAT_MS);
    await hook.unmount();
    expect(clearSpy).toHaveBeenCalledWith(timer);
  });
});

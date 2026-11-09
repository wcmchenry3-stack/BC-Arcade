/**
 * useDailyWordCelebration (#3664): the result card waits for the win dance and sparks, or the
 * loss reveal, then shows; under Reduce Motion it shows as soon as the row has turned. A refusal
 * bumps the shake counter; a new board clears the celebration and its timer.
 */
import { act, renderHook } from "@testing-library/react-native";

import { useDailyWordCelebration } from "../useDailyWordCelebration";
import { lossRevealMs, winCelebrationMs } from "../../../game/daily_word/motion";
import { initialState } from "../../../game/daily_word/engine";
import type { DailyWordState } from "../../../game/daily_word/types";

let mockReduceMotion = false;
jest.mock("../../shared/useReduceMotion", () => ({
  ...jest.requireActual("../../shared/useReduceMotion"),
  useReduceMotion: () => mockReduceMotion,
}));

// Three guesses made, the third solved it: current_row has moved on to 3.
const solved: DailyWordState = { ...initialState("2026-11-09:en", 5, "en"), current_row: 3 };

async function setup() {
  const setRevealPending = jest.fn();
  const stateRef = { current: solved as DailyWordState | null };
  const hook = await renderHook(() => useDailyWordCelebration(stateRef, setRevealPending));
  return { hook, setRevealPending };
}

beforeEach(() => {
  mockReduceMotion = false;
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe("useDailyWordCelebration", () => {
  it("a win dances the solved row and holds the card until the celebration ends", async () => {
    const { hook, setRevealPending } = await setup();
    await act(() => hook.result.current.finishReveal(true));
    expect(hook.result.current.celebration).toEqual({ kind: "win", row: 2 });
    await act(() => jest.advanceTimersByTime(winCelebrationMs(5) - 1));
    expect(setRevealPending).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(setRevealPending).toHaveBeenCalledWith(false);
  });

  it("a loss holds the card until the answer has flipped in", async () => {
    const { hook, setRevealPending } = await setup();
    await act(() => hook.result.current.finishReveal(false));
    expect(hook.result.current.celebration).toEqual({ kind: "loss" });
    await act(() => jest.advanceTimersByTime(lossRevealMs(5) - 1));
    expect(setRevealPending).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(setRevealPending).toHaveBeenCalledWith(false);
  });

  it("a loss whose answer didn't load shows the card at once: there is nothing to reveal", async () => {
    const { hook, setRevealPending } = await setup();
    await act(() => hook.result.current.finishReveal(false, false));
    expect(setRevealPending).toHaveBeenCalledWith(false);
    expect(hook.result.current.celebration).toBeNull();
  });

  it("under Reduce Motion the card shows at once, with no celebration", async () => {
    mockReduceMotion = true;
    const { hook, setRevealPending } = await setup();
    await act(() => hook.result.current.finishReveal(true));
    expect(setRevealPending).toHaveBeenCalledWith(false);
    expect(hook.result.current.celebration).toBeNull();
  });

  it("Reduce Motion turned on mid-celebration stops it and shows the card now", async () => {
    const { hook, setRevealPending } = await setup();
    await act(() => hook.result.current.finishReveal(true));
    mockReduceMotion = true;
    await hook.rerender({});
    expect(setRevealPending).toHaveBeenCalledWith(false);
    expect(hook.result.current.celebration).toBeNull();
    setRevealPending.mockClear();
    await act(() => jest.advanceTimersByTime(5000));
    expect(setRevealPending).not.toHaveBeenCalled();
    // Turning it off again doesn't bring the dance back.
    mockReduceMotion = false;
    await hook.rerender({});
    expect(hook.result.current.celebration).toBeNull();
  });

  it("Reduce Motion turned on during the flip: the card shows at once when it ends", async () => {
    const { hook, setRevealPending } = await setup();
    const finish = hook.result.current.finishReveal; // held by the flip timer
    mockReduceMotion = true;
    await hook.rerender({});
    await act(() => finish(true));
    expect(setRevealPending).toHaveBeenCalledWith(false);
    expect(hook.result.current.celebration).toBeNull();
  });

  it("a new board clears the celebration and its pending timer", async () => {
    const { hook, setRevealPending } = await setup();
    await act(() => hook.result.current.finishReveal(true));
    await act(() => hook.result.current.clearCelebration());
    expect(hook.result.current.celebration).toBeNull();
    await act(() => jest.advanceTimersByTime(5000));
    expect(setRevealPending).not.toHaveBeenCalled();
  });

  it("each refusal bumps the shake counter", async () => {
    const { hook } = await setup();
    const k = hook.result.current.shakeKey;
    await act(() => hook.result.current.onRefused());
    await act(() => hook.result.current.onRefused());
    expect(hook.result.current.shakeKey).toBe(k + 2);
  });

  it("an unmount mid-celebration leaves no timer behind", async () => {
    const { hook, setRevealPending } = await setup();
    await act(() => hook.result.current.finishReveal(false));
    await hook.unmount();
    await act(() => jest.advanceTimersByTime(5000));
    expect(setRevealPending).not.toHaveBeenCalled();
  });
});

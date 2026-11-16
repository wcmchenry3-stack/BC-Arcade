import { renderHook } from "@testing-library/react-native";

import { useCascadeClock } from "../useCascadeClock";

describe("useCascadeClock (#2750, #3700)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const wait = (ms: number) => jest.advanceTimersByTime(ms);

  it("is stable across renders", () => {
    const { result, rerender } = renderHook(() => useCascadeClock());
    const first = result.current;
    rerender({});
    expect(result.current).toBe(first);
  });

  it("doesn't run until the first piece, and a later piece doesn't restart it", () => {
    const clock = renderHook(() => useCascadeClock()).result.current;
    wait(60_000);
    expect(clock.elapsed()).toBe(0);
    clock.start();
    wait(5_000);
    clock.start();
    wait(2_000);
    expect(clock.elapsed()).toBe(7_000);
  });

  it("leaves out time away, and stops for good at the end", () => {
    const clock = renderHook(() => useCascadeClock()).result.current;
    clock.start();
    wait(10_000);
    clock.pause();
    wait(600_000);
    clock.start(); // a piece while away doesn't start it
    wait(1_000);
    clock.resume();
    wait(4_000);
    clock.stop();
    wait(30_000);
    clock.pause();
    clock.resume();
    expect(clock.elapsed()).toBe(14_000);
  });

  it("reset: a new game waits for its own first piece", () => {
    const clock = renderHook(() => useCascadeClock()).result.current;
    clock.start();
    wait(10_000);
    clock.reset();
    wait(10_000);
    expect(clock.elapsed()).toBe(0);
  });

  it("restore: runs on from the load with the saved play, paused if the player is away", () => {
    const clock = renderHook(() => useCascadeClock()).result.current;
    clock.restore(20_000);
    wait(5_000);
    expect(clock.elapsed()).toBe(25_000);

    const away = renderHook(() => useCascadeClock()).result.current;
    away.pause(); // the screen opened while the app is in the background
    away.restore(20_000);
    wait(60_000);
    expect(away.elapsed()).toBe(20_000);
    away.resume();
    wait(1_000);
    expect(away.elapsed()).toBe(21_000);
  });
});

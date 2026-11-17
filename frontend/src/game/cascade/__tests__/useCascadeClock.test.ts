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

  it("is stable across renders", async () => {
    const { result, rerender } = await renderHook(() => useCascadeClock());
    const first = result.current;
    await rerender({});
    expect(result.current).toBe(first);
  });

  it("doesn't run until the first piece, and a later piece doesn't restart it", async () => {
    const clock = (await renderHook(() => useCascadeClock())).result.current;
    wait(60_000);
    expect(clock.elapsed()).toBe(0);
    clock.start();
    wait(5_000);
    clock.start();
    wait(2_000);
    expect(clock.elapsed()).toBe(7_000);
  });

  it("leaves out time away, and stops for good at the end", async () => {
    const clock = (await renderHook(() => useCascadeClock())).result.current;
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

  // Review on #3926: a dev spawn after the end has no game-over guard.
  it("a piece after the end doesn't start it again, until a new or restored game", async () => {
    const clock = (await renderHook(() => useCascadeClock())).result.current;
    clock.start();
    wait(30_000);
    clock.stop();
    clock.start();
    wait(10_000);
    expect(clock.elapsed()).toBe(30_000);

    clock.reset();
    clock.start();
    wait(2_000);
    expect(clock.elapsed()).toBe(2_000);

    clock.stop();
    clock.restore(5_000);
    wait(1_000);
    clock.start(); // a restored game runs; a piece doesn't restart it
    wait(1_000);
    expect(clock.elapsed()).toBe(7_000);
  });

  it("reset: a new game waits for its own first piece", async () => {
    const clock = (await renderHook(() => useCascadeClock())).result.current;
    clock.start();
    wait(10_000);
    clock.reset();
    wait(10_000);
    expect(clock.elapsed()).toBe(0);
  });

  it("restore: runs on from the load with the saved play, paused if the player is away", async () => {
    const clock = (await renderHook(() => useCascadeClock())).result.current;
    clock.restore(20_000);
    wait(5_000);
    expect(clock.elapsed()).toBe(25_000);

    const away = (await renderHook(() => useCascadeClock())).result.current;
    away.pause(); // the screen opened while the app is in the background
    away.restore(20_000);
    wait(60_000);
    expect(away.elapsed()).toBe(20_000);
    away.resume();
    wait(1_000);
    expect(away.elapsed()).toBe(21_000);
  });

  it("a wall-clock jump back or forward mid-game doesn't change the elapsed time (#3925)", async () => {
    const clock = (await renderHook(() => useCascadeClock())).result.current;
    clock.start();
    wait(60_000);
    const wallNow = Date.now();
    const spy = jest.spyOn(Date, "now").mockReturnValue(wallNow - 3_600_000);
    expect(clock.elapsed()).toBe(60_000);
    spy.mockReturnValue(wallNow + 3_600_000);
    wait(30_000);
    expect(clock.elapsed()).toBe(90_000);
    spy.mockRestore();
  });

  it("reports a whole number of milliseconds for a fractional performance.now (#3925)", async () => {
    const clock = (await renderHook(() => useCascadeClock())).result.current;
    const mono = jest.spyOn(performance, "now").mockReturnValue(1000.4);
    clock.start();
    mono.mockReturnValue(4234.567);
    expect(Number.isInteger(clock.elapsed())).toBe(true);
    expect(clock.elapsed()).toBe(3234);
    mono.mockRestore();
  });
});

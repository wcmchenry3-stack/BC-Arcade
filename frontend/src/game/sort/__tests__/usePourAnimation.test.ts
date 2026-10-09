/**
 * usePourAnimation (#2981): the one pour in flight, landing when SortBoard's
 * animation ends (full motion) or on a timer (Reduce Motion), never twice,
 * never after a cancel or unmount.
 */
import { act, renderHook } from "@testing-library/react-native";
import { usePourAnimation } from "../usePourAnimation";

const SETTLE_MS = 500;

async function setup(reduceMotion: boolean) {
  const onLand = jest.fn();
  const hook = await renderHook(
    ({ rm }: { rm: boolean }) =>
      usePourAnimation<string>({ reduceMotion: rm, reduceMotionMs: SETTLE_MS, onLand }),
    { initialProps: { rm: reduceMotion } }
  );
  return { result: hook.result, rerender: hook.rerender, unmount: hook.unmount, onLand };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("usePourAnimation — full motion", () => {
  it("shows the pour until complete() lands it on its own snapshot", async () => {
    const { result, onLand } = await setup(false);
    expect(result.current.pour).toBeNull();

    let started = false;
    await act(async () => {
      started = result.current.start("board-0", 1, 3, 240);
    });
    expect(started).toBe(true);
    expect(result.current.pour).toEqual({ from: 1, to: 3, holdMs: 240 });

    // No timer lands a full-motion pour: only SortBoard's callback does.
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(onLand).not.toHaveBeenCalled();
    expect(result.current.pour).toEqual({ from: 1, to: 3, holdMs: 240 });

    await act(async () => {
      result.current.complete();
    });
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(onLand).toHaveBeenCalledWith("board-0", 1, 3);
    expect(result.current.pour).toBeNull();
  });

  it("lands a pour once: a second complete() is a no-op", async () => {
    const { result, onLand } = await setup(false);
    await act(async () => {
      result.current.start("board-0", 0, 2, 120);
    });
    await act(async () => {
      result.current.complete();
      result.current.complete();
    });
    expect(onLand).toHaveBeenCalledTimes(1);
  });

  it("complete() with no pour running does nothing", async () => {
    const { result, onLand } = await setup(false);
    await act(async () => {
      result.current.complete();
    });
    expect(onLand).not.toHaveBeenCalled();
    expect(result.current.pour).toBeNull();
  });

  it("refuses a second tap during a pour, and keeps the first pour", async () => {
    const { result, onLand } = await setup(false);
    await act(async () => {
      result.current.start("board-0", 1, 3, 240);
    });
    let second = true;
    await act(async () => {
      second = result.current.start("board-1", 2, 0, 120);
    });
    expect(second).toBe(false);
    expect(result.current.pour).toEqual({ from: 1, to: 3, holdMs: 240 });

    await act(async () => {
      result.current.complete();
    });
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(onLand).toHaveBeenCalledWith("board-0", 1, 3);
  });

  it("refuses a second tap in the same frame, before a re-render", async () => {
    const { result } = await setup(false);
    const results: boolean[] = [];
    await act(async () => {
      results.push(result.current.start("board-0", 1, 3, 240));
      results.push(result.current.start("board-0", 2, 0, 120));
    });
    expect(results).toEqual([true, false]);
    expect(result.current.pour).toEqual({ from: 1, to: 3, holdMs: 240 });
  });

  it("accepts a new pour once the previous one has landed", async () => {
    const { result, onLand } = await setup(false);
    await act(async () => {
      result.current.start("board-0", 1, 3, 240);
    });
    await act(async () => {
      result.current.complete();
    });
    let next = false;
    await act(async () => {
      next = result.current.start("board-1", 0, 1, 120);
    });
    expect(next).toBe(true);
    expect(result.current.pour).toEqual({ from: 0, to: 1, holdMs: 120 });
    await act(async () => {
      result.current.complete();
    });
    expect(onLand).toHaveBeenLastCalledWith("board-1", 0, 1);
  });

  it("cancel() drops the pour and its move", async () => {
    const { result, onLand } = await setup(false);
    await act(async () => {
      result.current.start("board-0", 1, 3, 240);
    });
    await act(async () => {
      result.current.cancel();
    });
    expect(result.current.pour).toBeNull();
    await act(async () => {
      result.current.complete();
    });
    expect(onLand).not.toHaveBeenCalled();
    // And the next pour is accepted.
    let next = false;
    await act(async () => {
      next = result.current.start("board-1", 0, 1, 120);
    });
    expect(next).toBe(true);
  });
});

describe("usePourAnimation — Reduce Motion", () => {
  it("lands the pour after reduceMotionMs, not before", async () => {
    const { result, onLand } = await setup(true);
    await act(async () => {
      result.current.start("board-0", 1, 3, 240);
    });
    expect(result.current.pour).toEqual({ from: 1, to: 3, holdMs: 240 });

    await act(async () => {
      jest.advanceTimersByTime(SETTLE_MS - 1);
    });
    expect(onLand).not.toHaveBeenCalled();
    expect(result.current.pour).not.toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(onLand).toHaveBeenCalledWith("board-0", 1, 3);
    expect(result.current.pour).toBeNull();
  });

  it("ignores complete(): only the timer lands it", async () => {
    const { result, onLand } = await setup(true);
    await act(async () => {
      result.current.start("board-0", 1, 3, 240);
    });
    await act(async () => {
      result.current.complete();
    });
    expect(onLand).not.toHaveBeenCalled();
    expect(result.current.pour).not.toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(SETTLE_MS);
    });
    expect(onLand).toHaveBeenCalledTimes(1);
  });

  it("refuses a second tap during a pour, and lands only the first", async () => {
    const { result, onLand } = await setup(true);
    await act(async () => {
      result.current.start("board-0", 1, 3, 240);
    });
    await act(async () => {
      jest.advanceTimersByTime(SETTLE_MS / 2);
    });
    let second = true;
    await act(async () => {
      second = result.current.start("board-1", 2, 0, 120);
    });
    expect(second).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(SETTLE_MS * 2);
    });
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(onLand).toHaveBeenCalledWith("board-0", 1, 3);
  });

  it("cancel() clears the timer, so the pour never lands", async () => {
    const { result, onLand } = await setup(true);
    await act(async () => {
      result.current.start("board-0", 1, 3, 240);
    });
    await act(async () => {
      result.current.cancel();
    });
    expect(result.current.pour).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(SETTLE_MS * 2);
    });
    expect(onLand).not.toHaveBeenCalled();
  });

  it("clears the timer on unmount, so nothing lands on an unmounted screen", async () => {
    const { result, onLand, unmount } = await setup(true);
    const clearSpy = jest.spyOn(global, "clearTimeout");
    const setSpy = jest.spyOn(global, "setTimeout");
    await act(async () => {
      result.current.start("board-0", 1, 3, 240);
    });
    // The landing timer is the one scheduled for reduceMotionMs.
    const call = setSpy.mock.calls.findIndex(([, ms]) => ms === SETTLE_MS);
    expect(call).toBeGreaterThanOrEqual(0);
    const timer: unknown = setSpy.mock.results[call]!.value;
    setSpy.mockRestore();

    await unmount();
    expect(clearSpy).toHaveBeenCalledWith(timer);
    clearSpy.mockRestore();
    await act(async () => {
      jest.advanceTimersByTime(SETTLE_MS * 2);
    });
    expect(onLand).not.toHaveBeenCalled();
  });

  it("lands through the latest onLand callback", async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { result, rerender } = await renderHook(
      ({ onLand }: { onLand: (s: string, f: number, t: number) => void }) =>
        usePourAnimation<string>({ reduceMotion: true, reduceMotionMs: SETTLE_MS, onLand }),
      { initialProps: { onLand: first } }
    );
    await act(async () => {
      result.current.start("board-0", 1, 3, 240);
    });
    await rerender({ onLand: second });
    await act(async () => {
      jest.advanceTimersByTime(SETTLE_MS);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("board-0", 1, 3);
  });
});

describe("usePourAnimation — motion setting", () => {
  it("still lands a full-motion pour through complete() once Reduce Motion turns on", async () => {
    const { result, onLand, rerender } = await setup(false);
    await act(async () => {
      result.current.start("board-0", 1, 3, 240);
    });
    // Reduce Motion turned on mid-pour: SortBoard finishes the pour through
    // complete() (it drops the ghost), so the pending move still lands.
    await rerender({ rm: true });
    await act(async () => {
      result.current.complete();
    });
    expect(onLand).toHaveBeenCalledWith("board-0", 1, 3);
  });
});

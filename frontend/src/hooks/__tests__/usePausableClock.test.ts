import { useState } from "react";
import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";
import { pauseClock, resumeClock, type PlayClock } from "../../game/_shared/playClock";
import { usePausableClock } from "../usePausableClock";
import type { FocusEventSource } from "../usePauseWhileAway";

interface Game extends PlayClock {
  readonly moves: number;
  readonly over: boolean;
}

describe("usePausableClock (#2750)", () => {
  let appStateListeners: Set<(s: AppStateStatus) => void>;
  let spy: jest.SpyInstance;
  let now: number;
  let nowSpy: jest.SpyInstance;

  beforeEach(() => {
    appStateListeners = new Set();
    spy = jest.spyOn(AppState, "addEventListener").mockImplementation(((
      _type: string,
      cb: (s: AppStateStatus) => void
    ) => {
      appStateListeners.add(cb);
      return { remove: () => appStateListeners.delete(cb) };
    }) as unknown as typeof AppState.addEventListener);
    now = 1_000_000;
    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => {
    nowSpy.mockRestore();
    spy.mockRestore();
  });

  const setAppState = (s: AppStateStatus) => appStateListeners.forEach((cb) => cb(s));

  async function setup(initial: Game | null, onPaused?: (g: Game) => void) {
    const listeners = new Map<string, Set<() => void>>();
    const navigation: FocusEventSource = {
      addListener: (type, cb) => {
        const set = listeners.get(type) ?? new Set();
        set.add(cb);
        listeners.set(type, set);
        return () => set.delete(cb);
      },
    };
    const emit = (type: "focus" | "blur") => listeners.get(type)?.forEach((cb) => cb());
    const hook = await renderHook(() => {
      const [state, setState] = useState<Game | null>(initial);
      const clock = usePausableClock<Game>({
        navigation,
        state,
        setState,
        pauseGame: (g) => pauseClock(g),
        resumeGame: (g) => (g.over ? g : resumeClock(g)),
        onPaused,
      });
      return { state, setState, ...clock };
    });
    return { hook, emit };
  }

  it("pauses the latest state, not the last committed one", async () => {
    const { hook } = await setup({ startedAt: now, accumulatedMs: 0, moves: 1, over: false });
    now += 10_000;
    await act(async () => {
      // A move still waiting to commit when the app goes to the background.
      hook.result.current.setState((g) => (g ? { ...g, moves: 2 } : g));
      setAppState("background");
    });
    expect(hook.result.current.state).toEqual({
      startedAt: null,
      accumulatedMs: 10_000,
      moves: 2,
      over: false,
    });

    now += 60 * 60_000;
    await act(async () => setAppState("active"));
    expect(hook.result.current.state).toEqual(
      expect.objectContaining({ startedAt: now, accumulatedMs: 10_000, moves: 2 })
    );
  });

  it("resumes even when the pause and the return land before a render", async () => {
    const { hook } = await setup({ startedAt: now, accumulatedMs: 0, moves: 1, over: false });
    now += 5_000;
    await act(async () => {
      setAppState("inactive");
      setAppState("active");
    });
    expect(hook.result.current.state).toEqual(
      expect.objectContaining({ startedAt: now, accumulatedMs: 5_000 })
    );
  });

  it("doesn't start a clock it didn't stop", async () => {
    const { hook, emit } = await setup({
      startedAt: null,
      accumulatedMs: 0,
      moves: 0,
      over: false,
    });
    await act(async () => emit("blur"));
    await act(async () => emit("focus"));
    expect(hook.result.current.state!.startedAt).toBeNull();
  });

  it("calls onPaused once, with the committed paused state", async () => {
    const onPaused = jest.fn();
    const { hook, emit } = await setup(
      { startedAt: now, accumulatedMs: 0, moves: 3, over: false },
      onPaused
    );
    now += 7_000;
    await act(async () => setAppState("background"));
    await act(async () => emit("blur")); // still away: nothing new
    expect(onPaused).toHaveBeenCalledTimes(1);
    expect(onPaused).toHaveBeenCalledWith(hook.result.current.state);
    expect(onPaused.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ startedAt: null, accumulatedMs: 7_000, moves: 3 })
    );
  });

  it("pauses a state loaded while away, and resumes it on return", async () => {
    const { hook } = await setup(null);
    await act(async () => setAppState("background"));
    const loaded: Game = { startedAt: now, accumulatedMs: 30_000, moves: 4, over: false };
    await act(async () => {
      hook.result.current.setState(hook.result.current.adoptLoaded(loaded));
    });
    expect(hook.result.current.state).toEqual(
      expect.objectContaining({ startedAt: null, accumulatedMs: 30_000 })
    );

    now += 60 * 60_000;
    await act(async () => setAppState("active"));
    now += 5_000;
    const g = hook.result.current.state!;
    expect(g.accumulatedMs + (now - g.startedAt!)).toBe(35_000);
  });

  it("leaves a state loaded in the foreground as it is", async () => {
    const { hook } = await setup(null);
    const loaded: Game = { startedAt: now, accumulatedMs: 30_000, moves: 4, over: false };
    expect(hook.result.current.adoptLoaded(loaded)).toBe(loaded);
  });
});

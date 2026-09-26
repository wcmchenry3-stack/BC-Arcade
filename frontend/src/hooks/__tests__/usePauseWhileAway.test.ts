import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";
import { usePauseWhileAway, type FocusEventSource } from "../usePauseWhileAway";

function fakeNavigation() {
  const listeners = new Map<string, Set<() => void>>();
  const navigation: FocusEventSource = {
    addListener: jest.fn((type: string, cb: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(cb);
      listeners.set(type, set);
      return () => set.delete(cb);
    }),
  };
  const emit = (type: "focus" | "blur") => listeners.get(type)?.forEach((cb) => cb());
  const count = (type: string) => listeners.get(type)?.size ?? 0;
  return { navigation, emit, count };
}

describe("usePauseWhileAway (#2750)", () => {
  let appStateListeners: Set<(s: AppStateStatus) => void>;
  let spy: jest.SpyInstance;

  beforeEach(() => {
    appStateListeners = new Set();
    spy = jest.spyOn(AppState, "addEventListener").mockImplementation(((
      _type: string,
      cb: (s: AppStateStatus) => void
    ) => {
      appStateListeners.add(cb);
      return { remove: () => appStateListeners.delete(cb) };
    }) as unknown as typeof AppState.addEventListener);
  });
  afterEach(() => spy.mockRestore());

  const setAppState = (s: AppStateStatus) => appStateListeners.forEach((cb) => cb(s));

  async function setup() {
    const nav = fakeNavigation();
    const onPause = jest.fn();
    const onResume = jest.fn();
    const hook = await renderHook(() => usePauseWhileAway(nav.navigation, onPause, onResume));
    return { ...nav, onPause, onResume, hook };
  }

  it("pauses when the app goes to the background and resumes when it returns", async () => {
    const { onPause, onResume, hook } = await setup();
    expect(hook.result.current.current).toBe(false);

    await act(async () => setAppState("background"));
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(hook.result.current.current).toBe(true);

    await act(async () => setAppState("active"));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(hook.result.current.current).toBe(false);
  });

  it("treats iOS's inactive state as away, and pauses only once on the way to background", async () => {
    const { onPause, onResume } = await setup();
    await act(async () => setAppState("inactive"));
    await act(async () => setAppState("background"));
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();
  });

  it("pauses on blur and resumes on focus", async () => {
    const { emit, onPause, onResume } = await setup();
    await act(async () => emit("blur"));
    expect(onPause).toHaveBeenCalledTimes(1);
    await act(async () => emit("focus"));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("returning to the foreground while another screen still covers the game doesn't resume", async () => {
    const { emit, onPause, onResume } = await setup();
    await act(async () => emit("blur"));
    await act(async () => setAppState("background"));
    await act(async () => setAppState("active"));
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();

    await act(async () => emit("focus"));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("closing the covering screen while the app is in the background doesn't resume", async () => {
    const { emit, onPause, onResume } = await setup();
    await act(async () => setAppState("background"));
    await act(async () => emit("blur"));
    await act(async () => emit("focus"));
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();

    await act(async () => setAppState("active"));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("calls the latest handlers without re-subscribing", async () => {
    const nav = fakeNavigation();
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = await renderHook(
      ({ onPause }: { onPause: () => void }) =>
        usePauseWhileAway(nav.navigation, onPause, jest.fn()),
      { initialProps: { onPause: first } }
    );
    await rerender({ onPause: second });
    expect(nav.navigation.addListener).toHaveBeenCalledTimes(2); // blur + focus, once
    await act(async () => setAppState("background"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes on unmount", async () => {
    const { count, hook } = await setup();
    expect(appStateListeners.size).toBe(1);
    expect(count("blur")).toBe(1);
    await hook.unmount();
    expect(appStateListeners.size).toBe(0);
    expect(count("blur")).toBe(0);
    expect(count("focus")).toBe(0);
  });
});

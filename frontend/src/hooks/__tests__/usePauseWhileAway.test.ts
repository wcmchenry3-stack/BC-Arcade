import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";
import {
  isAwayStatus,
  usePauseWhileAway,
  type FocusEventSource,
  type LeaveEvent,
} from "../usePauseWhileAway";
import { useReportAppOverlay } from "../appOverlay";

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

  describe("at mount", () => {
    const original = Object.getOwnPropertyDescriptor(AppState, "currentState");
    const setCurrentState = (value: string | null) =>
      Object.defineProperty(AppState, "currentState", { value, configurable: true });
    afterEach(() => {
      if (original) Object.defineProperty(AppState, "currentState", original);
      else delete (AppState as { currentState?: unknown }).currentState;
    });

    it("starts paused when the app isn't active, and resumes on the switch to active", async () => {
      setCurrentState("background");
      const { onPause, onResume, hook } = await setup();
      expect(onPause).toHaveBeenCalledTimes(1);
      expect(hook.result.current.current).toBe(true);

      await act(async () => setAppState("active"));
      expect(onResume).toHaveBeenCalledTimes(1);
      expect(hook.result.current.current).toBe(false);
    });

    it("treats an unknown launch state as the foreground", async () => {
      setCurrentState("unknown");
      const { onPause } = await setup();
      expect(onPause).not.toHaveBeenCalled();
    });

    it("starts paused when the screen opens already covered", async () => {
      setCurrentState("active");
      const nav = fakeNavigation();
      const onPause = jest.fn();
      const onResume = jest.fn();
      await renderHook(() =>
        usePauseWhileAway({ ...nav.navigation, isFocused: () => false }, onPause, onResume)
      );
      expect(onPause).toHaveBeenCalledTimes(1);
      await act(async () => nav.emit("focus"));
      expect(onResume).toHaveBeenCalledTimes(1);
    });
  });

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

  describe("onLeave (#3087)", () => {
    async function setupWithLeave() {
      const nav = fakeNavigation();
      const order: string[] = [];
      const onPause = jest.fn(() => order.push("pause"));
      const onLeave = jest.fn((e: LeaveEvent) => order.push(`leave:${e.reason}`));
      const hook = await renderHook(() =>
        usePauseWhileAway(nav.navigation, onPause, jest.fn(), { onLeave })
      );
      return { ...nav, onPause, onLeave, order, hook };
    }

    it("is called on every leave event, after onPause, even while already away", async () => {
      const { emit, onPause, onLeave, order } = await setupWithLeave();
      await act(async () => setAppState("inactive"));
      await act(async () => setAppState("background"));
      await act(async () => emit("blur"));
      expect(onPause).toHaveBeenCalledTimes(1);
      expect(onLeave.mock.calls.map(([e]) => e)).toEqual([
        { reason: "appState", status: "inactive", previous: null },
        { reason: "appState", status: "background", previous: "inactive" },
        { reason: "blur" },
      ]);
      expect(order).toEqual(["pause", "leave:appState", "leave:appState", "leave:blur"]);
    });

    it("is not called on a return, nor at mount", async () => {
      const { emit, onLeave } = await setupWithLeave();
      expect(onLeave).not.toHaveBeenCalled();
      await act(async () => setAppState("active"));
      await act(async () => emit("focus"));
      expect(onLeave).not.toHaveBeenCalled();
    });

    it("calls the latest onLeave without re-subscribing", async () => {
      const nav = fakeNavigation();
      const first = jest.fn();
      const second = jest.fn();
      const { rerender } = await renderHook(
        ({ onLeave }: { onLeave: (e: LeaveEvent) => void }) =>
          usePauseWhileAway(nav.navigation, jest.fn(), jest.fn(), { onLeave }),
        { initialProps: { onLeave: first } }
      );
      await rerender({ onLeave: second });
      expect(appStateListeners.size).toBe(1);
      await act(async () => setAppState("background"));
      await act(async () => nav.emit("blur"));
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(2);
    });

    it("reports the previous change's status, a return included", async () => {
      const { onLeave } = await setupWithLeave();
      await act(async () => setAppState("background"));
      await act(async () => setAppState("active"));
      await act(async () => setAppState("background"));
      expect(onLeave.mock.calls.map(([e]) => e)).toEqual([
        { reason: "appState", status: "background", previous: null },
        { reason: "appState", status: "background", previous: "active" },
      ]);
    });
  });

  describe("app overlay (#2944)", () => {
    /** A stand-in for AppHeader's menu or feedback sheet. */
    async function overlay(initial = false) {
      return renderHook(({ open }: { open: boolean }) => useReportAppOverlay(open), {
        initialProps: { open: initial },
      });
    }

    it("pauses while the overlay is open and resumes when it closes", async () => {
      const { onPause, onResume, hook } = await setup();
      const menu = await overlay();
      await act(async () => menu.rerender({ open: true }));
      expect(onPause).toHaveBeenCalledTimes(1);
      expect(hook.result.current.current).toBe(true);

      await act(async () => menu.rerender({ open: false }));
      expect(onResume).toHaveBeenCalledTimes(1);
      expect(hook.result.current.current).toBe(false);
    });

    it("reports the overlay to onLeave, after onPause", async () => {
      const nav = fakeNavigation();
      const order: string[] = [];
      const onLeave = jest.fn((e: LeaveEvent) => order.push(`leave:${e.reason}`));
      await renderHook(() =>
        usePauseWhileAway(nav.navigation, () => order.push("pause"), jest.fn(), { onLeave })
      );
      const sheet = await overlay();
      await act(async () => sheet.rerender({ open: true }));
      expect(onLeave).toHaveBeenCalledWith({ reason: "overlay" });
      expect(order).toEqual(["pause", "leave:overlay"]);

      // Closing it is a return, not a leave.
      await act(async () => sheet.rerender({ open: false }));
      expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it("starts paused when an overlay is already open at mount", async () => {
      const sheet = await overlay(true);
      const { onPause, onResume, hook } = await setup();
      expect(onPause).toHaveBeenCalledTimes(1);
      expect(hook.result.current.current).toBe(true);
      await act(async () => sheet.unmount());
      expect(onResume).toHaveBeenCalledTimes(1);
    });

    it("closing the overlay while the app is in the background doesn't resume", async () => {
      const { onResume, hook } = await setup();
      const sheet = await overlay();
      await act(async () => sheet.rerender({ open: true }));
      await act(async () => setAppState("background"));
      await act(async () => sheet.rerender({ open: false }));
      expect(onResume).not.toHaveBeenCalled();
      expect(hook.result.current.current).toBe(true);
      await act(async () => setAppState("active"));
      expect(onResume).toHaveBeenCalledTimes(1);
    });

    it("stops listening on unmount", async () => {
      const { onPause, hook } = await setup();
      await hook.unmount();
      const sheet = await overlay();
      await act(async () => sheet.rerender({ open: true }));
      expect(onPause).not.toHaveBeenCalled();
      await act(async () => sheet.unmount());
    });
  });

  it("isAwayStatus: background and inactive only", () => {
    expect(isAwayStatus("background")).toBe(true);
    expect(isAwayStatus("inactive")).toBe(true);
    expect(isAwayStatus("active")).toBe(false);
    expect(isAwayStatus("unknown")).toBe(false);
    expect(isAwayStatus(null)).toBe(false);
    expect(isAwayStatus(undefined)).toBe(false);
  });
});

import { AppState } from "react-native";
import { __resetForegroundClockForTests, foregroundNow } from "../foregroundClock";

// foregroundClock (#2684): one app-wide foreground-time counter.

let listeners: ((state: string) => void)[] = [];
const originalCurrentState = AppState.currentState;

function setCurrentState(state: unknown) {
  (AppState as unknown as { currentState: unknown }).currentState = state;
}

function fire(state: string) {
  listeners.forEach((h) => h(state));
}

beforeEach(() => {
  jest.useFakeTimers({ now: 1_700_000_000_000 });
  listeners = [];
  (AppState.addEventListener as jest.Mock).mockReset();
  (AppState.addEventListener as jest.Mock).mockImplementation(
    (_event: string, handler: (state: string) => void) => {
      listeners.push(handler);
      return {
        remove: jest.fn(() => {
          listeners = listeners.filter((h) => h !== handler);
        }),
      };
    }
  );
  setCurrentState("active");
  __resetForegroundClockForTests();
});

afterEach(() => {
  __resetForegroundClockForTests();
  setCurrentState(originalCurrentState);
  jest.useRealTimers();
});

describe("foregroundNow", () => {
  it("advances with time while the app is active", () => {
    const t0 = foregroundNow();
    jest.advanceTimersByTime(5_000);
    expect(foregroundNow() - t0).toBe(5_000);
  });

  it.each(["background", "inactive"])("stops while the app is %s", (state) => {
    const t0 = foregroundNow();
    jest.advanceTimersByTime(1_000);
    fire(state);
    jest.advanceTimersByTime(60_000);
    expect(foregroundNow() - t0).toBe(1_000);
    fire("active");
    jest.advanceTimersByTime(2_000);
    expect(foregroundNow() - t0).toBe(3_000);
  });

  it("inactive then background then active pauses once and resumes once", () => {
    const t0 = foregroundNow();
    fire("inactive");
    jest.advanceTimersByTime(5_000);
    fire("background");
    jest.advanceTimersByTime(5_000);
    fire("active");
    jest.advanceTimersByTime(1_000);
    fire("active"); // a repeat does not restart the segment
    jest.advanceTimersByTime(1_000);
    expect(foregroundNow() - t0).toBe(2_000);
  });

  it("reads AppState at subscribe time: started in the background, it waits for active", () => {
    setCurrentState("background");
    const t0 = foregroundNow();
    jest.advanceTimersByTime(30_000);
    expect(foregroundNow() - t0).toBe(0);
    fire("active");
    jest.advanceTimersByTime(4_000);
    expect(foregroundNow() - t0).toBe(4_000);
  });

  it("subscribes to AppState once, lazily, on the first reading", () => {
    expect(AppState.addEventListener).not.toHaveBeenCalled();
    foregroundNow();
    foregroundNow();
    expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
    expect(listeners).toHaveLength(1);
  });

  it("is monotonic", () => {
    let last = foregroundNow();
    for (const state of ["background", "active", "inactive", "active"]) {
      jest.advanceTimersByTime(1_000);
      fire(state);
      const now = foregroundNow();
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it("keeps counting (never pausing) when the subscription fails", () => {
    (AppState.addEventListener as jest.Mock).mockImplementation(() => {
      throw new Error("boom");
    });
    const t0 = foregroundNow();
    jest.advanceTimersByTime(2_000);
    expect(foregroundNow() - t0).toBe(2_000);
  });
});

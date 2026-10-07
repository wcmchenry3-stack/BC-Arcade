import { AppState, type AppStateStatus } from "react-native";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useDailyChallenge } from "../useDailyChallenge";
import type { DailyChallenge } from "../api";

// #2924: a challenge held across local midnight must not stay "ready" while offline.

const mockGetDailyChallenge = jest.fn();
jest.mock("../api", () => ({
  dailyChallengeApi: { getDailyChallenge: (tz: number) => mockGetDailyChallenge(tz) },
}));

const mockNetwork = { isOnline: true, isInitialized: true };
jest.mock("../../_shared/NetworkContext", () => ({ useNetwork: () => mockNetwork }));

jest.mock("../../_shared/flushQueuedGames", () => ({
  flushQueuedGames: () => Promise.resolve(),
}));

jest.mock("../../_shared/withRetry", () => ({
  withRetry: <T,>(fn: () => Promise<T>) => fn(),
}));

const focusListeners = new Set<() => void>();
const mockNavigation = {
  addListener: (event: string, cb: () => void) => {
    if (event === "focus") focusListeners.add(cb);
    return () => focusListeners.delete(cb);
  },
};
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNavigation,
}));

let appStateListener: ((state: AppStateStatus) => void) | undefined;

function challengeFor(day: string): DailyChallenge {
  return {
    challengeId: day,
    goals: [{ id: "g1", gameSlug: "solitaire", kind: "won", target: null, completed: false }],
  };
}

const DAY1_LATE = Date.UTC(2026, 8, 27, 23, 50, 0);
const DAY2_EARLY = Date.UTC(2026, 8, 28, 0, 10, 0);

beforeEach(() => {
  jest.clearAllMocks();
  focusListeners.clear();
  appStateListener = undefined;
  mockNetwork.isOnline = true;
  // Pin the device to UTC so the local day is the UTC day.
  jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0);
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void;
    return { remove: jest.fn() };
  });
  mockGetDailyChallenge.mockImplementation(() =>
    Promise.resolve(challengeFor(new Date(Date.now()).toISOString().slice(0, 10)))
  );
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("useDailyChallenge across local midnight (#2924)", () => {
  it("drops yesterday's challenge to the offline state on foreground when it cannot refetch", async () => {
    jest.spyOn(Date, "now").mockReturnValue(DAY1_LATE);
    const { result, rerender } = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.challenge?.challengeId).toBe("2026-09-27");

    // Connectivity drops, then the clock passes local midnight with the app still open.
    mockNetwork.isOnline = false;
    await rerender({});
    expect(result.current.phase).toBe("ready"); // still the same day

    jest.spyOn(Date, "now").mockReturnValue(DAY2_EARLY);
    await act(async () => {
      appStateListener?.("active");
    });

    expect(result.current.challenge).toBeNull();
    expect(result.current.phase).toBe("offline");
    expect(mockGetDailyChallenge).toHaveBeenCalledTimes(1); // no doomed request while offline

    // Reconnecting fetches the new day's challenge.
    mockNetwork.isOnline = true;
    await rerender({});
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.challenge?.challengeId).toBe("2026-09-28");
  });

  it("drops it on screen focus as well", async () => {
    jest.spyOn(Date, "now").mockReturnValue(DAY1_LATE);
    const { result, rerender } = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    mockNetwork.isOnline = false;
    await rerender({});
    jest.spyOn(Date, "now").mockReturnValue(DAY2_EARLY);
    await act(async () => {
      focusListeners.forEach((cb) => cb());
    });

    expect(result.current.phase).toBe("offline");
    expect(result.current.challenge).toBeNull();
  });

  it("drops it when the midnight timer fires with no foreground or focus event", async () => {
    jest.useFakeTimers({ now: Date.UTC(2026, 8, 27, 23, 59, 30) });
    const { result, rerender } = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    mockNetwork.isOnline = false;
    await rerender({});
    expect(result.current.phase).toBe("ready");

    await act(async () => {
      jest.advanceTimersByTime(40_000);
    });

    expect(result.current.phase).toBe("offline");
    expect(result.current.challenge).toBeNull();
  });

  it("keeps the challenge within the same local day while offline", async () => {
    jest.spyOn(Date, "now").mockReturnValue(DAY1_LATE);
    const { result, rerender } = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    mockNetwork.isOnline = false;
    await rerender({});
    jest.spyOn(Date, "now").mockReturnValue(DAY1_LATE + 5 * 60_000);
    await act(async () => {
      appStateListener?.("active");
    });

    expect(result.current.phase).toBe("ready");
    expect(result.current.challenge?.challengeId).toBe("2026-09-27");
  });

  it("refetches on foreground after midnight when online", async () => {
    jest.spyOn(Date, "now").mockReturnValue(DAY1_LATE);
    const { result } = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(result.current.challenge?.challengeId).toBe("2026-09-27"));

    jest.spyOn(Date, "now").mockReturnValue(DAY2_EARLY);
    await act(async () => {
      appStateListener?.("active");
    });
    await waitFor(() => expect(result.current.challenge?.challengeId).toBe("2026-09-28"));
    expect(result.current.phase).toBe("ready");
  });

  it("refetches rather than keeping a response that spanned midnight", async () => {
    jest.spyOn(Date, "now").mockReturnValue(DAY1_LATE);
    mockGetDailyChallenge.mockImplementationOnce(() => {
      // Midnight passes while the first request is in flight.
      jest.spyOn(Date, "now").mockReturnValue(DAY2_EARLY);
      return Promise.resolve(challengeFor("2026-09-27"));
    });
    const { result } = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(result.current.challenge?.challengeId).toBe("2026-09-28"));
    expect(mockGetDailyChallenge).toHaveBeenCalledTimes(2);
  });
});

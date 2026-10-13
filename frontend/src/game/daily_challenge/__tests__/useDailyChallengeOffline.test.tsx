import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useDailyChallenge } from "../useDailyChallenge";
import type { DailyChallenge } from "../api";
import { STATUS_KEY, UPCOMING_KEY } from "../offlineCache";
import { LAST_CONNECTED_KEY } from "../../_shared/lastConnected";
import { pendingGamesStore } from "../../_shared/pendingGamesStore";

// #3228: goals cached while online, shown offline with progress from the queue.

const mockGetDailyChallenge = jest.fn();
const mockGetUpcoming = jest.fn();
jest.mock("../api", () => ({
  ...jest.requireActual("../api"),
  dailyChallengeApi: {
    getDailyChallenge: (tz: number) => mockGetDailyChallenge(tz),
    getUpcoming: (tz: number) => mockGetUpcoming(tz),
  },
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

/** A day's free slate: Daily Word plus a 2048 score goal. */
function freeDay(day: string, done: string[] = []): DailyChallenge {
  return {
    challengeId: day,
    goals: [
      {
        id: `${day}:dw`,
        gameSlug: "daily_word",
        kind: "completed",
        target: null,
        completed: done.includes("dw"),
      },
      {
        id: `${day}:t48`,
        gameSlug: "twenty48",
        kind: "final_score_at_least",
        target: 500,
        completed: done.includes("t48"),
      },
    ],
  };
}

/** A premium /status slate for `day`, with different goals from the free one. */
function premiumDay(day: string): DailyChallenge {
  return {
    challengeId: day,
    goals: [
      {
        id: `${day}:mahjong`,
        gameSlug: "mahjong",
        kind: "won_duration_ms_at_most",
        target: 8,
        completed: false,
      },
    ],
  };
}

const D1 = "2026-09-27";
const D2 = "2026-09-28";
const D3 = "2026-09-29";
const D1_NOON = Date.UTC(2026, 8, 27, 12, 0, 0);
const D2_NOON = Date.UTC(2026, 8, 28, 12, 0, 0);
const D4_NOON = Date.UTC(2026, 8, 30, 12, 0, 0);

let now = D1_NOON;
let offsetMinutes = 0;

function setNow(ms: number) {
  now = ms;
}

let gameSeq = 0;
/** Queue a finished game the way useGameSync does, completed at `completedAt`. */
async function finishGame(
  gameType: string,
  summary: Parameters<typeof pendingGamesStore.complete>[1],
  completedAt: number
) {
  const id = `g-${++gameSeq}`;
  await pendingGamesStore.create(id, gameType, {});
  await pendingGamesStore.complete(id, summary, completedAt);
}

/** Render online on D1 so /status and /upcoming are cached, then unmount. */
async function cacheWhileOnline(status: DailyChallenge = freeDay(D1)) {
  mockGetDailyChallenge.mockResolvedValue(status);
  const { result, unmount } = await renderHook(() => useDailyChallenge());
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  await waitFor(async () => expect(await AsyncStorage.getItem(UPCOMING_KEY)).not.toBeNull());
  await AsyncStorage.setItem(LAST_CONNECTED_KEY, String(D1_NOON));
  await unmount();
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await pendingGamesStore.clearAll();
  focusListeners.clear();
  appStateListener = undefined;
  mockNetwork.isOnline = true;
  now = D1_NOON;
  offsetMinutes = 0;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  jest.spyOn(Date.prototype, "getTimezoneOffset").mockImplementation(() => -offsetMinutes);
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void;
    return { remove: jest.fn() };
  });
  mockGetUpcoming.mockResolvedValue([freeDay(D1), freeDay(D2), freeDay(D3)]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("useDailyChallenge offline (#3228)", () => {
  it("caches /status and /upcoming while online, without changing what is shown", async () => {
    mockGetDailyChallenge.mockResolvedValue(freeDay(D1, ["dw"]));
    const { result } = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.challenge).toEqual(freeDay(D1, ["dw"]));
    expect(result.current.windowExhausted).toBe(false);
    await waitFor(async () => expect(await AsyncStorage.getItem(UPCOMING_KEY)).not.toBeNull());
    expect(mockGetUpcoming).toHaveBeenCalledWith(0);
    expect(JSON.parse((await AsyncStorage.getItem(STATUS_KEY)) ?? "null")).toEqual({
      day: D1,
      challenge: freeDay(D1, ["dw"]),
    });
  });

  it("reads /upcoming at most once per local day", async () => {
    mockGetDailyChallenge.mockResolvedValue(freeDay(D1));
    const { result } = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(mockGetUpcoming).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect(await AsyncStorage.getItem(UPCOMING_KEY)).not.toBeNull());
    await act(async () => {
      focusListeners.forEach((cb) => cb());
    });
    await waitFor(() => expect(mockGetDailyChallenge).toHaveBeenCalledTimes(2));
    expect(result.current.phase).toBe("ready");
    expect(mockGetUpcoming).toHaveBeenCalledTimes(1);
  });

  it("shows the next day's cached goals when the device is offline that day", async () => {
    await cacheWhileOnline();
    mockNetwork.isOnline = false;
    setNow(D2_NOON);

    const { result } = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.challenge).toEqual(freeDay(D2));
    expect(mockGetDailyChallenge).toHaveBeenCalledTimes(1); // only the online render
  });

  it("counts games queued on the device that day, the way /status would", async () => {
    await cacheWhileOnline();
    mockNetwork.isOnline = false;
    setNow(D2_NOON);
    // An abandoned run never counts; a finished Daily Word does.
    await finishGame("twenty48", { finalScore: 900, outcome: "abandoned" }, D2_NOON - 60_000);
    await finishGame(
      "daily_word",
      { outcome: "win", result: { is_complete: true, won: true, guesses_used: 3 } },
      D2_NOON - 30_000
    );

    const { result } = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.challenge).toEqual(freeDay(D2, ["dw"]));

    // Back from a game: the focus re-reads the queue.
    await finishGame("twenty48", { finalScore: 640, outcome: "completed" }, D2_NOON + 60_000);
    setNow(D2_NOON + 120_000);
    await act(async () => {
      focusListeners.forEach((cb) => cb());
    });
    await waitFor(() => expect(result.current.challenge).toEqual(freeDay(D2, ["dw", "t48"])));
  });

  it("does not count a game finished on the previous local day (no catch-up)", async () => {
    await cacheWhileOnline();
    mockNetwork.isOnline = false;
    setNow(D2_NOON);
    await finishGame("daily_word", { result: { is_complete: true } }, D1_NOON + 3_600_000);

    const { result } = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.challenge).toEqual(freeDay(D2));
  });

  it("uses today's cached premium /status goals, then the free goals on day 2", async () => {
    await cacheWhileOnline(premiumDay(D1));
    mockNetwork.isOnline = false;

    // Still D1, a fresh launch offline: the premium slate, with a queued 7-minute win.
    await finishGame(
      "mahjong",
      { outcome: "win", durationMs: 420_000, result: { won: true } },
      now
    );
    const first = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(first.result.current.phase).toBe("ready"));
    expect(first.result.current.challenge?.goals).toEqual([
      { ...premiumDay(D1).goals[0], completed: true },
    ]);
    await first.unmount();

    setNow(D2_NOON);
    const second = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(second.result.current.phase).toBe("ready"));
    expect(second.result.current.challenge).toEqual(freeDay(D2));
  });

  it("shows the window-exhausted state on day 4 offline", async () => {
    await cacheWhileOnline();
    mockNetwork.isOnline = false;
    setNow(D4_NOON);

    const { result } = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(result.current.windowExhausted).toBe(true));
    expect(result.current.phase).toBe("offline");
    expect(result.current.challenge).toBeNull();
  });

  it("keeps the plain offline state when nothing was ever cached", async () => {
    mockNetwork.isOnline = false;
    const { result } = await renderHook(() => useDailyChallenge());
    // Let the offline read settle.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.phase).toBe("offline");
    expect(result.current.windowExhausted).toBe(false);
  });

  it("moves to the next cached day at local midnight while offline", async () => {
    await cacheWhileOnline();
    mockNetwork.isOnline = false;
    setNow(Date.UTC(2026, 8, 27, 23, 59, 0));
    const { result } = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(result.current.challenge?.challengeId).toBe(D1));

    setNow(Date.UTC(2026, 8, 28, 0, 1, 0));
    await act(async () => {
      appStateListener?.("active");
    });
    await waitFor(() => expect(result.current.challenge).toEqual(freeDay(D2)));
  });

  it("picks the cached day by the device's local date, not UTC", async () => {
    await cacheWhileOnline();
    mockNetwork.isOnline = false;
    // 22:00 UTC on D1 is 07:00 on D2 in UTC+9: Tokyo sees D2's goals.
    offsetMinutes = 9 * 60;
    setNow(Date.UTC(2026, 8, 27, 22, 0, 0));
    // A game at 06:30 local (D2) counts; one at 23:30 local on D1 does not.
    await finishGame("twenty48", { finalScore: 700 }, Date.UTC(2026, 8, 27, 21, 30, 0));
    await finishGame(
      "daily_word",
      { result: { is_complete: true } },
      Date.UTC(2026, 8, 27, 14, 30, 0)
    );

    const { result } = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.challenge).toEqual(freeDay(D2, ["t48"]));
  });

  it("replaces local progress with the server's /status once back online", async () => {
    await cacheWhileOnline();
    mockNetwork.isOnline = false;
    setNow(D2_NOON);
    await finishGame("twenty48", { finalScore: 900 }, D2_NOON - 60_000);

    const { result, rerender } = await renderHook(() => useDailyChallenge());
    await waitFor(() => expect(result.current.challenge).toEqual(freeDay(D2, ["t48"])));

    // The server re-checks the synced game and does not count it; it counts Daily Word.
    let answer: (c: DailyChallenge) => void = () => undefined;
    mockGetDailyChallenge.mockImplementation(
      () => new Promise<DailyChallenge>((resolve) => (answer = resolve))
    );
    mockNetwork.isOnline = true;
    await rerender({});
    // Until /status answers, the local progress stays up rather than blanking.
    expect(result.current.challenge).toEqual(freeDay(D2, ["t48"]));

    await act(async () => {
      answer(freeDay(D2, ["dw"]));
    });
    await waitFor(() => expect(result.current.challenge).toEqual(freeDay(D2, ["dw"])));
    expect(result.current.phase).toBe("ready");
  });
});

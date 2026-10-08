/**
 * useGameRank (#2503, #2677, #2990): the result card's rank lookup. Nothing
 * is queued; until the lookup settles the hook asks again while mounted — on
 * reconnect, and while online on a backoff timer.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { act, renderHook } from "@testing-library/react-native";
import { RANK_REFETCH_DELAYS_MS, topTenRank, useGameRank } from "../useGameRank";
import { retryUntilGameSynced, type RankLookup } from "../lookupGameRank";
import {
  resetDisplayNameCacheForTests,
  storeAssignedDisplayName,
  loadDisplayName,
} from "../displayName";
import { ApiError } from "../httpClient";

// Joining stores the server's generated name at once (the sync itself is
// covered by displayNameSync.test.ts); `mockJoin` can be made to fail.
const mockJoin = jest.fn();
jest.mock("../displayNameSync", () => ({
  joinLeaderboards: () => mockJoin(),
  getLeaderboardSyncPending: () => Promise.resolve(null),
}));

jest.mock("../flushQueuedGames", () => ({
  flushQueuedGames: jest.fn(() => Promise.resolve()),
}));

// The lookup itself is covered by lookupGameRank.test.ts; here each test
// scripts what it finds.
const mockLookup = jest.fn();
jest.mock("../lookupGameRank", () => ({
  ...jest.requireActual("../lookupGameRank"),
  lookupGameRank: (...args: unknown[]) => mockLookup(...args),
}));

const mockNetwork = { isOnline: true, isInitialized: true };
jest.mock("../NetworkContext", () => ({
  useNetwork: () => mockNetwork,
}));

const GAME_ID = "g-1";

const ranked = (rank: number | null): RankLookup => ({ kind: "ranked", rank });
const PENDING: RankLookup = { kind: "pending" };
const OFFLINE_ERROR = () => new TypeError("Failed to fetch");

/** `lookup` scripts what the hook's rank lookup finds. */
async function setup(lookup = jest.fn().mockResolvedValue(ranked(3))) {
  mockLookup.mockReset();
  mockLookup.mockImplementation(lookup);
  const hook = await renderHook(() => useGameRank("sudoku"));
  return { ...hook, lookup };
}

/** Advance fake time and let the promises it releases settle. */
async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

async function setOnline(isOnline: boolean, rerender: (props: object) => Promise<void> | void) {
  mockNetwork.isOnline = isOnline;
  await act(async () => {
    await rerender({});
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
  mockJoin.mockReset();
  mockJoin.mockImplementation(async () => {
    await storeAssignedDisplayName("Brave Otter 4821");
    return true;
  });
  mockNetwork.isOnline = true;
  mockNetwork.isInitialized = true;
});

describe("topTenRank", () => {
  it("keeps ranks 1–10 and drops the 'not placed' sentinel", () => {
    expect(topTenRank(1)).toBe(1);
    expect(topTenRank(10)).toBe(10);
    expect(topTenRank(11)).toBeNull();
    expect(topTenRank(null)).toBeNull();
    expect(topTenRank(0)).toBeNull();
  });
});

describe("retryUntilGameSynced", () => {
  const fast = { attempts: 3, baseDelayMs: 1 };

  it("retries while the game isn't synced yet (404/400), then resolves", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new ApiError("Game not found.", 404))
      .mockRejectedValueOnce(new ApiError("Game has no final score.", 400))
      .mockResolvedValueOnce("ok");
    await expect(retryUntilGameSynced(fn, fast)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up after the last attempt", async () => {
    const fn = jest.fn().mockRejectedValue(new ApiError("Game not found.", 404));
    await expect(retryUntilGameSynced(fn, fast)).rejects.toThrow("Game not found.");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry other errors", async () => {
    const fn = jest.fn().mockRejectedValue(new ApiError("Forbidden.", 403));
    await expect(retryUntilGameSynced(fn, fast)).rejects.toThrow("Forbidden.");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a result `notSynced` flags, then returns the next one (#2677)", async () => {
    const fn = jest.fn().mockResolvedValueOnce("pending").mockResolvedValueOnce("done");
    await expect(
      retryUntilGameSynced(fn, { ...fast, notSynced: (r) => r === "pending" })
    ).resolves.toBe("done");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("returns the last flagged result once the attempts run out", async () => {
    const fn = jest.fn().mockResolvedValue("pending");
    await expect(
      retryUntilGameSynced(fn, { ...fast, notSynced: (r) => r === "pending" })
    ).resolves.toBe("pending");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("useGameRank", () => {
  it("looks the rank up under the display name", async () => {
    await storeAssignedDisplayName("Riley");
    const { result, lookup } = await setup();

    await act(() => result.current.lookup("g-1"));

    expect(lookup).toHaveBeenCalledWith("g-1");
    expect(result.current).toMatchObject({ status: "saved", rank: 3, playerName: "Riley" });
  });

  it("asks the player to join first, then looks the waiting game up under the generated name", async () => {
    const { result, lookup } = await setup();

    await act(() => result.current.lookup("g-1"));
    expect(result.current.status).toBe("needsName");
    expect(lookup).not.toHaveBeenCalled();

    let accepted = false;
    await act(async () => {
      accepted = await result.current.joinLeaderboards();
    });

    expect(accepted).toBe(true);
    expect(mockJoin).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("g-1");
    expect(result.current).toMatchObject({ status: "saved", playerName: "Brave Otter 4821" });
    await expect(loadDisplayName()).resolves.toBe("Brave Otter 4821");
  });

  it("keeps waiting when the join can't be stored", async () => {
    mockJoin.mockResolvedValue(false);
    const { result, lookup } = await setup();
    await act(() => result.current.lookup("g-1"));

    let accepted = true;
    await act(async () => {
      accepted = await result.current.joinLeaderboards();
    });

    expect(accepted).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
    expect(result.current.status).toBe("needsName");
  });

  it("looks up only once per game until reset", async () => {
    await storeAssignedDisplayName("Riley");
    const { result, lookup } = await setup();

    await act(() => result.current.lookup("g-1"));
    await act(() => result.current.lookup("g-2"));
    expect(lookup).toHaveBeenCalledTimes(1);

    await act(async () => result.current.reset());
    expect(result.current.status).toBe("idle");
    await act(() => result.current.lookup("g-3"));
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenLastCalledWith("g-3");
  });

  it("ignores a previous game's lookup that finishes after reset()", async () => {
    await storeAssignedDisplayName("Riley");
    let finishOld: (lookup: RankLookup) => void = () => {};
    const lookup = jest.fn(() => new Promise<RankLookup>((resolve) => (finishOld = resolve)));
    const { result } = await setup(lookup);

    // Start the old game's lookup and leave it in flight.
    let inFlight: Promise<void> = Promise.resolve();
    await act(async () => {
      inFlight = result.current.lookup("g-1");
    });
    expect(result.current.status).toBe("submitting");

    await act(async () => result.current.reset());
    await act(async () => {
      finishOld(ranked(3));
      await inFlight;
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.rank).toBeNull();
  });
});

describe("useGameRank: offline, pending, backoff and errors (#2677)", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.mocked(Sentry.captureException).mockClear();
    await storeAssignedDisplayName("Riley");
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("reports the rank without queuing anything", async () => {
    const lookup = jest.fn().mockResolvedValue(ranked(2));
    const { result } = await setup(lookup);
    await act(() => result.current.lookup(GAME_ID));
    expect(lookup).toHaveBeenCalledWith(GAME_ID);
    expect(result.current).toMatchObject({ status: "saved", rank: 2, playerName: "Riley" });
  });

  it("a ranked lookup without a rank is saved with no rank", async () => {
    const { result } = await setup(jest.fn().mockResolvedValue(ranked(null)));
    await act(() => result.current.lookup(GAME_ID));
    expect(result.current).toMatchObject({ status: "saved", rank: null });
  });

  it("unranked: status unranked, and it never asks again", async () => {
    const lookup = jest.fn().mockResolvedValue({ kind: "unranked" });
    const { result } = await setup(lookup);
    await act(() => result.current.lookup(GAME_ID));
    expect(result.current).toMatchObject({ status: "unranked", rank: null });
    await advance(10 * 60_000);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("needsName asks the player to join; joinLeaderboards fetches again", async () => {
    const lookup = jest
      .fn()
      .mockResolvedValueOnce({ kind: "needsName" })
      .mockResolvedValue(ranked(1));
    const { result } = await setup(lookup);

    await act(() => result.current.lookup(GAME_ID));
    expect(result.current.status).toBe("needsName");
    await advance(10 * 60_000);
    expect(lookup).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.joinLeaderboards();
    });
    expect(lookup).toHaveBeenLastCalledWith(GAME_ID);
    expect(result.current).toMatchObject({
      status: "saved",
      rank: 1,
      playerName: "Brave Otter 4821",
    });
  });

  it("offline: no queue item; fetches on reconnect, and only once", async () => {
    mockNetwork.isOnline = false;
    const lookup = jest.fn().mockResolvedValue(ranked(1));
    const { result, rerender } = await setup(lookup);

    await act(() => result.current.lookup(GAME_ID));
    expect(result.current.status).toBe("offline");
    // No timer while offline.
    await advance(10 * 60_000);
    expect(lookup).not.toHaveBeenCalled();

    await setOnline(true, rerender);
    expect(result.current).toMatchObject({ status: "saved", rank: 1 });
    expect(lookup).toHaveBeenCalledTimes(1);

    await setOnline(false, rerender);
    await setOnline(true, rerender);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("a network failure while NetInfo says online is retried on the timer", async () => {
    const lookup = jest.fn().mockRejectedValueOnce(OFFLINE_ERROR()).mockResolvedValue(ranked(3));
    const { result } = await setup(lookup);

    await act(() => result.current.lookup(GAME_ID));
    expect(result.current.status).toBe("offline");

    await advance(RANK_REFETCH_DELAYS_MS[0]! - 1);
    expect(lookup).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ status: "saved", rank: 3 });
  });

  it("pending: keeps asking on a bounded backoff (5 s, 15 s, 60 s, then every 60 s)", async () => {
    const lookup = jest.fn().mockResolvedValue(PENDING);
    const { result } = await setup(lookup);

    await act(() => result.current.lookup(GAME_ID));
    expect(result.current.status).toBe("submitting");
    expect(RANK_REFETCH_DELAYS_MS).toEqual([5_000, 15_000, 60_000]);

    const expected = [5_000, 15_000, 60_000, 60_000, 60_000];
    for (const [i, delay] of expected.entries()) {
      await advance(delay - 1);
      expect(lookup).toHaveBeenCalledTimes(i + 1);
      await advance(1);
      expect(lookup).toHaveBeenCalledTimes(i + 2);
    }

    lookup.mockResolvedValue(ranked(4));
    await advance(60_000);
    expect(result.current).toMatchObject({ status: "saved", rank: 4 });
    const settledCalls = lookup.mock.calls.length;
    await advance(10 * 60_000);
    expect(lookup).toHaveBeenCalledTimes(settledCalls);
  });

  it("a reconnect during a fetch that then fails is not lost", async () => {
    let failFirst: (e: Error) => void = () => {};
    const lookup = jest
      .fn()
      .mockImplementationOnce(() => new Promise<RankLookup>((_, reject) => (failFirst = reject)))
      .mockResolvedValue(ranked(5));
    const { result, rerender } = await setup(lookup);

    let inFlight: Promise<void> = Promise.resolve();
    await act(async () => {
      inFlight = result.current.lookup(GAME_ID);
    });
    // The connection drops and comes back while the first fetch is in flight.
    await setOnline(false, rerender);
    await setOnline(true, rerender);
    expect(lookup).toHaveBeenCalledTimes(1);

    await act(async () => {
      failFirst(OFFLINE_ERROR());
      await inFlight;
    });
    expect(result.current.status).toBe("offline");

    await advance(RANK_REFETCH_DELAYS_MS[0]!);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ status: "saved", rank: 5 });
  });

  it("an HTTP error is an error (not reported to Sentry), with no timer; retry() asks again", async () => {
    const lookup = jest
      .fn()
      .mockRejectedValueOnce(new ApiError("not_entitled", 403))
      .mockResolvedValue(ranked(4));
    const { result } = await setup(lookup);

    await act(() => result.current.lookup(GAME_ID));
    expect(result.current.status).toBe("error");
    expect(Sentry.captureException).not.toHaveBeenCalled();
    await advance(10 * 60_000);
    expect(lookup).toHaveBeenCalledTimes(1);

    await act(() => result.current.retry());
    expect(result.current).toMatchObject({ status: "saved", rank: 4 });
  });

  it("an unexpected error is reported", async () => {
    const { result } = await setup(jest.fn().mockRejectedValue(new Error("bug")));
    await act(() => result.current.lookup(GAME_ID));
    expect(result.current.status).toBe("error");
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { subsystem: "leaderboardSubmit", gameType: "sudoku" },
    });
  });

  it("reset() cancels the timer and the reconnect fetch", async () => {
    const lookup = jest.fn().mockResolvedValue(PENDING);
    const { result, rerender } = await setup(lookup);

    await act(() => result.current.lookup(GAME_ID));
    await act(async () => result.current.reset());
    await advance(10 * 60_000);
    await setOnline(false, rerender);
    await setOnline(true, rerender);

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("idle");
  });

  it("unmounting cancels the timer", async () => {
    const lookup = jest.fn().mockResolvedValue(PENDING);
    const { result, unmount } = await setup(lookup);

    await act(() => result.current.lookup(GAME_ID));
    await act(async () => unmount());
    await advance(10 * 60_000);

    expect(lookup).toHaveBeenCalledTimes(1);
  });
});

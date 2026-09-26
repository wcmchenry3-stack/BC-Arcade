import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook } from "@testing-library/react-native";
import {
  retryUntilGameSynced,
  topTenRank,
  useLeaderboardSubmit,
  type RankLookup,
  type RankOnlyLeaderboardAdapter,
} from "../useLeaderboardSubmit";
import { resetDisplayNameCacheForTests, saveDisplayName, loadDisplayName } from "../displayName";
import { ApiError } from "../httpClient";

jest.mock("../flushQueuedGames", () => ({
  flushQueuedGames: jest.fn(() => Promise.resolve()),
}));

const mockNetwork = { isOnline: true, isInitialized: true };
jest.mock("../NetworkContext", () => ({
  useNetwork: () => mockNetwork,
}));

type Payload = { gameId: string };

const ranked = (rank: number): RankLookup => ({ kind: "ranked", rank });

function makeAdapter(submit: jest.Mock): RankOnlyLeaderboardAdapter<Payload> {
  return { gameType: "mahjong", submit };
}

async function setup(submit = jest.fn().mockResolvedValue(ranked(3))) {
  const adapter = makeAdapter(submit);
  const hook = await renderHook(() => useLeaderboardSubmit(adapter));
  return { ...hook, submit };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
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

// The rank lookup itself (offline, pending, backoff, errors) is covered in
// useLeaderboardSubmit.rankOnly.test.ts and sessionBoardAdapter.test.ts.
describe("useLeaderboardSubmit", () => {
  it("looks the rank up under the display name", async () => {
    await saveDisplayName("Riley");
    const { result, submit } = await setup();

    await act(() => result.current.submit({ gameId: "g-1" }));

    expect(submit).toHaveBeenCalledWith("Riley", { gameId: "g-1" });
    expect(result.current).toMatchObject({ status: "saved", rank: 3, playerName: "Riley" });
  });

  it("asks for a name first, then looks the waiting game up", async () => {
    const { result, submit } = await setup();

    await act(() => result.current.submit({ gameId: "g-1" }));
    expect(result.current.status).toBe("needsName");
    expect(submit).not.toHaveBeenCalled();

    let accepted = false;
    await act(async () => {
      accepted = await result.current.provideName(" Riley ");
    });

    expect(accepted).toBe(true);
    expect(submit).toHaveBeenCalledWith("Riley", { gameId: "g-1" });
    expect(result.current.status).toBe("saved");
    await expect(loadDisplayName()).resolves.toBe("Riley");
  });

  it("rejects an invalid name and keeps waiting", async () => {
    const { result, submit } = await setup();
    await act(() => result.current.submit({ gameId: "g-1" }));

    let accepted = true;
    await act(async () => {
      accepted = await result.current.provideName("   ");
    });

    expect(accepted).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.status).toBe("needsName");
  });

  it("looks up only once per game until reset", async () => {
    await saveDisplayName("Riley");
    const { result, submit } = await setup();

    await act(() => result.current.submit({ gameId: "g-1" }));
    await act(() => result.current.submit({ gameId: "g-2" }));
    expect(submit).toHaveBeenCalledTimes(1);

    await act(async () => result.current.reset());
    expect(result.current.status).toBe("idle");
    await act(() => result.current.submit({ gameId: "g-3" }));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenLastCalledWith("Riley", { gameId: "g-3" });
  });

  it("ignores a previous game's lookup that finishes after reset()", async () => {
    await saveDisplayName("Riley");
    let finishOld: (lookup: RankLookup) => void = () => {};
    const submit = jest.fn(() => new Promise<RankLookup>((resolve) => (finishOld = resolve)));
    const { result } = await setup(submit);

    // Start the old game's lookup and leave it in flight.
    let inFlight: Promise<void> = Promise.resolve();
    await act(async () => {
      inFlight = result.current.submit({ gameId: "g-1" });
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

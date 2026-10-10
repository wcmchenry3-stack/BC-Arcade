import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { lookupGameRank } from "../lookupGameRank";
import { useGameRank } from "../useGameRank";
import {
  loadDisplayName,
  resetDisplayNameCacheForTests,
  storeAssignedDisplayName,
} from "../displayName";
import { ApiError } from "../httpClient";
import type { GameRankResponse } from "../../../api/types";

const mockGetRank = jest.fn<Promise<GameRankResponse>, [string]>();
jest.mock("../../../api/stats", () => ({
  statsApi: { getGameRank: (gameId: string) => mockGetRank(gameId) },
}));

const mockFlushQueuedGames = jest.fn(() => Promise.resolve());
jest.mock("../flushQueuedGames", () => ({
  flushQueuedGames: () => mockFlushQueuedGames(),
}));

const mockFlushDisplayNameSync = jest.fn(() => Promise.resolve(true));
// Joining (#2778) stores the server's generated name once the sync confirms it.
const mockJoin = jest.fn(async () => {
  await storeAssignedDisplayName("Brave Otter 4821");
  return true;
});
jest.mock("../displayNameSync", () => ({
  flushDisplayNameSync: () => mockFlushDisplayNameSync(),
  joinLeaderboards: () => mockJoin(),
  getLeaderboardSyncPending: () => Promise.resolve(null),
}));

const mockNetwork = { isOnline: true, isInitialized: true };
jest.mock("../NetworkContext", () => ({
  useNetwork: () => mockNetwork,
}));

const FAST = { retry: { attempts: 3, baseDelayMs: 1 } };

function ranked(rank: number, is_best = true): GameRankResponse {
  return { rank, is_best, ranked: true, reason: null };
}

function unranked(reason: GameRankResponse["reason"]): GameRankResponse {
  return { rank: null, is_best: null, ranked: false, reason };
}

async function setup() {
  return renderHook(() => useGameRank("sudoku"));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
  mockNetwork.isOnline = true;
  mockNetwork.isInitialized = true;
  mockGetRank.mockReset();
  mockFlushQueuedGames.mockClear();
  mockFlushDisplayNameSync.mockReset();
  mockFlushDisplayNameSync.mockResolvedValue(true);
});

describe("lookupGameRank (#2677, #2990)", () => {
  it("sends the game and the name first, then reads the rank: nothing is queued", async () => {
    mockGetRank.mockResolvedValue(ranked(3));
    await expect(lookupGameRank("g-1")).resolves.toEqual({ kind: "ranked", rank: 3, isBest: true });
    expect(mockFlushQueuedGames).toHaveBeenCalledTimes(1);
    expect(mockFlushDisplayNameSync).toHaveBeenCalledTimes(1);
    expect(mockGetRank).toHaveBeenCalledWith("g-1");
  });

  it("keeps the best entry's rank and says this game isn't it", async () => {
    mockGetRank.mockResolvedValue(ranked(3, false));
    await expect(lookupGameRank("g-1")).resolves.toEqual({
      kind: "ranked",
      rank: 3,
      isBest: false,
    });
  });

  it("a not_finished that outlasts the retries is pending (the hook asks again)", async () => {
    mockGetRank.mockResolvedValue(unranked("not_finished"));
    await expect(lookupGameRank("g-1", FAST)).resolves.toEqual({ kind: "pending" });
    expect(mockGetRank).toHaveBeenCalledTimes(3);
  });

  it.each(["not_rankable", "board_disabled"] as const)(
    "%s is final at once: unranked, no retry",
    async (reason) => {
      mockGetRank.mockResolvedValue(unranked(reason));
      await expect(lookupGameRank("g-1", FAST)).resolves.toEqual({ kind: "unranked" });
      expect(mockGetRank).toHaveBeenCalledTimes(1);
    }
  );

  it("no_name is needsName once the name is synced, pending while the join is waiting", async () => {
    mockGetRank.mockResolvedValue(unranked("no_name"));
    await expect(lookupGameRank("g-1")).resolves.toEqual({ kind: "needsName" });
    mockFlushDisplayNameSync.mockResolvedValue(false);
    await expect(lookupGameRank("g-1")).resolves.toEqual({ kind: "pending" });
  });

  it("a 404 that outlasts the retries throws", async () => {
    mockGetRank.mockRejectedValue(new ApiError("Game not found.", 404));
    await expect(lookupGameRank("g-1", FAST)).rejects.toThrow("Game not found.");
    expect(mockGetRank).toHaveBeenCalledTimes(3);
  });
});

describe("lookupGameRank in useGameRank (#2677)", () => {
  it("named and online: fetches the rank and reports it as saved", async () => {
    await storeAssignedDisplayName("Riley");
    mockGetRank.mockResolvedValue(ranked(3));
    const { result } = await setup();

    await act(() => result.current.lookup("g-1"));

    expect(mockGetRank).toHaveBeenCalledWith("g-1");
    // The game and the name are sent before the rank is read.
    expect(mockFlushQueuedGames).toHaveBeenCalled();
    expect(mockFlushDisplayNameSync).toHaveBeenCalled();
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBe(3);
    expect(result.current.playerName).toBe("Riley");
  });

  it("keeps the best entry's rank when this game isn't that entry (#2633)", async () => {
    await storeAssignedDisplayName("Riley");
    mockGetRank.mockResolvedValue(ranked(3, false));
    const { result } = await setup();
    await act(() => result.current.lookup("g-1"));
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBe(3);
    expect(result.current.isBest).toBe(false);
  });

  it("marks the game as the best entry when the server says so, and reset clears it", async () => {
    await storeAssignedDisplayName("Riley");
    mockGetRank.mockResolvedValueOnce(ranked(3, false)).mockResolvedValueOnce(ranked(2));
    const { result } = await setup();
    await act(() => result.current.lookup("g-1"));
    expect(result.current.isBest).toBe(false);
    await act(async () => result.current.reset());
    expect(result.current.isBest).toBe(true);
    await act(() => result.current.lookup("g-2"));
    expect(result.current.rank).toBe(2);
    expect(result.current.isBest).toBe(true);
  });

  it("shows a rank outside the top ten as saved with no rank, like the other cards", async () => {
    await storeAssignedDisplayName("Riley");
    mockGetRank.mockResolvedValue(ranked(25));
    const { result } = await setup();
    await act(() => result.current.lookup("g-1"));
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBeNull();
  });

  it("not on the boards: asks to join, then joining fetches the rank", async () => {
    mockGetRank.mockResolvedValue(ranked(2));
    const { result } = await setup();

    await act(() => result.current.lookup("g-1"));
    expect(result.current.status).toBe("needsName");
    expect(mockGetRank).not.toHaveBeenCalled();

    let accepted = false;
    await act(async () => {
      accepted = await result.current.joinLeaderboards();
    });

    expect(accepted).toBe(true);
    expect(mockJoin).toHaveBeenCalledTimes(1);
    await expect(loadDisplayName()).resolves.toBe("Brave Otter 4821");
    expect(mockFlushDisplayNameSync).toHaveBeenCalled();
    expect(mockGetRank).toHaveBeenCalledWith("g-1");
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBe(2);
  });

  it("asks to join when the server has no name for the player", async () => {
    await storeAssignedDisplayName("Riley");
    mockGetRank.mockResolvedValueOnce(unranked("no_name")).mockResolvedValueOnce(ranked(1));
    const { result } = await setup();

    await act(() => result.current.lookup("g-1"));
    expect(result.current.status).toBe("needsName");

    await act(async () => {
      await result.current.joinLeaderboards();
    });
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBe(1);
  });

  it("keeps saving, not a join prompt, while the join is still waiting to sync", async () => {
    await storeAssignedDisplayName("Riley");
    mockFlushDisplayNameSync.mockResolvedValue(false);
    mockGetRank.mockResolvedValue(unranked("no_name"));
    const { result } = await setup();

    await act(() => result.current.lookup("g-1"));
    expect(result.current.status).toBe("submitting");
  });

  it("offline: shows offline with nothing queued, then fetches the rank on reconnect", async () => {
    await storeAssignedDisplayName("Riley");
    mockNetwork.isOnline = false;
    mockGetRank.mockResolvedValue(ranked(4));
    const { result, rerender } = await setup();

    await act(() => result.current.lookup("g-1"));
    expect(result.current.status).toBe("offline");
    expect(mockGetRank).not.toHaveBeenCalled();

    mockNetwork.isOnline = true;
    await act(async () => rerender({}));

    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(mockGetRank).toHaveBeenCalledWith("g-1");
    expect(result.current.rank).toBe(4);
  });

  it("offline and not on the boards: joining, then the rank comes on reconnect", async () => {
    mockNetwork.isOnline = false;
    mockGetRank.mockResolvedValue(ranked(1));
    const { result, rerender } = await setup();

    await act(() => result.current.lookup("g-1"));
    expect(result.current.status).toBe("needsName");
    await act(async () => {
      await result.current.joinLeaderboards();
    });
    expect(result.current.status).toBe("offline");

    mockNetwork.isOnline = true;
    await act(async () => rerender({}));
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(result.current.rank).toBe(1);
  });

  it("retries a 404 from before the game has synced", async () => {
    await storeAssignedDisplayName("Riley");
    mockGetRank
      .mockRejectedValueOnce(new ApiError("Game not found.", 404))
      .mockResolvedValueOnce(ranked(5));
    const { result } = await setup();

    await act(() => result.current.lookup("g-1"));

    expect(mockGetRank).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBe(5);
  });

  it("retries not_finished while the completion hasn't landed yet", async () => {
    await storeAssignedDisplayName("Riley");
    mockGetRank.mockResolvedValueOnce(unranked("not_finished")).mockResolvedValueOnce(ranked(6));
    const { result } = await setup();

    await act(() => result.current.lookup("g-1"));

    expect(mockGetRank).toHaveBeenCalledTimes(2);
    expect(result.current.rank).toBe(6);
  });

  it.each(["not_rankable", "board_disabled"] as const)(
    "%s is final at once: unranked, no retry",
    async (reason) => {
      await storeAssignedDisplayName("Riley");
      mockGetRank.mockResolvedValue(unranked(reason));
      const { result } = await setup();

      await act(() => result.current.lookup("g-1"));

      expect(mockGetRank).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe("unranked");
      expect(result.current.rank).toBeNull();
    }
  );

  it("an HTTP error is an error, and retry() asks again", async () => {
    await storeAssignedDisplayName("Riley");
    mockGetRank.mockRejectedValue(new ApiError("Forbidden.", 403));
    const { result } = await setup();

    await act(() => result.current.lookup("g-1"));
    expect(mockGetRank).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("error");

    mockGetRank.mockResolvedValue(ranked(7));
    await act(() => result.current.retry());
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBe(7);
  });
});

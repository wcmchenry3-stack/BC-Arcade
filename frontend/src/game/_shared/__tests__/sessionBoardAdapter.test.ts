import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { sessionBoardAdapter } from "../sessionBoardAdapter";
import { useLeaderboardSubmit } from "../useLeaderboardSubmit";
import { loadDisplayName, resetDisplayNameCacheForTests, saveDisplayName } from "../displayName";
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
jest.mock("../displayNameSync", () => ({
  flushDisplayNameSync: () => mockFlushDisplayNameSync(),
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
  const adapter = sessionBoardAdapter("sudoku", FAST);
  return renderHook(() => useLeaderboardSubmit(adapter));
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

describe("sessionBoardAdapter in useLeaderboardSubmit (#2677)", () => {
  it("is a rank-only adapter: nothing to queue", () => {
    const adapter = sessionBoardAdapter("cascade");
    expect(Object.keys(adapter).sort()).toEqual(["gameType", "submit"]);
    expect(adapter.gameType).toBe("cascade");
  });

  it("named and online: fetches the rank and reports it as saved", async () => {
    await saveDisplayName("Riley");
    mockGetRank.mockResolvedValue(ranked(3));
    const { result } = await setup();

    await act(() => result.current.submit({ gameId: "g-1" }));

    expect(mockGetRank).toHaveBeenCalledWith("g-1");
    // The game and the name are sent before the rank is read.
    expect(mockFlushQueuedGames).toHaveBeenCalled();
    expect(mockFlushDisplayNameSync).toHaveBeenCalled();
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBe(3);
    expect(result.current.playerName).toBe("Riley");
  });

  it("keeps the best entry's rank when this game isn't that entry (#2633)", async () => {
    await saveDisplayName("Riley");
    mockGetRank.mockResolvedValue(ranked(3, false));
    const { result } = await setup();
    await act(() => result.current.submit({ gameId: "g-1" }));
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBe(3);
    expect(result.current.isBest).toBe(false);
  });

  it("marks the game as the best entry when the server says so, and reset clears it", async () => {
    await saveDisplayName("Riley");
    mockGetRank.mockResolvedValueOnce(ranked(3, false)).mockResolvedValueOnce(ranked(2));
    const { result } = await setup();
    await act(() => result.current.submit({ gameId: "g-1" }));
    expect(result.current.isBest).toBe(false);
    await act(async () => result.current.reset());
    expect(result.current.isBest).toBe(true);
    await act(() => result.current.submit({ gameId: "g-2" }));
    expect(result.current.rank).toBe(2);
    expect(result.current.isBest).toBe(true);
  });

  it("shows a rank outside the top ten as saved with no rank, like the other cards", async () => {
    await saveDisplayName("Riley");
    mockGetRank.mockResolvedValue(ranked(25));
    const { result } = await setup();
    await act(() => result.current.submit({ gameId: "g-1" }));
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBeNull();
  });

  it("no display name: asks for one, then provideName saves it and fetches the rank", async () => {
    mockGetRank.mockResolvedValue(ranked(2));
    const { result } = await setup();

    await act(() => result.current.submit({ gameId: "g-1" }));
    expect(result.current.status).toBe("needsName");
    expect(mockGetRank).not.toHaveBeenCalled();

    let accepted = false;
    await act(async () => {
      accepted = await result.current.provideName(" Riley ");
    });

    expect(accepted).toBe(true);
    await expect(loadDisplayName()).resolves.toBe("Riley");
    expect(mockFlushDisplayNameSync).toHaveBeenCalled();
    expect(mockGetRank).toHaveBeenCalledWith("g-1");
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBe(2);
  });

  it("asks for a name when the server has none for the player", async () => {
    await saveDisplayName("Riley");
    mockGetRank.mockResolvedValueOnce(unranked("no_name")).mockResolvedValueOnce(ranked(1));
    const { result } = await setup();

    await act(() => result.current.submit({ gameId: "g-1" }));
    expect(result.current.status).toBe("needsName");

    await act(async () => {
      await result.current.provideName("Riley");
    });
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBe(1);
  });

  it("keeps saving, not a name prompt, while the name is still waiting to sync", async () => {
    await saveDisplayName("Riley");
    mockFlushDisplayNameSync.mockResolvedValue(false);
    mockGetRank.mockResolvedValue(unranked("no_name"));
    const { result } = await setup();

    await act(() => result.current.submit({ gameId: "g-1" }));
    expect(result.current.status).toBe("submitting");
  });

  it("offline: shows offline with nothing queued, then fetches the rank on reconnect", async () => {
    await saveDisplayName("Riley");
    mockNetwork.isOnline = false;
    mockGetRank.mockResolvedValue(ranked(4));
    const { result, rerender } = await setup();

    await act(() => result.current.submit({ gameId: "g-1" }));
    expect(result.current.status).toBe("offline");
    expect(mockGetRank).not.toHaveBeenCalled();

    mockNetwork.isOnline = true;
    await act(async () => rerender({}));

    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(mockGetRank).toHaveBeenCalledWith("g-1");
    expect(result.current.rank).toBe(4);
  });

  it("offline with no name: provideName saves it, then the rank comes on reconnect", async () => {
    mockNetwork.isOnline = false;
    mockGetRank.mockResolvedValue(ranked(1));
    const { result, rerender } = await setup();

    await act(() => result.current.submit({ gameId: "g-1" }));
    expect(result.current.status).toBe("needsName");
    await act(async () => {
      await result.current.provideName("Riley");
    });
    expect(result.current.status).toBe("offline");

    mockNetwork.isOnline = true;
    await act(async () => rerender({}));
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(result.current.rank).toBe(1);
  });

  it("retries a 404 from before the game has synced", async () => {
    await saveDisplayName("Riley");
    mockGetRank
      .mockRejectedValueOnce(new ApiError("Game not found.", 404))
      .mockResolvedValueOnce(ranked(5));
    const { result } = await setup();

    await act(() => result.current.submit({ gameId: "g-1" }));

    expect(mockGetRank).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBe(5);
  });

  it("retries not_finished while the completion hasn't landed yet", async () => {
    await saveDisplayName("Riley");
    mockGetRank.mockResolvedValueOnce(unranked("not_finished")).mockResolvedValueOnce(ranked(6));
    const { result } = await setup();

    await act(() => result.current.submit({ gameId: "g-1" }));

    expect(mockGetRank).toHaveBeenCalledTimes(2);
    expect(result.current.rank).toBe(6);
  });

  it("a not_finished that outlasts the retries stays pending (the hook asks again)", async () => {
    await saveDisplayName("Riley");
    mockGetRank.mockResolvedValue(unranked("not_finished"));
    const { result } = await setup();

    await act(() => result.current.submit({ gameId: "g-1" }));

    expect(mockGetRank).toHaveBeenCalledTimes(3);
    expect(result.current.status).toBe("submitting");
  });

  it.each(["not_rankable", "board_disabled"] as const)(
    "%s is final at once: unranked, no retry",
    async (reason) => {
      await saveDisplayName("Riley");
      mockGetRank.mockResolvedValue(unranked(reason));
      const { result } = await setup();

      await act(() => result.current.submit({ gameId: "g-1" }));

      expect(mockGetRank).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe("unranked");
      expect(result.current.rank).toBeNull();
    }
  );

  it("a 404 that outlasts the retries is an error, and retry() asks again", async () => {
    await saveDisplayName("Riley");
    mockGetRank.mockRejectedValue(new ApiError("Game not found.", 404));
    const { result } = await setup();

    await act(() => result.current.submit({ gameId: "g-1" }));
    expect(mockGetRank).toHaveBeenCalledTimes(3);
    expect(result.current.status).toBe("error");

    mockGetRank.mockResolvedValue(ranked(7));
    await act(() => result.current.retry());
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBe(7);
  });
});

import * as Sentry from "@sentry/react-native";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { GameLeaderboardEntry, GameLeaderboardResponse } from "../../api/types";
import { ApiError } from "../../game/_shared/httpClient";
import { LEADERBOARD_TOP_N, useLeaderboardData } from "../useLeaderboardData";

const mockGetLeaderboard = jest.fn();
jest.mock("../../api/stats", () => ({
  statsApi: { getLeaderboard: (...args: unknown[]) => mockGetLeaderboard(...args) },
}));

const mockNetwork = { isOnline: true, isInitialized: true };
jest.mock("../../game/_shared/NetworkContext", () => ({
  useNetwork: () => mockNetwork,
}));

const ALICE: GameLeaderboardEntry = {
  rank: 1,
  player_name: "Alice",
  value: 900,
  completed_at: "2026-09-01T00:00:00Z",
  is_me: false,
};
const ME: GameLeaderboardEntry = {
  rank: 57,
  player_name: "Me",
  value: 100,
  completed_at: "2026-09-02T00:00:00Z",
  is_me: true,
};

function board(
  entries: GameLeaderboardEntry[],
  me: GameLeaderboardEntry | null = null
): GameLeaderboardResponse {
  return { game_type: "sudoku", partition: {}, label_key: "score", entries, me };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  mockGetLeaderboard.mockReset();
  mockNetwork.isOnline = true;
  mockNetwork.isInitialized = true;
  jest.mocked(Sentry.captureException).mockClear();
});

afterEach(() => jest.useRealTimers());

describe("useLeaderboardData (#2633)", () => {
  it("reads the board with its partition and the top N, and returns the caller's entry", async () => {
    const answer = deferred<GameLeaderboardResponse>();
    mockGetLeaderboard.mockReturnValue(answer.promise);
    const { result } = await renderHook(() =>
      useLeaderboardData("sudoku", { difficulty: "hard", variant: "classic" })
    );
    expect(result.current.status).toBe("loading");
    await act(async () => answer.resolve(board([ALICE], ME)));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mockGetLeaderboard).toHaveBeenCalledWith(
      "sudoku",
      { difficulty: "hard", variant: "classic" },
      { limit: LEADERBOARD_TOP_N }
    );
    expect(LEADERBOARD_TOP_N).toBeLessThanOrEqual(50);
    expect(result.current.entries).toEqual([ALICE]);
    expect(result.current.me).toEqual(ME);
  });

  it("treats a server without `me` (before #2633) as no entry", async () => {
    const { me: _me, ...legacy } = board([ALICE]);
    mockGetLeaderboard.mockResolvedValue(legacy);
    const { result } = await renderHook(() => useLeaderboardData("freecell", {}));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.me).toBeNull();
  });

  it("retries a transient network failure before giving up", async () => {
    jest.useFakeTimers();
    mockGetLeaderboard
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(board([ALICE]));
    const { result } = await renderHook(() => useLeaderboardData("freecell", {}));
    await act(async () => {
      await jest.runAllTimersAsync();
    });
    expect(mockGetLeaderboard).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("ready");
  });

  it("is offline after the retries run out, and fetches again on reconnect", async () => {
    jest.useFakeTimers();
    mockGetLeaderboard.mockRejectedValue(new TypeError("Network request failed"));
    const { result, rerender } = await renderHook(() => useLeaderboardData("freecell", {}));
    await act(async () => {
      await jest.runAllTimersAsync();
    });
    expect(result.current.status).toBe("offline");
    expect(result.current.entries).toEqual([]);

    // NetInfo notices the drop, then the connection comes back.
    mockNetwork.isOnline = false;
    await rerender({});
    mockGetLeaderboard.mockReset();
    mockGetLeaderboard.mockResolvedValue(board([ALICE]));
    mockNetwork.isOnline = true;
    await rerender({});
    await act(async () => {
      await jest.runAllTimersAsync();
    });
    expect(mockGetLeaderboard).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
  });

  it("offline: requests nothing, then loads the board once back online", async () => {
    mockNetwork.isOnline = false;
    mockGetLeaderboard.mockResolvedValue(board([ALICE]));
    const { result, rerender } = await renderHook(() => useLeaderboardData("freecell", {}));
    expect(result.current.status).toBe("offline");
    expect(mockGetLeaderboard).not.toHaveBeenCalled();

    mockNetwork.isOnline = true;
    await rerender({});
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mockGetLeaderboard).toHaveBeenCalledTimes(1);
    expect(result.current.entries).toEqual([ALICE]);
  });

  it("an HTTP error is `error`, never retried on its own, and retry() asks again", async () => {
    mockGetLeaderboard.mockRejectedValueOnce(new ApiError("Leaderboard not found.", 500));
    const { result } = await renderHook(() => useLeaderboardData("freecell", {}));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(mockGetLeaderboard).toHaveBeenCalledTimes(1);
    // HTTP errors are breadcrumbed by httpClient, not captured.
    expect(Sentry.captureException).not.toHaveBeenCalled();

    mockGetLeaderboard.mockResolvedValueOnce(board([ALICE]));
    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.entries).toEqual([ALICE]);
  });

  it("reports an unexpected failure to Sentry", async () => {
    mockGetLeaderboard.mockRejectedValueOnce(new Error("boom"));
    const { result } = await renderHook(() => useLeaderboardData("freecell", {}));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("a new partition shows loading at once and drops a late answer for the old one", async () => {
    const easy = deferred<GameLeaderboardResponse>();
    const hard = deferred<GameLeaderboardResponse>();
    mockGetLeaderboard.mockReturnValueOnce(easy.promise).mockReturnValueOnce(hard.promise);
    const { result, rerender } = await renderHook(
      ({ difficulty }: { difficulty: string }) =>
        useLeaderboardData("sudoku", { difficulty, variant: "classic" }),
      { initialProps: { difficulty: "easy" } }
    );
    await rerender({ difficulty: "hard" });
    expect(result.current.status).toBe("loading");

    await act(async () => hard.resolve(board([{ ...ALICE, player_name: "Hard" }])));
    await act(async () => easy.resolve(board([{ ...ALICE, player_name: "Easy" }])));
    expect(result.current.status).toBe("ready");
    expect(result.current.entries.map((e) => e.player_name)).toEqual(["Hard"]);
    expect(mockGetLeaderboard).toHaveBeenLastCalledWith(
      "sudoku",
      { difficulty: "hard", variant: "classic" },
      { limit: LEADERBOARD_TOP_N }
    );
  });

  it("the same partition in a new object doesn't fetch again", async () => {
    mockGetLeaderboard.mockResolvedValue(board([ALICE]));
    const { result, rerender } = await renderHook(
      ({ partition }: { partition: Record<string, string> }) =>
        useLeaderboardData("sudoku", partition),
      { initialProps: { partition: { difficulty: "easy" } } }
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await rerender({ partition: { difficulty: "easy" } });
    expect(mockGetLeaderboard).toHaveBeenCalledTimes(1);
  });
});

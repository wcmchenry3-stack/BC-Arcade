/**
 * useGameLeaderboard (#2976): a game screen's rank lookup and leaderboard
 * opener in one call, on a per-game `sessionBoardAdapter` the hook owns.
 */
import { act, renderHook } from "@testing-library/react-native";
import { resetDisplayNameCacheForTests, storeAssignedDisplayName } from "../displayName";
import { useGameLeaderboard } from "../useGameLeaderboard";

// Every adapter built, by game type; a plain array survives clearAllMocks.
const mockBuilt: string[] = [];
const mockRankSubmit = jest.fn();
jest.mock("../sessionBoardAdapter", () => ({
  sessionBoardAdapter: (gameType: string) => {
    mockBuilt.push(gameType);
    return { gameType, submit: (...args: unknown[]) => mockRankSubmit(gameType, ...args) };
  },
}));

jest.mock("../displayNameSync", () => ({
  joinLeaderboards: jest.fn(() => Promise.resolve(true)),
  getLeaderboardSyncPending: () => Promise.resolve(null),
}));

jest.mock("../NetworkContext", () => ({
  useNetwork: () => ({ isOnline: true, isInitialized: true }),
}));

const navigate = jest.fn();
const navigation = { navigate };

beforeEach(() => {
  jest.clearAllMocks();
  resetDisplayNameCacheForTests();
});

describe("useGameLeaderboard", () => {
  it("starts idle, with an opener for the game's board and the partition played", async () => {
    const { result } = await renderHook(() =>
      useGameLeaderboard("sudoku", navigation, { difficulty: "hard", variant: "mini" })
    );
    expect(result.current.leaderboard.status).toBe("idle");
    expect(result.current.leaderboard.rank).toBeNull();
    result.current.openLeaderboard?.();
    expect(navigate).toHaveBeenCalledWith("Leaderboard", {
      gameType: "sudoku",
      partition: { difficulty: "hard", variant: "mini" },
    });
  });

  it("looks the finished game up on that game's session board", async () => {
    await storeAssignedDisplayName("Riley");
    mockRankSubmit.mockResolvedValue({ kind: "ranked", rank: 3 });
    const { result } = await renderHook(() => useGameLeaderboard("freecell", navigation));
    await act(async () => {
      await result.current.leaderboard.submit({ gameId: "g-1" });
    });
    expect(mockRankSubmit).toHaveBeenCalledWith("freecell", "Riley", { gameId: "g-1" });
    expect(result.current.leaderboard.status).toBe("saved");
    expect(result.current.leaderboard.rank).toBe(3);
    expect(result.current.leaderboard.playerName).toBe("Riley");
  });

  it("builds one adapter per game type and keeps it across renders and mounts", async () => {
    const first = await renderHook(() => useGameLeaderboard("twenty48", navigation));
    await first.rerender({});
    await first.unmount();
    await renderHook(() => useGameLeaderboard("twenty48", navigation));
    await renderHook(() => useGameLeaderboard("hearts", navigation));
    expect(mockBuilt.filter((g) => g === "twenty48")).toEqual(["twenty48"]);
    expect(mockBuilt.filter((g) => g === "hearts")).toEqual(["hearts"]);
  });

  it("has no opener for a game without an openable board", async () => {
    const { result } = await renderHook(() => useGameLeaderboard("daily_word", navigation));
    expect(result.current.openLeaderboard).toBeUndefined();
  });
});

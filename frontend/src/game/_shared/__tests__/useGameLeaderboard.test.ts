/**
 * useGameLeaderboard (#2976): a game screen's rank lookup and leaderboard
 * opener in one call, on `useGameRank`.
 */
import { act, renderHook } from "@testing-library/react-native";
import { resetDisplayNameCacheForTests, storeAssignedDisplayName } from "../displayName";
import { useGameLeaderboard } from "../useGameLeaderboard";

const mockLookupGameRank = jest.fn();
jest.mock("../lookupGameRank", () => ({
  ...jest.requireActual("../lookupGameRank"),
  lookupGameRank: (...args: unknown[]) => mockLookupGameRank(...args),
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

  it("looks the finished game up", async () => {
    await storeAssignedDisplayName("Riley");
    mockLookupGameRank.mockResolvedValue({ kind: "ranked", rank: 3 });
    const { result } = await renderHook(() => useGameLeaderboard("freecell", navigation));
    await act(async () => {
      await result.current.leaderboard.lookup("g-1");
    });
    expect(mockLookupGameRank).toHaveBeenCalledWith("g-1");
    expect(result.current.leaderboard.status).toBe("saved");
    expect(result.current.leaderboard.rank).toBe(3);
    expect(result.current.leaderboard.playerName).toBe("Riley");
  });

  it("has no opener for a game without an openable board", async () => {
    const { result } = await renderHook(() => useGameLeaderboard("daily_word", navigation));
    expect(result.current.openLeaderboard).toBeUndefined();
  });
});

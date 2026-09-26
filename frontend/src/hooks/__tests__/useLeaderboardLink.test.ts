import { renderHook } from "@testing-library/react-native";
import { GAME_TYPES, type GameType } from "../../api/vocab";
import { __forceStoreBuildForTests, HIDDEN_GAMES } from "../../entitlements/gameVisibility";
import { hasLeaderboard } from "../../game/_shared/leaderboardAvailability";
import { partitionKey } from "../../game/_shared/boardPartition";
import { useLeaderboardLink } from "../useLeaderboardLink";

const navigate = jest.fn();
const navigation = { navigate };

afterEach(() => {
  navigate.mockClear();
  __forceStoreBuildForTests(false);
});

describe("hasLeaderboard (#2633)", () => {
  it("is true exactly for the games with an enabled board", () => {
    expect(GAME_TYPES.filter(hasLeaderboard).sort()).toEqual(
      [
        "cascade",
        "freecell",
        "hearts",
        "mahjong",
        "solitaire",
        "sort",
        "starswarm",
        "sudoku",
        "twenty48",
        "yacht",
      ].sort()
    );
  });

  it("is false for games hidden in a store build", () => {
    __forceStoreBuildForTests(true);
    for (const game of HIDDEN_GAMES) expect(hasLeaderboard(game as GameType)).toBe(false);
    expect(hasLeaderboard("sudoku")).toBe(true);
  });
});

describe("useLeaderboardLink", () => {
  it("opens the game's board with the partition played", async () => {
    const { result } = await renderHook(() =>
      useLeaderboardLink(navigation, "sudoku", { difficulty: "hard", variant: "mini" })
    );
    result.current?.();
    expect(navigate).toHaveBeenCalledWith("Leaderboard", {
      gameType: "sudoku",
      partition: { difficulty: "hard", variant: "mini" },
    });
  });

  it("sends no partition for an unpartitioned board", async () => {
    const { result } = await renderHook(() => useLeaderboardLink(navigation, "freecell"));
    result.current?.();
    expect(navigate).toHaveBeenCalledWith("Leaderboard", { gameType: "freecell" });
  });

  it("is undefined for a game whose board is disabled", async () => {
    expect(
      (await renderHook(() => useLeaderboardLink(navigation, "blackjack"))).result.current
    ).toBe(undefined);
    expect(
      (await renderHook(() => useLeaderboardLink(navigation, "daily_word"))).result.current
    ).toBe(undefined);
  });

  it("is undefined for a game hidden in a store build", async () => {
    __forceStoreBuildForTests(true);
    const { result } = await renderHook(() =>
      useLeaderboardLink(navigation, "starswarm", { difficulty_tier: "Captain" })
    );
    expect(result.current).toBeUndefined();
  });

  it("keeps the same callback while the partition's values don't change", async () => {
    const { result, rerender } = await renderHook(
      ({ difficulty }: { difficulty: string }) =>
        useLeaderboardLink(navigation, "sudoku", { difficulty, variant: "classic" }),
      { initialProps: { difficulty: "easy" } }
    );
    const first = result.current;
    await rerender({ difficulty: "easy" });
    expect(result.current).toBe(first);
    await rerender({ difficulty: "medium" });
    expect(result.current).not.toBe(first);
  });

  it("asks the board to refetch after the sync when the card's rank is pending", async () => {
    const { result } = await renderHook(() => useLeaderboardLink(navigation, "freecell"));
    result.current?.({ pendingSync: true });
    expect(navigate).toHaveBeenLastCalledWith("Leaderboard", {
      gameType: "freecell",
      refreshAfterSync: true,
    });
    result.current?.({ pendingSync: false });
    expect(navigate).toHaveBeenLastCalledWith("Leaderboard", { gameType: "freecell" });
  });
});

describe("partitionKey", () => {
  it("is the same whatever order the keys were written in", () => {
    expect(partitionKey({ difficulty: "hard", variant: "mini" })).toBe(
      partitionKey({ variant: "mini", difficulty: "hard" })
    );
    expect(partitionKey({ difficulty: "hard" })).not.toBe(partitionKey({ difficulty: "easy" }));
    expect(partitionKey()).toBe(partitionKey({}));
  });
});

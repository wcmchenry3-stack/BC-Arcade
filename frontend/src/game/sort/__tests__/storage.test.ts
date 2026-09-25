import AsyncStorage from "@react-native-async-storage/async-storage";
import { applyLevelSolve, loadBestMoves, recordLevelSolve, totalBestMoves } from "../storage";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("recordLevelSolve (#2512)", () => {
  it("makes the first solve of a level its best", async () => {
    await expect(recordLevelSolve(3, 20)).resolves.toEqual({
      best: 20,
      isNewBest: true,
      firstSolve: true,
    });
  });

  it("keeps the fewest moves per level, and marks later solves as repeats", async () => {
    await recordLevelSolve(3, 20);
    await expect(recordLevelSolve(3, 25)).resolves.toEqual({
      best: 20,
      isNewBest: false,
      firstSolve: false,
    });
    await expect(recordLevelSolve(3, 14)).resolves.toEqual({
      best: 14,
      isNewBest: true,
      firstSolve: false,
    });
  });

  it("tracks each level separately", async () => {
    await recordLevelSolve(3, 20);
    await expect(recordLevelSolve(4, 30)).resolves.toEqual(
      expect.objectContaining({ best: 30, firstSolve: true })
    );
  });

  it("starts fresh when the stored bests are corrupt", async () => {
    await AsyncStorage.setItem("@sort/best_moves", "not json");
    await expect(recordLevelSolve(3, 20)).resolves.toEqual(
      expect.objectContaining({ best: 20, isNewBest: true })
    );
  });

  it("stores the bests loadBestMoves reads back", async () => {
    await recordLevelSolve(1, 8);
    await recordLevelSolve(2, 11);
    await recordLevelSolve(1, 9);
    await expect(loadBestMoves()).resolves.toEqual({ "1": 8, "2": 11 });
  });
});

describe("applyLevelSolve (#2625)", () => {
  it("returns the solve and the updated bests without mutating its input", () => {
    const bests = { "1": 10 };
    expect(applyLevelSolve(bests, 2, 7)).toEqual({
      solve: { best: 7, isNewBest: true, firstSolve: true },
      bests: { "1": 10, "2": 7 },
    });
    expect(bests).toEqual({ "1": 10 });
  });

  it("keeps the same bests for a replay that doesn't beat them", () => {
    const bests = { "1": 10 };
    const out = applyLevelSolve(bests, 1, 12);
    expect(out.solve).toEqual({ best: 10, isNewBest: false, firstSolve: false });
    expect(out.bests).toBe(bests);
  });
});

describe("totalBestMoves (#2625)", () => {
  it("sums the best moves of every level up to and including the given one", () => {
    expect(totalBestMoves({ "1": 5, "2": 7, "3": 9, "4": 100 }, 3)).toBe(21);
  });

  it("is null when a level up to the given one has no best", () => {
    expect(totalBestMoves({ "1": 5, "3": 9 }, 3)).toBeNull();
    expect(totalBestMoves({}, 1)).toBeNull();
  });

  it("is null when a stored best is not a move count", () => {
    expect(totalBestMoves({ "1": 5, "2": -1 }, 2)).toBeNull();
    expect(totalBestMoves({ "1": 5, "2": 2.5 }, 2)).toBeNull();
  });
});

import { bestStarsFor, starsFor, twoStarMoves } from "../stars";
import { loadBestMoves, saveBestMoves } from "../storage";
import AsyncStorage from "@react-native-async-storage/async-storage";

describe("starsFor (#3687)", () => {
  it.each([
    // par 7: 2 stars up to ceil(8.75) = 9.
    [1, 7, 3],
    [6, 7, 3],
    [7, 7, 3], // par exactly
    [8, 7, 2], // par + 1
    [9, 7, 2], // ceil(par x 1.25) exactly
    [10, 7, 1], // one past it
    // par 8: 1.25 x 8 = 10 exactly, no rounding.
    [10, 8, 2],
    [11, 8, 1],
    // par 4: 5 exactly.
    [5, 4, 2],
    [6, 4, 1],
    // par 1: ceil(1.25) = 2.
    [1, 1, 3],
    [2, 1, 2],
    [3, 1, 1],
  ])("%i moves on par %i earns %i stars", (moves, par, stars) => {
    expect(starsFor(moves, par)).toBe(stars);
  });

  it("twoStarMoves is ceil(par x 1.25)", () => {
    expect(twoStarMoves(7)).toBe(9);
    expect(twoStarMoves(8)).toBe(10);
    expect(twoStarMoves(40)).toBe(50);
    expect(twoStarMoves(41)).toBe(52);
  });
});

describe("bestStarsFor", () => {
  it("derives the level's best stars from its best moves and par", () => {
    expect(bestStarsFor({ "5": 7 }, 5, 7)).toBe(3);
    expect(bestStarsFor({ "5": 9 }, 5, 7)).toBe(2);
    expect(bestStarsFor({ "5": 10 }, 5, 7)).toBe(1);
  });

  it("is 0 for a level with no best, or without a known par", () => {
    expect(bestStarsFor({}, 5, 7)).toBe(0);
    expect(bestStarsFor({ "4": 3 }, 5, 7)).toBe(0);
    expect(bestStarsFor({ "5": 7 }, 5, undefined)).toBe(0);
  });

  it("loads stars from a save made before stars existed (best moves only)", async () => {
    await AsyncStorage.clear();
    // The pre-stars format: just moves per level.
    await AsyncStorage.setItem("@sort/best_moves", JSON.stringify({ "1": 6, "2": 12 }));
    const bests = await loadBestMoves();
    expect(bests).toEqual({ "1": 6, "2": 12 });
    expect(bestStarsFor(bests ?? {}, 1, 7)).toBe(3);
    expect(bestStarsFor(bests ?? {}, 2, 8)).toBe(1);
    // Saving again adds nothing: there is no second copy to keep in step.
    await saveBestMoves(bests ?? {});
    expect(JSON.parse((await AsyncStorage.getItem("@sort/best_moves")) ?? "{}")).toEqual({
      "1": 6,
      "2": 12,
    });
  });
});

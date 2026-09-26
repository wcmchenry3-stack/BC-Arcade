import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  applyLevelSolve,
  highestSolvedLevel,
  loadBestMoves,
  mergeBestMoves,
  saveBestMoves,
  totalBestMoves,
} from "../storage";

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe("loadBestMoves / saveBestMoves (#2512, #2625)", () => {
  it("reads back what was saved", async () => {
    await expect(saveBestMoves({ "1": 8, "2": 11 })).resolves.toBe(true);
    await expect(loadBestMoves()).resolves.toEqual({ "1": 8, "2": 11 });
  });

  it("reads nothing stored as no bests", async () => {
    await expect(loadBestMoves()).resolves.toEqual({});
  });

  it("reads corrupt bests as none, and drops values that aren't move counts", async () => {
    await AsyncStorage.setItem("@sort/best_moves", "not json");
    await expect(loadBestMoves()).resolves.toEqual({});
    await AsyncStorage.setItem("@sort/best_moves", JSON.stringify({ "1": 5, "2": "x", "3": -1 }));
    await expect(loadBestMoves()).resolves.toEqual({ "1": 5 });
  });

  it("is null when storage can't be read, so the caller doesn't overwrite it", async () => {
    await saveBestMoves({ "1": 8 });
    jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("disk"));
    await expect(loadBestMoves()).resolves.toBeNull();
    await expect(loadBestMoves()).resolves.toEqual({ "1": 8 });
  });

  it("saves the bests it is given, without reading storage", async () => {
    await saveBestMoves({ "1": 8, "2": 11 });
    const read = jest.spyOn(AsyncStorage, "getItem");
    read.mockClear(); // the storage mock's own jest.fn keeps earlier calls
    await saveBestMoves({ "1": 7, "2": 11 });
    expect(read).not.toHaveBeenCalled();
    await expect(loadBestMoves()).resolves.toEqual({ "1": 7, "2": 11 });
  });

  it("resolves false when the write fails", async () => {
    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("full"));
    await expect(saveBestMoves({ "1": 8 })).resolves.toBe(false);
  });
});

describe("mergeBestMoves (#2625)", () => {
  it("keeps the lower value per level and every level of both", () => {
    expect(mergeBestMoves({ "1": 3, "2": 9 }, { "1": 9, "2": 5, "3": 7 })).toEqual({
      "1": 3,
      "2": 5,
      "3": 7,
    });
  });
});

describe("highestSolvedLevel (#2625)", () => {
  it("is the highest level with a best, or 0", () => {
    expect(highestSolvedLevel({ "2": 5, "10": 7, "3": 1 })).toBe(10);
    expect(highestSolvedLevel({})).toBe(0);
    expect(highestSolvedLevel({ x: 4 })).toBe(0);
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

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import {
  applyLevelSolve,
  clearGame,
  highestSolvedLevel,
  loadBestMoves,
  loadProgress,
  mergeBestMoves,
  saveBestMoves,
  saveProgress,
  totalBestMoves,
  type SortProgress,
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
      solve: { best: 7, isNewBest: false, improved: true, firstSolve: true },
      bests: { "1": 10, "2": 7 },
    });
    expect(bests).toEqual({ "1": 10 });
  });

  it("flags a later, better solve as a new best", () => {
    const out = applyLevelSolve({ "1": 10 }, 1, 8);
    expect(out.solve).toEqual({ best: 8, isNewBest: true, improved: true, firstSolve: false });
    expect(out.bests).toEqual({ "1": 8 });
  });

  it("keeps the same bests for a replay that doesn't beat them", () => {
    const bests = { "1": 10 };
    const out = applyLevelSolve(bests, 1, 12);
    expect(out.solve).toEqual({ best: 10, isNewBest: false, improved: false, firstSolve: false });
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

describe("saveProgress / loadProgress / clearGame (#2957)", () => {
  const progress: SortProgress = {
    unlockedLevel: 4,
    currentLevelId: 3,
    currentState: {
      bottles: [["red", "blue"], []],
      moveCount: 2,
      undosUsed: 0,
      isComplete: false,
      selectedBottleIndex: null,
    },
  };
  const fresh = { unlockedLevel: 1, currentLevelId: null, currentState: null };

  it("reads back what was saved", async () => {
    await saveProgress(progress);
    await expect(loadProgress()).resolves.toEqual(progress);
  });

  it("reads back the replay counts saved with a board in progress (#3386)", async () => {
    await saveProgress({ ...progress, replayUnit: 2, replayPending: 7, replayGameId: "game-1" });
    await expect(loadProgress()).resolves.toEqual({
      ...progress,
      replayUnit: 2,
      replayPending: 7,
      replayGameId: "game-1",
    });
  });

  it("drops a replay game id that is not an id, keeping the board (#3386)", async () => {
    for (const replayGameId of [42, "", null]) {
      await AsyncStorage.setItem("@sort/progress", JSON.stringify({ ...progress, replayGameId }));
      const loaded = await loadProgress();
      expect(loaded).toEqual(progress);
      expect(loaded).not.toHaveProperty("replayGameId");
    }
  });

  it("loads an older save with no replay counts as it was (#3386)", async () => {
    await AsyncStorage.setItem("@sort/progress", JSON.stringify(progress));
    const loaded = await loadProgress();
    expect(loaded).toEqual(progress);
    expect(loaded).not.toHaveProperty("replayUnit");
  });

  it("drops a replay count that is not a count, keeping the board (#3386)", async () => {
    await AsyncStorage.setItem(
      "@sort/progress",
      JSON.stringify({ ...progress, replayUnit: "lots", replayPending: -1 })
    );
    const loaded = await loadProgress();
    expect(loaded).toEqual(progress);
    expect(loaded).not.toHaveProperty("replayUnit");
    expect(loaded).not.toHaveProperty("replayPending");
  });

  it("starts at level 1 with no game when nothing is stored", async () => {
    await expect(loadProgress()).resolves.toEqual(fresh);
  });

  it("starts at level 1 when the stored progress is corrupt", async () => {
    await AsyncStorage.setItem("@sort/progress", "{not json");
    await expect(loadProgress()).resolves.toEqual(fresh);
  });

  it("starts at level 1 when storage can't be read", async () => {
    jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("disk"));
    await expect(loadProgress()).resolves.toEqual(fresh);
  });

  it("clearGame removes the saved progress", async () => {
    await saveProgress(progress);
    await clearGame();
    await expect(AsyncStorage.getItem("@sort/progress")).resolves.toBeNull();
    await expect(loadProgress()).resolves.toEqual(fresh);
  });

  it("does not touch the best moves when clearing the game", async () => {
    await saveBestMoves({ "1": 8 });
    await saveProgress(progress);
    await clearGame();
    await expect(loadBestMoves()).resolves.toEqual({ "1": 8 });
  });
});

describe("Sentry reporting (#2987: failures used to be swallowed)", () => {
  const captureException = Sentry.captureException as jest.Mock;
  const captureMessage = Sentry.captureMessage as jest.Mock;
  const tags = (op: string) => ({ tags: { subsystem: "sort.storage", op } });

  beforeEach(() => {
    captureException.mockClear();
    captureMessage.mockClear();
  });

  it("reports failed writes and resolves instead of rejecting", async () => {
    const progress = { unlockedLevel: 2, currentLevelId: null, currentState: null };
    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("full"));
    await expect(saveProgress(progress)).resolves.toBeUndefined();
    expect(captureException).toHaveBeenLastCalledWith(expect.any(Error), tags("save"));

    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("full"));
    await expect(saveBestMoves({ "1": 3 })).resolves.toBe(false);
    expect(captureException).toHaveBeenLastCalledWith(expect.any(Error), tags("saveBestMoves"));

    jest.spyOn(AsyncStorage, "removeItem").mockRejectedValueOnce(new Error("io"));
    await expect(clearGame()).resolves.toBeUndefined();
    expect(captureException).toHaveBeenLastCalledWith(expect.any(Error), tags("clear"));
  });

  it("reports failed reads, and keeps what is stored", async () => {
    await saveProgress({ unlockedLevel: 5, currentLevelId: null, currentState: null });
    await saveBestMoves({ "1": 3 });
    for (const load of [loadProgress, loadBestMoves]) {
      jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("disk"));
      await load();
    }
    expect(captureException.mock.calls.map((c) => c[1])).toEqual([
      tags("load"),
      tags("loadBestMoves"),
    ]);
    await expect(loadProgress()).resolves.toEqual({
      unlockedLevel: 5,
      currentLevelId: null,
      currentState: null,
    });
    await expect(loadBestMoves()).resolves.toEqual({ "1": 3 });
  });

  it("warns about corrupt payloads; progress is discarded, bests read as none", async () => {
    await AsyncStorage.setItem("@sort/progress", "{x");
    await AsyncStorage.setItem("@sort/best_moves", "{x");
    await loadProgress();
    await loadBestMoves();
    expect(captureMessage.mock.calls.map((c) => [c[0], c[1].tags.op])).toEqual([
      ["sort.storage: corrupt progress payload, discarding", "load"],
      ["sort.storage: corrupt best moves, reading as none", "loadBestMoves"],
    ]);
    await expect(AsyncStorage.getItem("@sort/progress")).resolves.toBeNull();
    await expect(AsyncStorage.getItem("@sort/best_moves")).resolves.toBe("{x");
  });

  it("reads a stored payload that isn't progress as a fresh start", async () => {
    await AsyncStorage.setItem("@sort/progress", "7");
    await expect(loadProgress()).resolves.toEqual({
      unlockedLevel: 1,
      currentLevelId: null,
      currentState: null,
    });
    expect(captureMessage).not.toHaveBeenCalled();
  });
});

import AsyncStorage from "@react-native-async-storage/async-storage";

import { SORT_CATALOG_VERSION } from "../catalog";
import { getLobbyStatus, isResumable } from "../lobbyStatus";
import type { SortState } from "../types";

const PROGRESS_KEY = "@sort/progress";
const VERSION_KEY = "@sort/catalog_version";

const board = (over: Partial<SortState> = {}): SortState => ({
  bottles: [["red", "blue"], ["blue", "red"], []],
  moveCount: 2,
  undosUsed: 0,
  isComplete: false,
  selectedBottleIndex: null,
  ...over,
});

async function store(progress: unknown, version: string | null = String(SORT_CATALOG_VERSION)) {
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  if (version !== null) await AsyncStorage.setItem(VERSION_KEY, version);
}

describe("sort isResumable (#4008)", () => {
  it("needs a level and an unfinished board", () => {
    expect(isResumable(null)).toBe(false);
    expect(isResumable({ currentLevelId: null, currentState: null })).toBe(false);
    expect(isResumable({ currentLevelId: 4, currentState: null })).toBe(false);
    expect(isResumable({ currentLevelId: null, currentState: board() })).toBe(false);
    expect(isResumable({ currentLevelId: 4, currentState: board({ isComplete: true }) })).toBe(
      false
    );
    expect(isResumable({ currentLevelId: 4, currentState: board() })).toBe(true);
  });
});

describe("sort getLobbyStatus (#4008)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it("is Resume for a level in progress", async () => {
    await store({ unlockedLevel: 4, currentLevelId: 4, currentState: board() });
    expect(await getLobbyStatus()).toEqual({ kind: "resume" });
  });

  it("is nothing without a save, or with progress but no board", async () => {
    expect(await getLobbyStatus()).toBeUndefined();
    await store({ unlockedLevel: 4, currentLevelId: null, currentState: null });
    expect(await getLobbyStatus()).toBeUndefined();
    await store({ unlockedLevel: 4, currentLevelId: 4 });
    expect(await getLobbyStatus()).toBeUndefined();
  });

  it("is nothing for a solved board", async () => {
    await store({ currentLevelId: 4, currentState: board({ isComplete: true }) });
    expect(await getLobbyStatus()).toBeUndefined();
  });

  it("is nothing for a board from before the level catalog, or a newer one's", async () => {
    await store({ currentLevelId: 4, currentState: board() }, null);
    expect(await getLobbyStatus()).toBeUndefined();
    await store({ currentLevelId: 4, currentState: board() }, String(SORT_CATALOG_VERSION + 1));
    expect(await getLobbyStatus()).toBeUndefined();
  });

  it("shows no best: Sort's bests are per level", async () => {
    await store({ unlockedLevel: 4, currentLevelId: null, currentState: null });
    await AsyncStorage.setItem(
      "personal_best_v1:sort",
      JSON.stringify({ v: 1, bests: { "1": 9 } })
    );
    expect(await getLobbyStatus()).toBeUndefined();
  });

  it("reads a corrupt or misshapen save as no status, and writes and removes nothing", async () => {
    for (const raw of ["{not json", "null", "[]", JSON.stringify({ currentLevelId: "4" })]) {
      await AsyncStorage.setItem(PROGRESS_KEY, raw);
      await AsyncStorage.setItem(VERSION_KEY, String(SORT_CATALOG_VERSION));
      jest.clearAllMocks();
      expect(await getLobbyStatus()).toBeUndefined();
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
      expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
      expect(await AsyncStorage.getItem(PROGRESS_KEY)).toBe(raw);
    }
  });

  it("reads a storage failure as no status", async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("disk"));
    expect(await getLobbyStatus()).toBeUndefined();
  });
});

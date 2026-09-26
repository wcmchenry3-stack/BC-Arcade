import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import {
  clearGame,
  loadGame,
  saveGame,
  loadStats,
  saveStats,
  loadProgress,
  saveProgress,
  unlockNextLayout,
  DEFAULT_PROGRESS,
} from "../storage";
import { createGame } from "../engine";
import { TURTLE_LAYOUT } from "../layouts/turtle";
import type { MahjongState } from "../types";

const GAME_KEY = "mahjong_game";

function seedState(): MahjongState {
  return createGame(TURTLE_LAYOUT, 12345);
}

describe("mahjong game storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it("round-trips a fresh deal via save → load", async () => {
    const s = seedState();
    await saveGame(s);
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!._v).toBe(1);
    expect(loaded!.tiles.length).toBe(s.tiles.length);
    expect(loaded!.score).toBe(s.score);
    expect(loaded!.shufflesLeft).toBe(s.shufflesLeft);
    expect(loaded!.isComplete).toBe(false);
  });

  it("returns null when no save exists", async () => {
    expect(await loadGame()).toBeNull();
  });

  it("strips nested undoStack snapshots at save time so storage cannot balloon", async () => {
    const nested: MahjongState = {
      ...seedState(),
      undoStack: [{ ...seedState(), undoStack: [{ ...seedState(), undoStack: [] }] }],
    };
    await saveGame(nested);
    const raw = await AsyncStorage.getItem(GAME_KEY);
    const parsed = JSON.parse(raw!);
    for (const snap of parsed.undoStack) {
      expect(snap.undoStack).toEqual([]);
    }
  });

  it("returns null and captures a warning on corrupt JSON", async () => {
    await AsyncStorage.setItem(GAME_KEY, "not-json{{");
    expect(await loadGame()).toBeNull();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("corrupt game payload"),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ subsystem: "mahjong.storage", op: "load" }),
      })
    );
    expect(await AsyncStorage.getItem(GAME_KEY)).toBeNull();
  });

  it("returns null when the payload has a different shape (missing fields)", async () => {
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify({ foo: "bar" }));
    expect(await loadGame()).toBeNull();
    expect(await AsyncStorage.getItem(GAME_KEY)).toBeNull();
  });

  it("returns null on schema version mismatch (_v !== 1)", async () => {
    const future = { ...seedState(), _v: 2 };
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(future));
    expect(await loadGame()).toBeNull();
  });

  it("clearGame removes the saved state", async () => {
    await saveGame(seedState());
    await clearGame();
    expect(await loadGame()).toBeNull();
  });

  it("normalizes missing startedAt to null", async () => {
    const stateWithout = { ...seedState() } as Partial<MahjongState>;
    delete (stateWithout as Record<string, unknown>).startedAt;
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(stateWithout));
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.startedAt).toBeNull();
  });
});

// #2750: the save banks the running clock and the load restarts it, so the
// time the app was closed never counts.
describe("mahjong storage — play clock across a relaunch (#2750)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });
  afterEach(() => jest.restoreAllMocks());

  it("keeps the play before the save and drops the time until the load", async () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(40_000);
    await saveGame({ ...seedState(), startedAt: 10_000, accumulatedMs: 5_000 });
    nowSpy.mockReturnValue(40_000 + 2 * 86_400_000);
    const loaded = await loadGame();
    expect(loaded!.accumulatedMs).toBe(35_000);
    expect(loaded!.startedAt).toBe(40_000 + 2 * 86_400_000);
  });

  it("loads an older build's save with a running startedAt and no accumulatedMs", async () => {
    const old = { ...seedState(), startedAt: 1_000 } as Record<string, unknown>;
    delete old["accumulatedMs"];
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(old));
    jest.spyOn(Date, "now").mockReturnValue(172_800_000);
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.accumulatedMs).toBe(0);
    expect(loaded!.startedAt).toBe(172_800_000);
  });

  it("keeps a deadlocked board's clock stopped", async () => {
    await AsyncStorage.setItem(
      GAME_KEY,
      JSON.stringify({ ...seedState(), isDeadlocked: true, startedAt: null, accumulatedMs: 9_000 })
    );
    const loaded = await loadGame();
    expect(loaded!.startedAt).toBeNull();
    expect(loaded!.accumulatedMs).toBe(9_000);
  });
});

describe("mahjong stats storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
  });

  it("returns zero defaults when no stats saved", async () => {
    const stats = await loadStats();
    expect(stats).toEqual({ bestScore: 0, bestTimeMs: 0, gamesPlayed: 0, gamesWon: 0 });
  });

  it("saves and loads stats round-trip", async () => {
    await saveStats({ bestScore: 1230, bestTimeMs: 185000, gamesPlayed: 10, gamesWon: 4 });
    const loaded = await loadStats();
    expect(loaded).toEqual({ bestScore: 1230, bestTimeMs: 185000, gamesPlayed: 10, gamesWon: 4 });
  });

  it("returns zero defaults on corrupt stats payload", async () => {
    await AsyncStorage.setItem("mahjong_stats_v1", "not-json{");
    const stats = await loadStats();
    expect(stats).toEqual({ bestScore: 0, bestTimeMs: 0, gamesPlayed: 0, gamesWon: 0 });
  });

  it("coerces missing numeric fields to 0 on partial payload", async () => {
    await AsyncStorage.setItem("mahjong_stats_v1", JSON.stringify({ gamesPlayed: 5 }));
    const stats = await loadStats();
    expect(stats).toEqual({ bestScore: 0, bestTimeMs: 0, gamesPlayed: 5, gamesWon: 0 });
  });
});

// ---------------------------------------------------------------------------
// unlockNextLayout — pure function
// ---------------------------------------------------------------------------

const FAKE_LAYOUTS = [
  { id: "a", name: "A", tier: 1 as const, tileCount: 144, data: [] },
  { id: "b", name: "B", tier: 1 as const, tileCount: 144, data: [] },
  { id: "c", name: "C", tier: 2 as const, tileCount: 144, data: [] },
];

describe("unlockNextLayout", () => {
  it("unlocks the next layout after completing the first", () => {
    const result = unlockNextLayout("a", FAKE_LAYOUTS, ["a"]);
    expect(result).toEqual(["a", "b"]);
  });

  it("does not overflow past the last layout", () => {
    const result = unlockNextLayout("c", FAKE_LAYOUTS, ["a", "b", "c"]);
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("is idempotent when the next layout is already unlocked", () => {
    const result = unlockNextLayout("a", FAKE_LAYOUTS, ["a", "b"]);
    expect(result).toEqual(["a", "b"]);
  });

  it("returns a copy of the array (does not mutate input)", () => {
    const original = ["a"];
    const result = unlockNextLayout("a", FAKE_LAYOUTS, original);
    expect(result).not.toBe(original);
  });

  it("no-ops for an unknown layout id", () => {
    const result = unlockNextLayout("unknown", FAKE_LAYOUTS, ["a"]);
    expect(result).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// MahjongProgress — load / save
// ---------------------------------------------------------------------------

describe("mahjong progress storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
  });

  it("returns the default when no progress is saved", async () => {
    const progress = await loadProgress();
    expect(progress).toEqual(DEFAULT_PROGRESS);
  });

  it("round-trips progress via save → load", async () => {
    const data = {
      unlockedLayouts: ["turtle", "dragon"],
      currentLayoutId: "dragon",
      currentState: null,
    };
    await saveProgress(data);
    const loaded = await loadProgress();
    expect(loaded.unlockedLayouts).toEqual(["turtle", "dragon"]);
    expect(loaded.currentLayoutId).toBe("dragon");
    expect(loaded.currentState).toBeNull();
  });

  it("falls back to default and captures exception on corrupt progress payload", async () => {
    await AsyncStorage.setItem("@mahjong/progress", "not-json{");
    const progress = await loadProgress();
    expect(progress).toEqual(DEFAULT_PROGRESS);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ subsystem: "mahjong.storage", op: "loadProgress" }),
      })
    );
  });

  it("coerces missing unlockedLayouts to ['turtle']", async () => {
    await AsyncStorage.setItem("@mahjong/progress", JSON.stringify({ currentLayoutId: null }));
    const progress = await loadProgress();
    expect(progress.unlockedLayouts).toEqual(["turtle"]);
  });
});

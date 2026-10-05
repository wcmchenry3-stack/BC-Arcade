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
import { createGame, getAnyFreePair, selectTile, shuffleBoard, undoMove } from "../engine";
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
    expect(loaded!._v).toBe(2);
    expect(loaded!.tiles.length).toBe(s.tiles.length);
    expect(loaded!.score).toBe(s.score);
    expect(loaded!.shufflesLeft).toBe(s.shufflesLeft);
    expect(loaded!.isComplete).toBe(false);
  });

  it("returns null when no save exists", async () => {
    expect(await loadGame()).toBeNull();
  });

  it("strips nested undoStack snapshots at save time so storage cannot balloon", async () => {
    // #2961: entries are deltas, which hold no undo history of their own. A
    // version 1 save of two matches, its snapshots nesting histories of
    // their own, loads as two match deltas, and the next save is the board
    // plus a few hundred bytes per move instead of a board per move.
    const matchOn = (s: MahjongState) => {
      const [a, b] = getAnyFreePair(s.tiles)!;
      return selectTile(selectTile(s, a), b);
    };
    const s0 = seedState();
    const s1 = matchOn(s0);
    const s2 = matchOn(s1);
    const nest = (s: MahjongState) => ({ ...s, _v: 1, undoStack: [{ ...s0, undoStack: [] }] });
    const legacy = JSON.stringify({ ...s2, _v: 1, undoStack: [nest(s0), nest(s1)] });
    await AsyncStorage.setItem(GAME_KEY, legacy);
    await saveGame((await loadGame())!);
    const raw = (await AsyncStorage.getItem(GAME_KEY))!;
    const parsed = JSON.parse(raw);
    expect(parsed.undoStack.map((e: { kind: string }) => e.kind)).toEqual(["match", "match"]);
    for (const entry of parsed.undoStack) {
      expect(entry).not.toHaveProperty("undoStack");
      expect(entry).not.toHaveProperty("tiles");
      expect(entry).not.toHaveProperty("tilesBefore");
    }
    const boardOnly = JSON.stringify({ ...s2, undoStack: [] }).length;
    expect(raw.length).toBeLessThan(boardOnly + 2 * 1_000);
    expect(raw.length).toBeLessThan(legacy.length / 3);
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
    // Versions 1 (snapshot undo, migrated) and 2 (delta undo, #2961) load.
    const future = { ...seedState(), _v: 3 };
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

// #2961: the undo history is saved as deltas, and a version 1 save (full
// board snapshots) still loads, for one release, through the legacyUndo shim.
describe("mahjong storage — delta undo history (#2961)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  /** The seeded deal with its layout, as the screen deals it (a load fills in a missing one). */
  function layoutSeed(): MahjongState {
    return { ...seedState(), currentLayoutId: "turtle" };
  }

  /** `moves` matches from a seeded deal, shuffling when stuck; each state before a move too. */
  function play(moves: number) {
    const before: MahjongState[] = [];
    let state = layoutSeed();
    for (let i = 0; i < moves; i++) {
      before.push(state);
      const pair = getAnyFreePair(state.tiles);
      state = pair ? selectTile(selectTile(state, pair[0]), pair[1]) : shuffleBoard(state);
    }
    return { before, state };
  }

  /** What an undo restores: everything but the clock and the remaining history. */
  function board(s: MahjongState) {
    const { startedAt: _s, accumulatedMs: _a, paused: _p, undoStack: _u, ...rest } = s;
    return rest;
  }

  async function saved(): Promise<string> {
    return (await AsyncStorage.getItem(GAME_KEY))!;
  }

  it("round-trips the history: undo after a reload gives back the same boards", async () => {
    const { before, state } = play(30);
    await saveGame(state);
    const loaded = (await loadGame())!;
    expect(loaded.undoStack).toEqual(state.undoStack);
    let undone = loaded;
    for (let i = before.length - 1; i >= 0; i--) {
      undone = undoMove(undone);
      expect(board(undone)).toEqual(board(before[i]!));
    }
  });

  it("round-trips shuffles: the board before one, and one that changed nothing", async () => {
    const { state: played } = play(2);
    const shuffled = shuffleBoard(played);
    await saveGame(shuffled);
    const reloaded = (await loadGame())!;
    expect(reloaded.undoStack).toEqual(shuffled.undoStack);
    expect(undoMove(reloaded).tiles).toEqual(played.tiles);

    // A board no shuffle can fix: the shuffle is spent and the board left as it was.
    const stack = [0, 1, 2, 3].map((layer) => ({ ...played.tiles[0]!, id: layer, layer }));
    const stuck = shuffleBoard({ ...played, tiles: stack, undoStack: [] });
    expect(stuck.undoStack).toEqual([expect.objectContaining({ tilesBefore: null })]);
    await saveGame(stuck);
    const loaded = (await loadGame())!;
    expect(loaded.undoStack).toEqual(stuck.undoStack);
    const once = undoMove(loaded);
    expect(once.tiles).toEqual(stack);
    expect(once.isDeadlocked).toBe(false);
  });

  it("keeps a save after 30 matches well under 50 KB", async () => {
    const { state } = play(30);
    expect(state.undoStack).toHaveLength(30);
    await saveGame(state);
    // Full snapshots made this about 270 KB (#2961).
    expect((await saved()).length).toBeLessThan(50_000);
  });

  /**
   * A version 1 save: the game after `moves` moves, its history the full
   * states before each one, as that build stored them (a match's snapshot
   * with no selection, a shuffle's as it was, nested histories emptied).
   */
  function legacySave(moves: number, shuffleAt: number[] = []) {
    const before: MahjongState[] = [];
    let state = layoutSeed();
    const snapshots: unknown[] = [];
    for (let i = 0; i < moves; i++) {
      before.push(state);
      if (shuffleAt.includes(i)) {
        snapshots.push({ ...state, _v: 1, undoStack: [] });
        state = shuffleBoard(state);
      } else {
        const [a, b] = getAnyFreePair(state.tiles)!;
        snapshots.push({ ...state, _v: 1, selected: null, undoStack: [] });
        state = selectTile(selectTile(state, a), b);
      }
    }
    return { before, state, legacy: { ...state, _v: 1, undoStack: snapshots } };
  }

  it("loads a version 1 save and undoes it exactly, matches and a shuffle alike", async () => {
    const { before, state, legacy } = legacySave(3, [1]);
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(legacy));
    const loaded = (await loadGame())!;
    expect(loaded._v).toBe(2);
    expect(board(loaded)).toEqual(board(state));
    expect(loaded.undoStack.map((e) => e.kind)).toEqual(["match", "shuffle", "match"]);
    let undone = loaded;
    for (let i = before.length - 1; i >= 0; i--) {
      undone = undoMove(undone);
      expect(board(undone)).toEqual(board(before[i]!));
    }
    expect(undone.undoStack).toEqual([]);
  });

  it("plays on from a version 1 save, and saves it in the delta format", async () => {
    const { legacy } = legacySave(2);
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(legacy));
    const loaded = (await loadGame())!;
    const [a, b] = getAnyFreePair(loaded.tiles)!;
    const next = selectTile(selectTile(loaded, a), b);
    expect(next.pairsRemoved).toBe(3);
    await saveGame(next);
    const parsed = JSON.parse(await saved());
    expect(parsed._v).toBe(2);
    expect(parsed.undoStack.map((e: { kind: string }) => e.kind)).toEqual([
      "match",
      "match",
      "match",
    ]);
  });

  it("drops a version 1 history from a snapshot that isn't one back, keeping the game", async () => {
    const { before, legacy } = legacySave(3);
    const broken = {
      ...legacy,
      undoStack: [legacy.undoStack[0], { tiles: "x" }, legacy.undoStack[2]],
    };
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(broken));
    const loaded = (await loadGame())!;
    expect(loaded.tiles).toEqual(legacy.tiles);
    expect(loaded.undoStack).toHaveLength(1);
    expect(board(undoMove(loaded))).toEqual(board(before[2]!));
  });

  it("drops a saved history from a bad entry back, keeping the game", async () => {
    const { state } = play(3);
    const good = state.undoStack;
    // The board the second move left, which the third entry restores.
    const afterMove1 = undoMove(state).tiles;
    for (const bad of [
      { ...good[1], kind: "teleport" },
      { ...good[1], kind: "shuffle", tilesBefore: [7] },
      { ...good[1], scoreBefore: "10" },
      { ...good[1], removedTiles: [good[1]!] },
      // Indices that can't fit the board the entries above it restore.
      {
        ...good[1],
        removedTiles: [
          { index: 500, tile: state.tiles[0] },
          { index: 501, tile: state.tiles[1] },
        ],
      },
      // Tiles already on the board it would restore.
      {
        ...good[1],
        removedTiles: [
          { index: 0, tile: state.tiles[0] },
          { index: 1, tile: state.tiles[1] },
        ],
      },
      // A shuffle that would swap the board for one of another size.
      { ...good[1], kind: "shuffle", tilesBefore: [state.tiles[0]] },
      // A shuffle whose board has the right size but a tile twice.
      {
        ...good[1],
        kind: "shuffle",
        tilesBefore: [afterMove1[0], ...afterMove1.slice(0, -1)],
      },
    ]) {
      await AsyncStorage.setItem(
        GAME_KEY,
        JSON.stringify({ ...state, undoStack: [good[0], bad, good[2]] })
      );
      const loaded = (await loadGame())!;
      expect(loaded.tiles).toEqual(state.tiles);
      expect(loaded.undoStack).toEqual([good[2]]);
    }
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
    expect(stats).toEqual({ bestScore: 0, bestTimeMsByLayout: {}, gamesPlayed: 0, gamesWon: 0 });
  });

  it("saves and loads stats round-trip", async () => {
    const stats = {
      bestScore: 1230,
      bestTimeMsByLayout: { turtle: 185000, spider: 240000 },
      gamesPlayed: 10,
      gamesWon: 4,
    };
    await saveStats(stats);
    expect(await loadStats()).toEqual(stats);
  });

  it("returns zero defaults on corrupt stats payload", async () => {
    await AsyncStorage.setItem("mahjong_stats_v1", "not-json{");
    const stats = await loadStats();
    expect(stats).toEqual({ bestScore: 0, bestTimeMsByLayout: {}, gamesPlayed: 0, gamesWon: 0 });
  });

  // #2747: a best under the ranking floor came from a broken clock (an old
  // save resumed with no time banked): it loads as no best, so a real clear
  // can still set one.
  it("drops a stored best time under the ranking floor", async () => {
    await AsyncStorage.setItem(
      "mahjong_stats_v1",
      JSON.stringify({
        bestScore: 1220,
        bestTimeMsByLayout: { turtle: 4_000, spider: 36_000, cat: "fast", fish: null },
        gamesPlayed: 2,
        gamesWon: 1,
      })
    );
    expect((await loadStats()).bestTimeMsByLayout).toEqual({ spider: 36_000 });
  });

  // #2747: the old single best was across every layout and can't be
  // attributed to one, so it is dropped rather than shown as some layout's.
  it("ignores the old cross-layout best time", async () => {
    await AsyncStorage.setItem(
      "mahjong_stats_v1",
      JSON.stringify({ bestScore: 1220, bestTimeMs: 90_000, gamesPlayed: 2, gamesWon: 1 })
    );
    const stats = await loadStats();
    expect(stats.bestTimeMsByLayout).toEqual({});
    expect(stats).not.toHaveProperty("bestTimeMs");
  });

  it("coerces missing numeric fields to 0 on partial payload", async () => {
    await AsyncStorage.setItem("mahjong_stats_v1", JSON.stringify({ gamesPlayed: 5 }));
    const stats = await loadStats();
    expect(stats).toEqual({ bestScore: 0, bestTimeMsByLayout: {}, gamesPlayed: 5, gamesWon: 0 });
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

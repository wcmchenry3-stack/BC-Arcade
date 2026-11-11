/**
 * `TileData.mergedFrom` (#3689) is optional and adds nothing to what is saved for replay:
 *  - a save from before it loads as it always did, and the game plays on from it;
 *  - a save that has it opens at rest (no slide replayed);
 *  - the replay's move tuple is unchanged, and a recorded game still rebuilds its board and score.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { saveGame, loadGame } from "../storage";
import {
  _resetTileIds,
  createSeededRng,
  move,
  newGame,
  setRng,
  slideAndMerge,
  SIZE,
  Direction,
} from "../engine";
import { DIRECTION_ORDER, moveTuple, MoveTuple } from "../replay";
import { Twenty48State } from "../types";

const GAME_KEY = "twenty48_game_v2";

/** What a build from before #3689 wrote: tiles without `mergedFrom`. */
const OLD_SAVE: Twenty48State = {
  board: [
    [4, 0, 0, 0],
    [0, 2, 2, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 8],
  ],
  tiles: [
    { id: 5, value: 4, row: 0, col: 0, prevRow: 0, prevCol: 1, isNew: false, isMerge: true },
    { id: 2, value: 2, row: 1, col: 1, prevRow: 1, prevCol: 1, isNew: false, isMerge: false },
    { id: 3, value: 2, row: 1, col: 2, prevRow: 1, prevCol: 2, isNew: true, isMerge: false },
    { id: 4, value: 8, row: 3, col: 3, prevRow: 3, prevCol: 3, isNew: false, isMerge: false },
  ],
  score: 40,
  scoreDelta: 4,
  game_over: false,
  has_won: false,
  startedAt: null,
  accumulatedMs: 0,
};

describe("loading a save without mergedFrom", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setRng(createSeededRng(3));
  });

  it("loads exactly as it was written", async () => {
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(OLD_SAVE));
    const loaded = await loadGame();
    expect(loaded?.tiles).toEqual(OLD_SAVE.tiles);
    expect(loaded?.tiles.every((t) => t.mergedFrom === undefined)).toBe(true);
    expect(loaded?.board).toEqual(OLD_SAVE.board);
    expect(loaded?.score).toBe(40);
  });

  it("plays on from it: the next merge gets its sources, the old tiles keep theirs as none", async () => {
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(OLD_SAVE));
    const loaded = (await loadGame())!;
    const next = move(loaded, "left"); // the two 2s in row 1 merge
    const merged = next.tiles.filter((t) => t.isMerge);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.value).toBe(4);
    expect(merged[0]!.mergedFrom!.map((m) => m.id).sort()).toEqual([2, 3]);
    // The tile ids stay unique: the id counter was re-seeded above the save's ids.
    const ids = next.tiles.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a save from before tiles existed still loads (and so has no mergedFrom either)", async () => {
    const { tiles: _tiles, ...oldest } = OLD_SAVE;
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(oldest));
    const loaded = (await loadGame())!;
    expect(loaded.tiles).toHaveLength(4);
    expect(loaded.tiles.every((t) => t.mergedFrom === undefined)).toBe(true);
  });
});

describe("saving a game with mergedFrom", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setRng(createSeededRng(3));
  });

  it("opens at rest: the saved merge is not slid again", async () => {
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(OLD_SAVE));
    const merged = move((await loadGame())!, "left");
    expect(merged.tiles.some((t) => t.mergedFrom)).toBe(true);
    await saveGame(merged);
    const reloaded = (await loadGame())!;
    expect(reloaded.tiles.some((t) => t.mergedFrom !== undefined)).toBe(false);
    // Everything else about the tiles is what was saved.
    expect(reloaded.tiles.map((t) => ({ ...t, mergedFrom: undefined }))).toEqual(
      merged.tiles.map((t) => ({ ...t, mergedFrom: undefined }))
    );
  });
});

/** A seeded game played for `moves` swipes (cycling directions, skipping ones with no effect). */
function play(seed: number, moves: number, keepMergedFrom: boolean) {
  setRng(createSeededRng(seed));
  _resetTileIds();
  let state = newGame();
  const opening = state.board.map((r) => [...r]);
  const tuples: MoveTuple[] = [];
  const order: Direction[] = ["left", "down", "right", "up"];
  for (let i = 0; tuples.length < moves && i < moves * 6; i++) {
    const direction = order[i % 4]!;
    let next: Twenty48State;
    try {
      next = move(state, direction);
    } catch {
      if (state.game_over) break;
      continue;
    }
    if (!keepMergedFrom) {
      next = { ...next, tiles: next.tiles.map(({ mergedFrom: _m, ...t }) => t) };
    }
    const tuple = moveTuple(direction, next);
    if (tuple) tuples.push(tuple);
    state = next;
  }
  return { opening, tuples, final: state };
}

/** The slide a replay applies: `slideAndMerge` along each line, as the replay docs say. */
function replaySlide(
  board: number[][],
  direction: Direction
): { board: number[][]; gained: number } {
  const out = board.map((r) => [...r]);
  let gained = 0;
  for (let i = 0; i < SIZE; i++) {
    const line = Array.from({ length: SIZE }, (_, k) =>
      direction === "left" || direction === "right" ? board[i]![k]! : board[k]![i]!
    );
    if (direction === "right" || direction === "down") line.reverse();
    const slid = slideAndMerge(line);
    if (direction === "right" || direction === "down") slid.line.reverse();
    gained += slid.score;
    for (let k = 0; k < SIZE; k++) {
      if (direction === "left" || direction === "right") out[i]![k] = slid.line[k]!;
      else out[k]![i] = slid.line[k]!;
    }
  }
  return { board: out, gained };
}

describe("replay with mergedFrom", () => {
  it.each([1, 2, 3, 4])(
    "seed %i: the opening board plus the recorded tuples rebuild the final board and score",
    (seed) => {
      const { opening, tuples, final } = play(seed, 300, true);
      expect(tuples.length).toBeGreaterThan(50);
      let board = opening;
      let score = 0;
      for (const [dir, cell, value, gained, total] of tuples) {
        const slid = replaySlide(board, DIRECTION_ORDER[dir]!);
        board = slid.board;
        board[Math.floor(cell / SIZE)]![cell % SIZE] = value;
        score += slid.gained;
        expect(slid.gained).toBe(gained);
        expect(score).toBe(total);
      }
      expect(board).toEqual(final.board);
      expect(score).toBe(final.score);
    }
  );

  it("the recorded tuples are the same five numbers, with or without mergedFrom on the tiles", () => {
    const withIt = play(5, 200, true);
    const without = play(5, 200, false);
    expect(withIt.tuples.some((t) => t.length !== 5)).toBe(false);
    expect(JSON.stringify(withIt.tuples)).toBe(JSON.stringify(without.tuples));
    expect(JSON.stringify(withIt.tuples)).not.toContain("mergedFrom");
    expect(withIt.final.board).toEqual(without.final.board);
  });
});

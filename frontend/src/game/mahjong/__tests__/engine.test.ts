/**
 * Mahjong Solitaire engine tests (#891).
 *
 * All tests use a seeded RNG so results are deterministic.
 */

import {
  createGame,
  createSeededRng,
  elapsedMs,
  getAnyFreePair,
  getMatchingFreeTileIds,
  hasFreePairs,
  isFreeTile,
  MAX_SHUFFLES,
  pauseGame,
  resumeGame,
  selectTile,
  setRng,
  shuffleBoard,
  tilesMatch,
  undoMove,
} from "../engine";
import type { MahjongState, SlotTile } from "../types";
import { TURTLE_LAYOUT } from "../layouts/turtle";

// Pin the RNG so every test run is identical.
beforeEach(() => {
  setRng(createSeededRng(42));
});

// ---------------------------------------------------------------------------
// Layout sanity
// ---------------------------------------------------------------------------

describe("TURTLE_LAYOUT", () => {
  it("has exactly 144 slots", () => {
    expect(TURTLE_LAYOUT.length).toBe(144);
  });

  it("has no duplicate positions", () => {
    const keys = TURTLE_LAYOUT.map((s) => `${s.col},${s.row},${s.layer}`);
    expect(new Set(keys).size).toBe(144);
  });

  it("has even slot count per layer", () => {
    const counts: Record<number, number> = {};
    for (const s of TURTLE_LAYOUT) counts[s.layer] = (counts[s.layer] ?? 0) + 1;
    for (const [, count] of Object.entries(counts)) {
      expect(count % 2).toBe(0); // must be even so pairs can fill each layer
    }
  });
});

// ---------------------------------------------------------------------------
// RNG utilities
// ---------------------------------------------------------------------------

describe("createSeededRng", () => {
  it("produces values in [0, 1)", () => {
    const rng = createSeededRng(1);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic for the same seed", () => {
    const rngA = createSeededRng(99);
    const rngB = createSeededRng(99);
    for (let i = 0; i < 20; i++) expect(rngA()).toBe(rngB());
  });

  it("differs for different seeds", () => {
    const a = createSeededRng(1)();
    const b = createSeededRng(2)();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// tilesMatch
// ---------------------------------------------------------------------------

function tile(overrides: Partial<SlotTile> = {}): SlotTile {
  return {
    id: 0,
    suit: "characters",
    rank: 1,
    faceId: 8,
    col: 0,
    row: 0,
    layer: 0,
    ...overrides,
  };
}

describe("tilesMatch", () => {
  it("matches same suit and rank", () => {
    const a = tile({ id: 0, suit: "characters", rank: 3 });
    const b = tile({ id: 1, suit: "characters", rank: 3 });
    expect(tilesMatch(a, b)).toBe(true);
  });

  it("does not match different ranks of same suit", () => {
    const a = tile({ id: 0, rank: 1 });
    const b = tile({ id: 1, rank: 2 });
    expect(tilesMatch(a, b)).toBe(false);
  });

  it("does not match different suits", () => {
    const a = tile({ id: 0, suit: "characters", rank: 1 });
    const b = tile({ id: 1, suit: "circles", rank: 1 });
    expect(tilesMatch(a, b)).toBe(false);
  });

  it("any flower matches any flower", () => {
    const a = tile({ id: 0, suit: "flowers", rank: 1 });
    const b = tile({ id: 1, suit: "flowers", rank: 4 });
    expect(tilesMatch(a, b)).toBe(true);
  });

  it("any season matches any season", () => {
    const a = tile({ id: 0, suit: "seasons", rank: 2 });
    const b = tile({ id: 1, suit: "seasons", rank: 3 });
    expect(tilesMatch(a, b)).toBe(true);
  });

  it("flower does not match season", () => {
    const a = tile({ id: 0, suit: "flowers", rank: 1 });
    const b = tile({ id: 1, suit: "seasons", rank: 1 });
    expect(tilesMatch(a, b)).toBe(false);
  });

  it("a tile does not match itself", () => {
    const a = tile({ id: 5, suit: "flowers", rank: 1 });
    expect(tilesMatch(a, a)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isFreeTile
// ---------------------------------------------------------------------------

describe("isFreeTile", () => {
  it("is free when isolated", () => {
    const t = tile({ id: 0, col: 4, row: 2, layer: 0 });
    expect(isFreeTile(t, [t])).toBe(true);
  });

  it("is free when the only blocker is on one side", () => {
    const t = tile({ id: 0, col: 4, row: 2, layer: 0 });
    const left = tile({ id: 1, col: 2, row: 2, layer: 0 });
    expect(isFreeTile(t, [t, left])).toBe(true);
  });

  it("is blocked when tiles are on both sides", () => {
    const t = tile({ id: 0, col: 4, row: 2, layer: 0 });
    const left = tile({ id: 1, col: 2, row: 2, layer: 0 });
    const right = tile({ id: 2, col: 6, row: 2, layer: 0 });
    expect(isFreeTile(t, [t, left, right])).toBe(false);
  });

  it("is blocked when covered by a tile above at same col/row", () => {
    const t = tile({ id: 0, col: 4, row: 2, layer: 0 });
    const above = tile({ id: 1, col: 4, row: 2, layer: 1 });
    expect(isFreeTile(t, [t, above])).toBe(false);
  });

  it("is not blocked by a tile above at a different col", () => {
    const t = tile({ id: 0, col: 4, row: 2, layer: 0 });
    const other = tile({ id: 1, col: 6, row: 2, layer: 1 });
    expect(isFreeTile(t, [t, other])).toBe(true);
  });

  it("is not blocked by tiles in a different row", () => {
    const t = tile({ id: 0, col: 4, row: 2, layer: 0 });
    const otherRow = tile({ id: 1, col: 2, row: 3, layer: 0 });
    expect(isFreeTile(t, [t, otherRow])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createGame
// ---------------------------------------------------------------------------

describe("createGame", () => {
  it("produces exactly 144 tiles", () => {
    const state = createGame(TURTLE_LAYOUT);
    expect(state.tiles.length).toBe(144);
  });

  it("has unique tile ids 0..143", () => {
    const state = createGame(TURTLE_LAYOUT);
    const ids = state.tiles.map((t) => t.id).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 144 }, (_, i) => i));
  });

  it("has no duplicate positions", () => {
    const state = createGame(TURTLE_LAYOUT);
    const keys = state.tiles.map((t) => `${t.col},${t.row},${t.layer}`);
    expect(new Set(keys).size).toBe(144);
  });

  it("all tile positions are in the layout", () => {
    const state = createGame(TURTLE_LAYOUT);
    const layoutKeys = new Set(TURTLE_LAYOUT.map((s) => `${s.col},${s.row},${s.layer}`));
    for (const t of state.tiles) {
      expect(layoutKeys.has(`${t.col},${t.row},${t.layer}`)).toBe(true);
    }
  });

  it("starts with shufflesLeft = MAX_SHUFFLES", () => {
    const state = createGame(TURTLE_LAYOUT);
    expect(state.shufflesLeft).toBe(MAX_SHUFFLES);
  });

  it("initial board has at least one free pair", () => {
    const state = createGame(TURTLE_LAYOUT);
    expect(hasFreePairs(state.tiles)).toBe(true);
  });

  it("is deterministic for the same seed", () => {
    const s1 = createGame(TURTLE_LAYOUT, 7);
    const s2 = createGame(TURTLE_LAYOUT, 7);
    const ids1 = s1.tiles.map((t) => `${t.faceId}@${t.col},${t.row},${t.layer}`).sort();
    const ids2 = s2.tiles.map((t) => `${t.faceId}@${t.col},${t.row},${t.layer}`).sort();
    expect(ids1).toEqual(ids2);
  });

  it("contains the right tile distribution (faceId counts)", () => {
    const state = createGame(TURTLE_LAYOUT);
    const counts: Record<number, number> = {};
    for (const t of state.tiles) counts[t.faceId] = (counts[t.faceId] ?? 0) + 1;

    // faceId 1–34: 4 copies each (regular tiles)
    for (let fid = 1; fid <= 34; fid++) expect(counts[fid]).toBe(4);
    // faceId 35–42: 1 copy each (seasons 35–38, flowers 39–42)
    for (let fid = 35; fid <= 42; fid++) expect(counts[fid]).toBe(1);
  });

  it("initialises score, pairsRemoved, isComplete, isDeadlocked correctly", () => {
    const state = createGame(TURTLE_LAYOUT);
    expect(state.score).toBe(0);
    expect(state.pairsRemoved).toBe(0);
    expect(state.isComplete).toBe(false);
    expect(state.isDeadlocked).toBe(false);
    expect(state.selected).toBeNull();
    expect(state.undoStack).toHaveLength(0);
    expect(state.startedAt).toBeNull();
    expect(state.accumulatedMs).toBe(0);
  });

  it("includes a dealId of exactly 4 uppercase hex chars", () => {
    const state = createGame(TURTLE_LAYOUT, 1);
    expect(state.dealId).toMatch(/^[0-9A-F]{4}$/);
  });

  it("dealId is deterministic for the same seed", () => {
    expect(createGame(TURTLE_LAYOUT, 7).dealId).toBe(createGame(TURTLE_LAYOUT, 7).dealId);
  });

  it("dealId changes across different seeds", () => {
    const ids = new Set<string>();
    for (let seed = 0; seed < 20; seed++) ids.add(createGame(TURTLE_LAYOUT, seed).dealId);
    expect(ids.size).toBeGreaterThan(15);
  });
});

// ---------------------------------------------------------------------------
// deal variety — secondary face-assignment shuffle (#943)
// ---------------------------------------------------------------------------

describe("deal variety", () => {
  it("100 seeded games produce highly distinct face distributions", () => {
    const dealIds = new Set<string>();
    for (let seed = 0; seed < 100; seed++) dealIds.add(createGame(TURTLE_LAYOUT, seed).dealId);
    expect(dealIds.size).toBeGreaterThanOrEqual(90);
  });

  it("a specific board slot shows varied faces across games (no fixed face→position mapping)", () => {
    const target = TURTLE_LAYOUT[0]!;
    const facesAtSlot = new Set<number>();
    for (let seed = 0; seed < 30; seed++) {
      const state = createGame(TURTLE_LAYOUT, seed);
      const tile = state.tiles.find(
        (t) => t.col === target.col && t.row === target.row && t.layer === target.layer
      );
      if (tile) facesAtSlot.add(tile.faceId);
    }
    expect(facesAtSlot.size).toBeGreaterThan(3);
  });

  it("matched tile pairs are solvable after face-assignment shuffle", () => {
    for (let seed = 0; seed < 100; seed++) {
      expect(hasFreePairs(createGame(TURTLE_LAYOUT, seed).tiles)).toBe(true);
    }
  });

  it("positional tile pairs span multiple rows and layers (not just same-row symmetric)", () => {
    // In the old symmetric algorithm, tiles[2k] and tiles[2k+1] were always in
    // the same row AND same layer. The new random accessible-pair algorithm
    // regularly pairs tiles across rows and layers — this test catches regression.
    const state = createGame(TURTLE_LAYOUT, 0);
    let foundCrossRowOrLayer = false;
    for (let i = 0; i < state.tiles.length - 1; i += 2) {
      const a = state.tiles[i]!;
      const b = state.tiles[i + 1]!;
      if (a.row !== b.row || a.layer !== b.layer) {
        foundCrossRowOrLayer = true;
        break;
      }
    }
    expect(foundCrossRowOrLayer).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// selectTile
// ---------------------------------------------------------------------------

function firstFreePair(state: MahjongState): [SlotTile, SlotTile] {
  const free = state.tiles.filter((t) => isFreeTile(t, state.tiles));
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      if (tilesMatch(free[i]!, free[j]!)) return [free[i]!, free[j]!];
    }
  }
  throw new Error("no free pair found");
}

describe("selectTile", () => {
  it("selects a free tile when none is selected", () => {
    const state = createGame(TURTLE_LAYOUT);
    const free = state.tiles.find((t) => isFreeTile(t, state.tiles))!;
    const next = selectTile(state, free.id);
    expect(next.selected?.id).toBe(free.id);
  });

  it("deselects when tapping the same tile again", () => {
    const state = createGame(TURTLE_LAYOUT);
    const free = state.tiles.find((t) => isFreeTile(t, state.tiles))!;
    const withSel = selectTile(state, free.id);
    const desel = selectTile(withSel, free.id);
    expect(desel.selected).toBeNull();
  });

  it("replaces selection when a non-matching tile is chosen", () => {
    const state = createGame(TURTLE_LAYOUT);
    const free = state.tiles.filter((t) => isFreeTile(t, state.tiles));
    // Find two free tiles that do NOT match
    let a!: SlotTile, b!: SlotTile;
    outer: for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        if (!tilesMatch(free[i]!, free[j]!)) {
          a = free[i]!;
          b = free[j]!;
          break outer;
        }
      }
    }
    const s1 = selectTile(state, a.id);
    const s2 = selectTile(s1, b.id);
    expect(s2.selected?.id).toBe(b.id);
    expect(s2.tiles.length).toBe(144); // nothing removed
  });

  it("removes matched pair and increments score", () => {
    const state = createGame(TURTLE_LAYOUT);
    const [a, b] = firstFreePair(state);
    const s1 = selectTile(state, a.id);
    const s2 = selectTile(s1, b.id);
    expect(s2.tiles.length).toBe(142);
    expect(s2.pairsRemoved).toBe(1);
    expect(s2.score).toBe(10);
    expect(s2.selected).toBeNull();
  });

  it("pushes state to undoStack on a match", () => {
    const state = createGame(TURTLE_LAYOUT);
    const [a, b] = firstFreePair(state);
    const s1 = selectTile(state, a.id);
    const s2 = selectTile(s1, b.id);
    expect(s2.undoStack.length).toBe(1);
  });

  it("sets startedAt on first selection", () => {
    const state = createGame(TURTLE_LAYOUT);
    expect(state.startedAt).toBeNull();
    const free = state.tiles.find((t) => isFreeTile(t, state.tiles))!;
    const next = selectTile(state, free.id);
    expect(next.startedAt).not.toBeNull();
  });

  it("ignores a non-free tile", () => {
    const state = createGame(TURTLE_LAYOUT);
    // A tile covered by another tile is not free; find one.
    const covered = state.tiles.find((t) => !isFreeTile(t, state.tiles));
    if (!covered) return; // edge case: all tiles are free (very unlikely layout)
    const next = selectTile(state, covered.id);
    expect(next).toBe(state);
  });

  it("awards completion bonus when last pair is removed", () => {
    // Directly construct a minimal 2-tile state (1 pair).
    const a: SlotTile = { id: 0, suit: "characters", rank: 1, faceId: 8, col: 0, row: 0, layer: 0 };
    const b: SlotTile = { id: 1, suit: "characters", rank: 1, faceId: 8, col: 2, row: 0, layer: 0 };
    const state: MahjongState = {
      _v: 1,
      tiles: [a, b],
      pairsRemoved: 0,
      score: 0,
      shufflesLeft: 3,
      selected: null,
      undoStack: [],
      isComplete: false,
      isDeadlocked: false,
      startedAt: null,
      accumulatedMs: 0,
      dealId: "TEST",
    };
    const s1 = selectTile(state, a.id);
    const s2 = selectTile(s1, b.id);
    expect(s2.isComplete).toBe(true);
    expect(s2.score).toBe(10 + 500); // SCORE_PER_PAIR + SCORE_COMPLETE_BONUS
    expect(s2.tiles.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// undoMove
// ---------------------------------------------------------------------------

describe("undoMove", () => {
  it("restores the previous state after a match", () => {
    const state = createGame(TURTLE_LAYOUT);
    const [a, b] = firstFreePair(state);
    const s1 = selectTile(state, a.id);
    const s2 = selectTile(s1, b.id);
    expect(s2.tiles.length).toBe(142);

    const reverted = undoMove(s2);
    expect(reverted.tiles.length).toBe(144);
    expect(reverted.pairsRemoved).toBe(0);
    expect(reverted.score).toBe(0);
    expect(reverted.selected).toBeNull();
  });

  it("returns the same state when undoStack is empty", () => {
    const state = createGame(TURTLE_LAYOUT);
    expect(undoMove(state)).toBe(state);
  });

  it("supports multiple undos", () => {
    let state = createGame(TURTLE_LAYOUT);
    for (let i = 0; i < 3; i++) {
      const [a, b] = firstFreePair(state);
      state = selectTile(selectTile(state, a.id), b.id);
    }
    expect(state.pairsRemoved).toBe(3);

    state = undoMove(state);
    expect(state.pairsRemoved).toBe(2);
    state = undoMove(state);
    expect(state.pairsRemoved).toBe(1);
    state = undoMove(state);
    expect(state.pairsRemoved).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// shuffleBoard
// ---------------------------------------------------------------------------

describe("shuffleBoard", () => {
  it("decrements shufflesLeft", () => {
    const state = createGame(TURTLE_LAYOUT);
    const shuffled = shuffleBoard(state);
    expect(shuffled.shufflesLeft).toBe(MAX_SHUFFLES - 1);
  });

  it("keeps the same tile count", () => {
    const state = createGame(TURTLE_LAYOUT);
    const shuffled = shuffleBoard(state);
    expect(shuffled.tiles.length).toBe(144);
  });

  it("preserves the same tile distribution (same faceId counts)", () => {
    const state = createGame(TURTLE_LAYOUT);
    const shuffled = shuffleBoard(state);
    const countBefore: Record<number, number> = {};
    const countAfter: Record<number, number> = {};
    for (const t of state.tiles) countBefore[t.faceId] = (countBefore[t.faceId] ?? 0) + 1;
    for (const t of shuffled.tiles) countAfter[t.faceId] = (countAfter[t.faceId] ?? 0) + 1;
    expect(countAfter).toEqual(countBefore);
  });

  it("produces a board with at least one free pair", () => {
    const state = createGame(TURTLE_LAYOUT);
    const shuffled = shuffleBoard(state);
    expect(hasFreePairs(shuffled.tiles)).toBe(true);
  });

  it("clears the selection", () => {
    let state = createGame(TURTLE_LAYOUT);
    const free = state.tiles.find((t) => isFreeTile(t, state.tiles))!;
    state = selectTile(state, free.id);
    expect(state.selected).not.toBeNull();
    expect(shuffleBoard(state).selected).toBeNull();
  });

  it("does nothing when shufflesLeft is 0", () => {
    let state = createGame(TURTLE_LAYOUT);
    state = { ...state, shufflesLeft: 0 };
    expect(shuffleBoard(state)).toBe(state);
  });

  it("pushes a snapshot to undoStack", () => {
    const state = createGame(TURTLE_LAYOUT);
    const shuffled = shuffleBoard(state);
    expect(shuffled.undoStack.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// hasFreePairs
// ---------------------------------------------------------------------------

describe("getMatchingFreeTileIds", () => {
  const base: Omit<MahjongState, "tiles" | "selected"> = {
    ...createGame(TURTLE_LAYOUT),
    tiles: [],
    selected: null,
  };

  it("returns an empty set when nothing is selected", () => {
    const a: SlotTile = { id: 0, suit: "characters", rank: 1, faceId: 8, col: 0, row: 0, layer: 0 };
    const state: MahjongState = { ...base, tiles: [a], selected: null };
    expect(getMatchingFreeTileIds(state).size).toBe(0);
  });

  it("returns IDs of free matching tiles when a tile is selected", () => {
    const sel: SlotTile = {
      id: 0,
      suit: "characters",
      rank: 1,
      faceId: 8,
      col: 0,
      row: 0,
      layer: 0,
    };
    const match: SlotTile = {
      id: 1,
      suit: "characters",
      rank: 1,
      faceId: 8,
      col: 4,
      row: 0,
      layer: 0,
    };
    const other: SlotTile = {
      id: 2,
      suit: "circles",
      rank: 2,
      faceId: 18,
      col: 6,
      row: 0,
      layer: 0,
    };
    const state: MahjongState = { ...base, tiles: [sel, match, other], selected: sel };
    const result = getMatchingFreeTileIds(state);
    expect(result.has(match.id)).toBe(true);
    expect(result.has(sel.id)).toBe(false); // selected tile excluded
    expect(result.has(other.id)).toBe(false); // non-matching excluded
  });

  it("excludes blocked tiles even if they match", () => {
    const sel: SlotTile = {
      id: 0,
      suit: "characters",
      rank: 1,
      faceId: 8,
      col: 0,
      row: 0,
      layer: 0,
    };
    const match: SlotTile = {
      id: 1,
      suit: "characters",
      rank: 1,
      faceId: 8,
      col: 4,
      row: 0,
      layer: 0,
    };
    // Blocker sits on top of match — same col/row, layer+1.
    const blocker: SlotTile = {
      id: 2,
      suit: "dragons",
      rank: 1,
      faceId: 1,
      col: 4,
      row: 0,
      layer: 1,
    };
    const state: MahjongState = { ...base, tiles: [sel, match, blocker], selected: sel };
    const result = getMatchingFreeTileIds(state);
    expect(result.has(match.id)).toBe(false);
  });

  it("matches flower suit tiles regardless of rank", () => {
    const sel: SlotTile = { id: 0, suit: "flowers", rank: 1, faceId: 35, col: 0, row: 0, layer: 0 };
    const match: SlotTile = {
      id: 1,
      suit: "flowers",
      rank: 2,
      faceId: 36,
      col: 4,
      row: 0,
      layer: 0,
    };
    const state: MahjongState = { ...base, tiles: [sel, match], selected: sel };
    expect(getMatchingFreeTileIds(state).has(match.id)).toBe(true);
  });

  it("matches season suit tiles regardless of rank", () => {
    const sel: SlotTile = { id: 0, suit: "seasons", rank: 1, faceId: 39, col: 0, row: 0, layer: 0 };
    const match: SlotTile = {
      id: 1,
      suit: "seasons",
      rank: 3,
      faceId: 41,
      col: 4,
      row: 0,
      layer: 0,
    };
    const state: MahjongState = { ...base, tiles: [sel, match], selected: sel };
    expect(getMatchingFreeTileIds(state).has(match.id)).toBe(true);
  });

  it("clears on deselect (selected = null)", () => {
    const a: SlotTile = { id: 0, suit: "characters", rank: 1, faceId: 8, col: 0, row: 0, layer: 0 };
    const b: SlotTile = { id: 1, suit: "characters", rank: 1, faceId: 8, col: 4, row: 0, layer: 0 };
    const withSel: MahjongState = { ...base, tiles: [a, b], selected: a };
    const deselected: MahjongState = { ...withSel, selected: null };
    expect(getMatchingFreeTileIds(withSel).size).toBe(1);
    expect(getMatchingFreeTileIds(deselected).size).toBe(0);
  });
});

describe("hasFreePairs", () => {
  it("returns false for an empty board", () => {
    expect(hasFreePairs([])).toBe(false);
  });

  it("returns true when a matching free pair exists", () => {
    const a: SlotTile = { id: 0, suit: "characters", rank: 1, faceId: 8, col: 0, row: 0, layer: 0 };
    const b: SlotTile = { id: 1, suit: "characters", rank: 1, faceId: 8, col: 2, row: 0, layer: 0 };
    expect(hasFreePairs([a, b])).toBe(true);
  });

  it("returns false when no matching pair among free tiles", () => {
    const a: SlotTile = { id: 0, suit: "characters", rank: 1, faceId: 8, col: 0, row: 0, layer: 0 };
    const b: SlotTile = { id: 1, suit: "circles", rank: 2, faceId: 18, col: 2, row: 0, layer: 0 };
    expect(hasFreePairs([a, b])).toBe(false);
  });

  it("returns false when the only matching pair is blocked", () => {
    // Tile a is at layer 0 but covered by tile c at layer 1 same position.
    const a: SlotTile = { id: 0, suit: "characters", rank: 1, faceId: 8, col: 0, row: 0, layer: 0 };
    const b: SlotTile = { id: 1, suit: "characters", rank: 1, faceId: 8, col: 2, row: 0, layer: 0 };
    const c: SlotTile = { id: 2, suit: "dragons", rank: 1, faceId: 1, col: 0, row: 0, layer: 1 };
    // a is covered by c, b is free. But the pair (a,b) can't form since a is not free.
    expect(hasFreePairs([a, b, c])).toBe(false);
  });
});

describe("getAnyFreePair", () => {
  it("returns null for an empty board", () => {
    expect(getAnyFreePair([])).toBeNull();
  });

  it("returns the two IDs when a matching free pair exists", () => {
    const a: SlotTile = { id: 0, suit: "characters", rank: 1, faceId: 8, col: 0, row: 0, layer: 0 };
    const b: SlotTile = { id: 1, suit: "characters", rank: 1, faceId: 8, col: 2, row: 0, layer: 0 };
    const result = getAnyFreePair([a, b]);
    expect(result).not.toBeNull();
    expect(result!.sort()).toEqual([0, 1]);
  });

  it("returns null when no matching free pair exists", () => {
    const a: SlotTile = { id: 0, suit: "characters", rank: 1, faceId: 8, col: 0, row: 0, layer: 0 };
    const b: SlotTile = { id: 1, suit: "circles", rank: 2, faceId: 18, col: 2, row: 0, layer: 0 };
    expect(getAnyFreePair([a, b])).toBeNull();
  });

  it("returns null when the only matching pair is blocked", () => {
    const a: SlotTile = { id: 0, suit: "characters", rank: 1, faceId: 8, col: 0, row: 0, layer: 0 };
    const b: SlotTile = { id: 1, suit: "characters", rank: 1, faceId: 8, col: 2, row: 0, layer: 0 };
    const c: SlotTile = { id: 2, suit: "dragons", rank: 1, faceId: 1, col: 0, row: 0, layer: 1 };
    expect(getAnyFreePair([a, b, c])).toBeNull();
  });

  it("returns flower IDs for a matching flower pair", () => {
    const a: SlotTile = { id: 10, suit: "flowers", rank: 1, faceId: 37, col: 0, row: 0, layer: 0 };
    const b: SlotTile = { id: 11, suit: "flowers", rank: 2, faceId: 38, col: 2, row: 0, layer: 0 };
    const result = getAnyFreePair([a, b]);
    expect(result).not.toBeNull();
    expect(result!.sort()).toEqual([10, 11]);
  });
});

// ---------------------------------------------------------------------------
// elapsedMs, pauseGame, resumeGame
// ---------------------------------------------------------------------------

describe("timer helpers", () => {
  it("elapsedMs returns accumulatedMs when startedAt is null", () => {
    const state = createGame(TURTLE_LAYOUT);
    expect(elapsedMs(state, 9999)).toBe(0);
  });

  it("elapsedMs counts from startedAt", () => {
    const state: MahjongState = {
      ...createGame(TURTLE_LAYOUT),
      startedAt: 1000,
      accumulatedMs: 500,
    };
    expect(elapsedMs(state, 2000)).toBe(1500);
  });

  it("pauseGame accumulates time and clears startedAt", () => {
    const state: MahjongState = {
      ...createGame(TURTLE_LAYOUT),
      startedAt: 1000,
      accumulatedMs: 200,
    };
    const paused = pauseGame(state, 1600);
    expect(paused.startedAt).toBeNull();
    expect(paused.accumulatedMs).toBe(800);
  });

  it("resumeGame sets startedAt", () => {
    const state = createGame(TURTLE_LAYOUT);
    const resumed = resumeGame(state, 5000);
    expect(resumed.startedAt).toBe(5000);
  });

  it("resumeGame is a no-op when already running", () => {
    const state: MahjongState = { ...createGame(TURTLE_LAYOUT), startedAt: 1000 };
    expect(resumeGame(state, 2000).startedAt).toBe(1000);
  });
});

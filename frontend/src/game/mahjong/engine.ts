/**
 * Mahjong Solitaire engine (#891).
 *
 * Pure TypeScript. No React, AsyncStorage, HTTP, timers, or other side-effect
 * imports. The UI replaces the entire MahjongState on each transition.
 *
 * Solvability is guaranteed via a backwards-build algorithm: pairs are placed
 * into free slots in a random order, so removing them in reverse is always
 * valid. Tests can pin the shuffle via `setRng(createSeededRng(seed))`.
 */

import type { Layout, MahjongState, Slot, SlotTile, Suit, Rank } from "./types";

// ---------------------------------------------------------------------------
// Scoring / limits
// ---------------------------------------------------------------------------

const SCORE_PER_PAIR = 10;
const SCORE_COMPLETE_BONUS = 500;
const UNDO_CAP = 50;
export const MAX_SHUFFLES = 3;

// ---------------------------------------------------------------------------
// Seedable RNG — LCG matching Cascade / Blackjack / Twenty48 / Solitaire.
// ---------------------------------------------------------------------------

export type RandomSource = () => number;

let _rng: RandomSource = Math.random;

export function setRng(fn: RandomSource): void {
  _rng = fn;
}

export function createSeededRng(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Tile matching
// ---------------------------------------------------------------------------

/**
 * Two tiles match if they are the same suit+rank, OR both are flowers (any
 * flower matches any flower), OR both are seasons (any season matches any
 * season). A tile never matches itself.
 */
export function tilesMatch(a: SlotTile, b: SlotTile): boolean {
  if (a.id === b.id) return false;
  if (a.suit === "flowers" && b.suit === "flowers") return true;
  if (a.suit === "seasons" && b.suit === "seasons") return true;
  return a.suit === b.suit && a.rank === b.rank;
}

// ---------------------------------------------------------------------------
// Free-tile detection
// ---------------------------------------------------------------------------

/**
 * A tile is FREE (selectable) if:
 *   (a) no tile at layer+1 shares the exact same (col, row) — nothing above it, and
 *   (b) at least one horizontal side is clear — no tile at (col−2, row, layer)
 *       or no tile at (col+2, row, layer).
 *
 * Tiles are 2 grid units wide, so adjacent tiles step by ±2 in col.
 */
export function isFreeTile(tile: SlotTile, tiles: readonly SlotTile[]): boolean {
  for (const t of tiles) {
    if (t.id === tile.id) continue;
    if (t.layer === tile.layer + 1 && t.col === tile.col && t.row === tile.row) return false;
  }

  let leftBlocked = false;
  let rightBlocked = false;
  for (const t of tiles) {
    if (t.id === tile.id || t.layer !== tile.layer || t.row !== tile.row) continue;
    if (t.col === tile.col - 2) leftBlocked = true;
    if (t.col === tile.col + 2) rightBlocked = true;
    if (leftBlocked && rightBlocked) return false;
  }
  return true;
}

/**
 * Returns the IDs of all free tiles that match the currently selected tile.
 * Returns an empty set when nothing is selected.
 * O(n) over free tiles — call once per state change, not per frame.
 */
export function getMatchingFreeTileIds(state: MahjongState): ReadonlySet<number> {
  if (!state.selected) return new Set();
  const selected = state.selected;
  const ids = new Set<number>();
  for (const tile of state.tiles) {
    if (tile.id !== selected.id && isFreeTile(tile, state.tiles) && tilesMatch(tile, selected)) {
      ids.add(tile.id);
    }
  }
  return ids;
}

/** Returns true if any two free tiles in `tiles` form a matching pair. */
export function hasFreePairs(tiles: readonly SlotTile[]): boolean {
  const free = tiles.filter((t) => isFreeTile(t, tiles));
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      if (tilesMatch(free[i]!, free[j]!)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Elapsed time helper
// ---------------------------------------------------------------------------

export function elapsedMs(state: MahjongState, now: number = Date.now()): number {
  if (state.startedAt === null) return state.accumulatedMs;
  return state.accumulatedMs + (now - state.startedAt);
}

// ---------------------------------------------------------------------------
// Tile-set construction — 144 tiles = 72 pairs
// ---------------------------------------------------------------------------

type TileSpec = { suit: Suit; rank: Rank; faceId: number };

function buildFullTileSet(): TileSpec[] {
  const tiles: TileSpec[] = [];

  // Dragons 1–3 (faceId 1–3), 4 copies each
  for (let rank = 1; rank <= 3; rank++) {
    for (let c = 0; c < 4; c++) tiles.push({ suit: "dragons", rank: rank as Rank, faceId: rank });
  }

  // Winds 1–4 (faceId 4–7), 4 copies each
  for (let rank = 1; rank <= 4; rank++) {
    for (let c = 0; c < 4; c++) tiles.push({ suit: "winds", rank: rank as Rank, faceId: rank + 3 });
  }

  // Characters 1–9 (faceId 8–16), 4 copies each
  for (let rank = 1; rank <= 9; rank++) {
    for (let c = 0; c < 4; c++)
      tiles.push({ suit: "characters", rank: rank as Rank, faceId: rank + 7 });
  }

  // Circles 1–9 (faceId 17–25), 4 copies each
  for (let rank = 1; rank <= 9; rank++) {
    for (let c = 0; c < 4; c++)
      tiles.push({ suit: "circles", rank: rank as Rank, faceId: rank + 16 });
  }

  // Bamboos 1–9 (faceId 26–34), 4 copies each
  for (let rank = 1; rank <= 9; rank++) {
    for (let c = 0; c < 4; c++)
      tiles.push({ suit: "bamboos", rank: rank as Rank, faceId: rank + 25 });
  }

  // Seasons 1–4 (faceId 35–38), 1 copy each (any season ↔ any season)
  for (let rank = 1; rank <= 4; rank++) {
    tiles.push({ suit: "seasons", rank: rank as Rank, faceId: rank + 34 });
  }

  // Flowers 1–4 (faceId 39–42), 1 copy each (any flower ↔ any flower)
  for (let rank = 1; rank <= 4; rank++) {
    tiles.push({ suit: "flowers", rank: rank as Rank, faceId: rank + 38 });
  }

  return tiles; // 12 + 16 + 36 + 36 + 36 + 4 + 4 = 144
}

/** Group tile specs into matching pairs. Works for both the full 144-set and
 *  any even-count subset remaining after partial play. */
function buildPairs(specs: TileSpec[]): [TileSpec, TileSpec][] {
  const pairs: [TileSpec, TileSpec][] = [];
  const flowers: TileSpec[] = [];
  const seasons: TileSpec[] = [];
  const byKey = new Map<string, TileSpec[]>();

  for (const spec of specs) {
    if (spec.suit === "flowers") {
      flowers.push(spec);
    } else if (spec.suit === "seasons") {
      seasons.push(spec);
    } else {
      const key = `${spec.suit}:${spec.rank}`;
      const g = byKey.get(key) ?? [];
      g.push(spec);
      byKey.set(key, g);
    }
  }

  for (const g of byKey.values()) {
    for (let i = 0; i + 1 < g.length; i += 2) pairs.push([g[i]!, g[i + 1]!]);
  }
  for (let i = 0; i + 1 < flowers.length; i += 2) pairs.push([flowers[i]!, flowers[i + 1]!]);
  for (let i = 0; i + 1 < seasons.length; i += 2) pairs.push([seasons[i]!, seasons[i + 1]!]);

  return pairs;
}

// ---------------------------------------------------------------------------
// Backwards-build algorithm — guarantees solvability
// ---------------------------------------------------------------------------

function fisherYates<T>(arr: T[], rng: RandomSource): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a !== undefined && b !== undefined) {
      arr[i] = b;
      arr[j] = a;
    }
  }
  return arr;
}

/**
 * Returns the indices (into `slots`) that are accessible given the current
 * unplaced set — i.e., nothing above them and at least one open horizontal
 * side. Mirrors the logic of `isFreeTile` but operates on the unplaced pool
 * rather than the live tile list.
 */
function accessibleInUnplaced(slots: readonly Slot[], unplaced: Set<number>): number[] {
  const accessible: number[] = [];
  for (const i of unplaced) {
    const s = slots[i]!;

    let hasAbove = false;
    for (const j of unplaced) {
      if (
        j !== i &&
        slots[j]!.layer === s.layer + 1 &&
        slots[j]!.col === s.col &&
        slots[j]!.row === s.row
      ) {
        hasAbove = true;
        break;
      }
    }
    if (hasAbove) continue;

    let leftBlocked = false;
    let rightBlocked = false;
    for (const j of unplaced) {
      if (j === i) continue;
      const s2 = slots[j]!;
      if (s2.layer !== s.layer || s2.row !== s.row) continue;
      if (s2.col === s.col - 2) leftBlocked = true;
      if (s2.col === s.col + 2) rightBlocked = true;
      if (leftBlocked && rightBlocked) break;
    }
    if (!(leftBlocked && rightBlocked)) accessible.push(i);
  }
  return accessible;
}

/**
 * One attempt at the random accessible-pair backwards-build. Picks any two
 * simultaneously accessible positions from the unplaced pool and assigns them
 * a face-pair, guaranteeing the resulting board is solvable by construction.
 * Returns null if the pool reaches a dead end (< 2 accessible positions while
 * tiles remain), which happens in < 1 % of deals on the turtle layout.
 */
function tryBuildBoard(
  slots: readonly Slot[],
  pairs: [TileSpec, TileSpec][],
  rng: RandomSource,
  startId: number
): SlotTile[] | null {
  const shuffledPairs = fisherYates([...pairs], rng);
  const unplaced = new Set<number>(slots.map((_, i) => i));
  const result: SlotTile[] = [];
  let pairIdx = 0;
  let nextId = startId;

  while (unplaced.size > 0) {
    const accessible = accessibleInUnplaced(slots, unplaced);
    if (accessible.length < 2) return null;

    fisherYates(accessible, rng);
    const idxA = accessible[0]!;
    const idxB = accessible[1]!;
    const pair = shuffledPairs[pairIdx++]!;
    const slotA = slots[idxA]!;
    const slotB = slots[idxB]!;

    result.push(
      { ...pair[0], id: nextId++, col: slotA.col, row: slotA.row, layer: slotA.layer },
      { ...pair[1], id: nextId++, col: slotB.col, row: slotB.row, layer: slotB.layer }
    );
    unplaced.delete(idxA);
    unplaced.delete(idxB);
  }
  return result;
}

/**
 * Deterministic symmetric fallback — layer-by-layer, row-by-row,
 * inner-to-outer pairing. Guaranteed to succeed on any layout where every
 * row in every layer has an even slot count. Used only when all random
 * attempts dead-end (probability ≈ 0.01^50).
 */
function buildBoardLegacy(
  slots: readonly Slot[],
  pairs: [TileSpec, TileSpec][],
  rng: RandomSource,
  startId: number
): SlotTile[] {
  const shuffledPairs = fisherYates([...pairs], rng);
  let pairIdx = 0;
  const result: SlotTile[] = [];
  let nextId = startId;

  const maxLayer = slots.reduce((m, s) => Math.max(m, s.layer), 0);

  for (let layer = 0; layer <= maxLayer; layer++) {
    const layerSlots = slots.filter((s) => s.layer === layer);

    const byRow = new Map<number, Slot[]>();
    for (const s of layerSlots) {
      const arr = byRow.get(s.row) ?? [];
      arr.push(s);
      byRow.set(s.row, arr);
    }
    const rowList = fisherYates([...byRow.values()], rng);

    for (const rowSlots of rowList) {
      rowSlots.sort((a, b) => a.col - b.col);
      const N = rowSlots.length;
      for (let i = N / 2 - 1; i >= 0; i--) {
        const slotA = rowSlots[i]!;
        const slotB = rowSlots[N - 1 - i]!;
        const pair = shuffledPairs[pairIdx++]!;
        result.push(
          { ...pair[0], id: nextId++, col: slotA.col, row: slotA.row, layer: slotA.layer },
          { ...pair[1], id: nextId++, col: slotB.col, row: slotB.row, layer: slotB.layer }
        );
      }
    }
  }
  return result;
}

/**
 * Builds a solvable board by randomly pairing accessible positions.
 * Retries up to 50 times on dead ends; falls back to the legacy symmetric
 * algorithm if all retries fail (essentially impossible in practice).
 */
function buildBoard(
  slots: readonly Slot[],
  pairs: [TileSpec, TileSpec][],
  rng: RandomSource,
  startId = 0
): SlotTile[] {
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = tryBuildBoard(slots, pairs, rng, startId);
    if (result !== null) return result;
  }
  return buildBoardLegacy(slots, pairs, rng, startId);
}

// ---------------------------------------------------------------------------
// Post-deal face-assignment shuffle — breaks visual symmetry
// ---------------------------------------------------------------------------

/**
 * After buildBoard, tiles are emitted in positional pairs: (0,1), (2,3), …
 * The backwards-build assigns the same face-pair to both slots in each
 * positional pair, which means symmetric slot positions always show the same
 * face — causing a visually regular pattern across games.
 *
 * This shuffles which face-pair is assigned to which positional pair (keeping
 * each positional pair's two tiles mutually matching) so that specific faces
 * are no longer correlated with specific board positions.
 *
 * Solvability is preserved: the positional pairings that guarantee removability
 * are unchanged; only which face-type goes to each pair changes.
 */
function shuffleFaceAssignments(tiles: SlotTile[], rng: RandomSource): SlotTile[] {
  type FaceData = Pick<TileSpec, "suit" | "rank" | "faceId">;
  const facePairs: [FaceData, FaceData][] = [];
  for (let i = 0; i < tiles.length; i += 2) {
    facePairs.push([
      { suit: tiles[i]!.suit, rank: tiles[i]!.rank, faceId: tiles[i]!.faceId },
      { suit: tiles[i + 1]!.suit, rank: tiles[i + 1]!.rank, faceId: tiles[i + 1]!.faceId },
    ]);
  }
  fisherYates(facePairs, rng);
  const result = [...tiles];
  for (let i = 0; i < facePairs.length; i++) {
    const [a, b] = facePairs[i]!;
    result[2 * i] = { ...tiles[2 * i]!, ...a };
    result[2 * i + 1] = { ...tiles[2 * i + 1]!, ...b };
  }
  return result;
}

/** FNV-1a (32-bit) hash of the tile faceId sequence → 4 uppercase hex chars. */
function computeDealId(tiles: readonly SlotTile[]): string {
  let h = 2166136261; // FNV-1a offset basis
  for (const tile of tiles) {
    h = Math.imul(h ^ tile.faceId, 16777619) >>> 0;
  }
  return h.toString(16).toUpperCase().padStart(8, "0").slice(0, 4);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Deal a fresh solvable game using the supplied layout. */
export function createGame(layout: Layout, seed?: number): MahjongState {
  const rng = seed !== undefined ? createSeededRng(seed) : _rng;
  const specs = buildFullTileSet();
  const pairs = buildPairs(specs);
  const tiles = shuffleFaceAssignments(buildBoard(layout, pairs, rng), rng);
  const dealId = computeDealId(tiles);

  return {
    _v: 1,
    tiles,
    dealId,
    pairsRemoved: 0,
    score: 0,
    shufflesLeft: MAX_SHUFFLES,
    selected: null,
    undoStack: [],
    isComplete: false,
    isDeadlocked: false,
    startedAt: null,
    accumulatedMs: 0,
  };
}

/**
 * Select or deselect a tile.
 *
 * - If the tile is not free, the state is returned unchanged.
 * - If no tile is selected, the tile becomes selected.
 * - If the same tile is tapped again, it is deselected.
 * - If a different tile is selected and they match, both are removed.
 * - If a different tile is selected and they don't match, the new tile
 *   becomes selected (replacing the old selection).
 */
export function selectTile(state: MahjongState, tileId: number): MahjongState {
  const tile = state.tiles.find((t) => t.id === tileId);
  if (!tile || !isFreeTile(tile, state.tiles)) return state;

  const startedAt = state.startedAt ?? Date.now();

  if (!state.selected) {
    return { ...state, selected: tile, startedAt };
  }

  if (state.selected.id === tile.id) {
    return { ...state, selected: null };
  }

  if (!tilesMatch(state.selected, tile)) {
    return { ...state, selected: tile, startedAt };
  }

  // Matched pair — remove both tiles.
  const removedA = state.selected;
  const newTiles = state.tiles.filter((t) => t.id !== removedA.id && t.id !== tile.id);
  const pairsRemoved = state.pairsRemoved + 1;
  const isComplete = newTiles.length === 0;
  const score = state.score + SCORE_PER_PAIR + (isComplete ? SCORE_COMPLETE_BONUS : 0);
  const isDeadlocked = !isComplete && !hasFreePairs(newTiles) && state.shufflesLeft === 0;

  const snapshot: MahjongState = { ...state, selected: null, undoStack: [] };
  const undoStack = [...state.undoStack.slice(-(UNDO_CAP - 1)), snapshot];

  return {
    ...state,
    tiles: newTiles,
    pairsRemoved,
    score,
    selected: null,
    undoStack,
    isComplete,
    isDeadlocked,
    startedAt,
  };
}

/**
 * Redistribute all remaining tiles across their current slots in a new
 * arrangement that has at least one playable free pair. Costs one shuffle
 * token. Clears the selection.
 *
 * After partial play, rows can have odd tile counts so the inner-to-outer
 * row approach used by createGame won't work. Instead we randomly reassign
 * tile types to slots and retry until hasFreePairs returns true (≤ 50 tries,
 * practically never exhausted).
 */
export function shuffleBoard(state: MahjongState): MahjongState {
  if (state.shufflesLeft === 0) return state;

  const slots: Slot[] = state.tiles.map(({ col, row, layer }) => ({ col, row, layer }));
  const specs: TileSpec[] = state.tiles.map(({ suit, rank, faceId }) => ({ suit, rank, faceId }));
  const pairs = buildPairs(specs);

  let newTiles: SlotTile[] = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    const shuffledPairs = fisherYates([...pairs], _rng);
    const shuffledSlots = fisherYates([...slots], _rng);
    const candidate: SlotTile[] = [];
    let id = 0;
    for (let i = 0; i < shuffledPairs.length; i++) {
      const pair = shuffledPairs[i]!;
      const sA = shuffledSlots[i * 2]!;
      const sB = shuffledSlots[i * 2 + 1]!;
      candidate.push({ ...pair[0], id: id++, col: sA.col, row: sA.row, layer: sA.layer });
      candidate.push({ ...pair[1], id: id++, col: sB.col, row: sB.row, layer: sB.layer });
    }
    if (hasFreePairs(candidate)) {
      newTiles = candidate;
      break;
    }
  }
  if (newTiles.length === 0) return state; // extremely unlikely

  const isDeadlocked = !hasFreePairs(newTiles) && state.shufflesLeft - 1 === 0;

  const snapshot: MahjongState = { ...state, undoStack: [] };
  const undoStack = [...state.undoStack.slice(-(UNDO_CAP - 1)), snapshot];

  return {
    ...state,
    tiles: newTiles,
    selected: null,
    shufflesLeft: state.shufflesLeft - 1,
    undoStack,
    isDeadlocked,
  };
}

/** Undo the last pair removal or shuffle. */
export function undoMove(state: MahjongState): MahjongState {
  if (state.undoStack.length === 0) return state;
  const prev = state.undoStack[state.undoStack.length - 1]!;
  // Restore the snapshot but give it the remaining undo history so that
  // further undos can continue to chain without exponential nesting.
  return { ...prev, undoStack: state.undoStack.slice(0, -1) };
}

/** Accumulate elapsed time when the session is paused (app goes to background). */
export function pauseGame(state: MahjongState, now: number = Date.now()): MahjongState {
  if (state.startedAt === null) return state;
  return {
    ...state,
    accumulatedMs: state.accumulatedMs + (now - state.startedAt),
    startedAt: null,
  };
}

/** Resume the timer when the app returns to the foreground. */
export function resumeGame(state: MahjongState, now: number = Date.now()): MahjongState {
  if (state.startedAt !== null || state.isComplete) return state;
  return { ...state, startedAt: now };
}

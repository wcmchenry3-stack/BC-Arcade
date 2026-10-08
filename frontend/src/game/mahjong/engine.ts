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

import { bestOf } from "../_shared/bestOf";
import { createRngSlot, createSeededRng, type RandomSource } from "../_shared/seededRng";
import { pushCapped } from "../_shared/undoStack";
import type {
  Layout,
  MahjongEvent,
  MahjongState,
  MahjongUndoEntry,
  RemovedTile,
  Slot,
  SlotTile,
  Suit,
  Rank,
} from "./types";
import {
  clockElapsedMs,
  pauseClock,
  resumeClock,
  startClockOnMove,
  stopClock,
  withClock,
} from "../_shared/playClock";

// ---------------------------------------------------------------------------
// Scoring / limits
// ---------------------------------------------------------------------------

const SCORE_PER_PAIR = 10;
const SCORE_COMPLETE_BONUS = 500;

/**
 * Fastest clear that ranks, in ms (#2747): half a second per pair over 72
 * pairs. Mirrors `MIN_CLEAR_MS` in `backend/mahjong/models.py` (the board's
 * `min_value`); `backend/tests/test_board_definitions.py` keeps them equal.
 * A faster clear is a broken clock (e.g. an old save resumed with no time
 * banked), so it is never a device best either.
 */
export const MAHJONG_MIN_CLEAR_MS = 36000;

/** A stored device best time, or 0 ("no best yet") when it is below the floor. */
export function plausibleBestMs(ms: number): number {
  return Number.isFinite(ms) && ms >= MAHJONG_MIN_CLEAR_MS ? ms : 0;
}

/**
 * The device best after a clear taking `finalMs`: fastest wins, and a clear
 * below `MAHJONG_MIN_CLEAR_MS` neither counts nor is a new best. A sub-floor
 * `priorBestMs` (stored before the floor) is ignored.
 */
export function nextBestTime(
  priorBestMs: number,
  finalMs: number
): { bestTimeMs: number; isNewBest: boolean } {
  const prior = plausibleBestMs(priorBestMs);
  if (plausibleBestMs(finalMs) === 0) return { bestTimeMs: prior, isNewBest: false };
  const { best, isNewBest } = bestOf(prior, finalMs, true);
  return { bestTimeMs: best, isNewBest };
}
/** The most moves `undoMove` can take back; the oldest entry goes first. */
export const UNDO_CAP = 50;
export const MAX_SHUFFLES = 3;
/** Delay before the deadlock overlay appears — matches the board shake animation duration. */
export const DEADLOCK_OVERLAY_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Seedable RNG — LCG matching Cascade / Blackjack / Twenty48 / Solitaire.
// ---------------------------------------------------------------------------

const rngSlot = createRngSlot();
export const setRng = rngSlot.setRng;
export { createSeededRng };
export type { RandomSource };

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
    if (t.layer > tile.layer && t.col === tile.col && t.row === tile.row) return false;
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

// ---------------------------------------------------------------------------
// Free-tile index (#2962) — one pass over the board instead of one per tile
// ---------------------------------------------------------------------------

/** Packing range of `posKey`: integer coordinates below this in magnitude. */
const POS_HALF = 32768;
const POS_SPAN = 2 * POS_HALF;
const LAYER_LIMIT = 2 ** 20;

/**
 * A board position (col, row, layer) as a map key. Integer coordinates (every
 * layout's) pack into one number: 16 bits each for col and row (offset, so
 * negatives work) above the layer; a "col,row,layer" string key builds three
 * strings per lookup and made the index slower than the O(n²) scan it replaces
 * (engine.freeTiles.bench.test.ts). Anything else (a fractional or huge value
 * from a bad save) falls back to that string, so the index stays exact for any
 * finite coordinates. A number and a string key never collide.
 */
function posKey(col: number, row: number, layer: number): number | string {
  // `x | 0` is x only for an int32, so these are integer-and-range checks with no
  // builtin calls (the index runs them several times per tile).
  if (
    (col | 0) === col &&
    (row | 0) === row &&
    (layer | 0) === layer &&
    col > -POS_HALF &&
    col < POS_HALF &&
    row > -POS_HALF &&
    row < POS_HALF &&
    layer > -LAYER_LIMIT &&
    layer < LAYER_LIMIT
  ) {
    return (layer * POS_SPAN + (row + POS_HALF)) * POS_SPAN + (col + POS_HALF);
  }
  return `${col},${row},${layer}`;
}

/**
 * What sits at each (col, row, layer) position, and every layer used, ascending
 * (only when built with `withLayers`; otherwise empty).
 */
interface PositionIndex<T> {
  readonly at: ReadonlyMap<number | string, T>;
  readonly layers: readonly number[];
}

/** Index `items` by position in one pass (O(n)). */
function indexPositions<T>(
  items: Iterable<T>,
  slotOf: (item: T) => Slot,
  withLayers: boolean
): PositionIndex<T> {
  const at = new Map<number | string, T>();
  const layers = new Set<number>();
  for (const item of items) {
    const { col, row, layer } = slotOf(item);
    at.set(posKey(col, row, layer), item);
    if (withLayers) layers.add(layer);
  }
  return { at, layers: withLayers ? [...layers].sort((x, y) => x - y) : [] };
}

/**
 * Whether `s` is open in `index`: nothing at its (col, row) on a layer above
 * it — any layer used on the board above it (as `isFreeTile` reads "above",
 * whatever the layer values), or only `s.layer + 1` with `nextLayerOnly` (as the
 * deal always has) — and at least one of (col−2, row, layer) and (col+2, row,
 * layer) empty. No lookup can find `s` itself, so it needs no exclusion.
 */
function isOpenAt(s: Slot, index: PositionIndex<unknown>, nextLayerOnly: boolean): boolean {
  const { at } = index;
  if (nextLayerOnly) {
    if (at.has(posKey(s.col, s.row, s.layer + 1))) return false;
  } else {
    for (let i = index.layers.length - 1; i >= 0 && index.layers[i]! > s.layer; i--) {
      if (at.has(posKey(s.col, s.row, index.layers[i]!))) return false;
    }
  }
  return !at.has(posKey(s.col - 2, s.row, s.layer)) || !at.has(posKey(s.col + 2, s.row, s.layer));
}

const tileSlot = (t: SlotTile): Slot => t;

/**
 * The ids of every free tile on the board, exactly the tiles `isFreeTile`
 * accepts, built from one position index: O(n) where calling `isFreeTile` per
 * tile is O(n²). Compute it once per board and pass it to the pair functions,
 * the canvas and `selectTile` (#2962).
 */
export function freeTileIds(tiles: readonly SlotTile[]): ReadonlySet<number> {
  const index = indexPositions(tiles, tileSlot, true);
  const free = new Set<number>();
  for (const t of tiles) {
    if (isOpenAt(t, index, false)) free.add(t.id);
  }
  return free;
}

/**
 * Every matching pair of free tiles, in board order: the first tile of each
 * pair comes before the second in `tiles`, and pairs come in the order of
 * their first, then second, tile. The only pair search in the engine; the
 * functions below stop it early or collect it. `freeIds` defaults to
 * `freeTileIds(tiles)`; pass it when the caller already has it.
 */
export function* freePairs(
  tiles: readonly SlotTile[],
  freeIds: ReadonlySet<number> = freeTileIds(tiles)
): Generator<[SlotTile, SlotTile], void, undefined> {
  const free = tiles.filter((t) => freeIds.has(t.id));
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      if (tilesMatch(free[i]!, free[j]!)) yield [free[i]!, free[j]!];
    }
  }
}

/**
 * Returns the IDs of all free tiles that match the currently selected tile.
 * Returns an empty set when nothing is selected. One pass over the board
 * against the free set; whether the selected tile is itself free does not
 * matter, as before #2962.
 */
export function getMatchingFreeTileIds(
  state: MahjongState,
  freeIds: ReadonlySet<number> = freeTileIds(state.tiles)
): ReadonlySet<number> {
  if (!state.selected) return new Set();
  const selected = state.selected;
  const ids = new Set<number>();
  for (const tile of state.tiles) {
    if (tile.id !== selected.id && freeIds.has(tile.id) && tilesMatch(tile, selected)) {
      ids.add(tile.id);
    }
  }
  return ids;
}

/** Returns true if any two free tiles in `tiles` form a matching pair. */
export function hasFreePairs(tiles: readonly SlotTile[], freeIds?: ReadonlySet<number>): boolean {
  return freePairs(tiles, freeIds).next().done !== true;
}

/** Returns all valid free pairs. */
export function getAllFreePairs(
  tiles: readonly SlotTile[],
  freeIds?: ReadonlySet<number>
): [SlotTile, SlotTile][] {
  return [...freePairs(tiles, freeIds)];
}

/** Returns the IDs of one valid free pair, or null when none exists. Used by the hint button. */
export function getAnyFreePair(
  tiles: readonly SlotTile[],
  freeIds?: ReadonlySet<number>
): [number, number] | null {
  const first = freePairs(tiles, freeIds).next();
  return first.done === true ? null : [first.value[0].id, first.value[1].id];
}

// ---------------------------------------------------------------------------
// Elapsed time helper
// ---------------------------------------------------------------------------

export function elapsedMs(state: MahjongState, now: number = Date.now()): number {
  return clockElapsedMs(state, now);
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
 * unplaced set — i.e., nothing directly above them (one layer up) and at least
 * one open horizontal side — in the unplaced set's order. Uses the same
 * position index as `freeTileIds` (#2962), built once per call: O(n) where it
 * was O(n²), so a deal attempt is O(n²) rather than O(n³).
 */
export function accessibleInUnplaced(slots: readonly Slot[], unplaced: Set<number>): number[] {
  // The deal looks one layer up only, so it needs no list of layers.
  const index = indexPositions(unplaced, (i) => slots[i]!, false);
  const accessible: number[] = [];
  for (const i of unplaced) {
    const s = slots[i]!;
    if (isOpenAt(s, index, true)) accessible.push(i);
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
 * Deterministic symmetric fallback — layer-by-layer inner-to-outer pairing.
 * All slots in each layer are sorted by (row, col) and paired symmetrically:
 * (first, last), (second, second-to-last), … This handles layouts where
 * individual rows have odd slot counts (e.g. double-pyramid layer 0), as long
 * as the total slot count per layer is even — which all valid 144-slot layouts
 * satisfy. Used only when all random attempts dead-end (probability ≈ 0.01^50).
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
    // Sort all slots in the layer by (row, col) and pair inner-to-outer across
    // the whole layer. This avoids row-by-row odd-count issues.
    const layerSlots = slots
      .filter((s) => s.layer === layer)
      .sort((a, b) => a.row - b.row || a.col - b.col);

    const N = layerSlots.length;
    if (N % 2 !== 0) throw new Error(`buildBoardLegacy: layer ${layer} has odd slot count ${N}`);
    for (let i = 0; i < N / 2; i++) {
      const slotA = layerSlots[i]!;
      const slotB = layerSlots[N - 1 - i]!;
      const pair = shuffledPairs[pairIdx++]!;
      result.push(
        { ...pair[0], id: nextId++, col: slotA.col, row: slotA.row, layer: slotA.layer },
        { ...pair[1], id: nextId++, col: slotB.col, row: slotB.row, layer: slotB.layer }
      );
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
  const rng = seed !== undefined ? createSeededRng(seed) : rngSlot.rng;
  const specs = buildFullTileSet();
  const pairs = buildPairs(specs);
  const tiles = shuffleFaceAssignments(buildBoard(layout, pairs, rng), rng);
  const dealId = computeDealId(tiles);

  return {
    _v: 2,
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
 *
 * `freeIds` is `freeTileIds(state.tiles)` when the caller already has it (the
 * screen computes it once per board, #2962); without it the tapped tile alone
 * is checked (`isFreeTile`, O(n)). It must belong to `state.tiles`.
 */
export function selectTile(
  state: MahjongState,
  tileId: number,
  freeIds?: ReadonlySet<number>
): MahjongState {
  const tile = state.tiles.find((t) => t.id === tileId);
  if (!tile || !(freeIds ? freeIds.has(tile.id) : isFreeTile(tile, state.tiles))) return state;

  const now = Date.now();
  // The first tap starts the clock; a tap while it is paused leaves it so.
  const clock = startClockOnMove(state, now);

  // Each action emits a new events array (#3087): the screen fires each array
  // once, by identity, so two selects in a row must not share one.
  if (!state.selected) {
    return withClock({ ...state, selected: tile, events: [{ type: "tileSelect" }] }, clock);
  }

  if (state.selected.id === tile.id) {
    return { ...state, selected: null, events: undefined };
  }

  if (!tilesMatch(state.selected, tile)) {
    return withClock({ ...state, selected: tile, events: [{ type: "tileSelect" }] }, clock);
  }

  // Matched pair — remove both tiles.
  const removedA = state.selected;
  const newTiles = state.tiles.filter((t) => t.id !== removedA.id && t.id !== tile.id);
  const removedTiles = [removedA, tile]
    .map((t): RemovedTile => ({ index: state.tiles.findIndex((x) => x.id === t.id), tile: t }))
    .sort((x, y) => x.index - y.index) as [RemovedTile, RemovedTile];
  const pairsRemoved = state.pairsRemoved + 1;
  const isComplete = newTiles.length === 0;
  const score = state.score + SCORE_PER_PAIR + (isComplete ? SCORE_COMPLETE_BONUS : 0);
  // Only a board with no shuffle left can deadlock, so only then is the new
  // board searched for a pair (one indexed pass, #2962).
  const isDeadlocked = state.shufflesLeft === 0 && !isComplete && !hasFreePairs(newTiles);
  const ended = isComplete || isDeadlocked;
  const events: MahjongEvent[] = [
    { type: "tileMatch", tiles: [removedTiles[0].tile, removedTiles[1].tile] },
  ];
  if (isComplete) events.push({ type: "boardCleared" });
  // Only the step into a deadlock is one (the screen shakes the board once).
  if (isDeadlocked && !state.isDeadlocked) events.push({ type: "deadlock" });

  // The tiles come back from the board itself, so the selection undoes to none.
  const undoStack = pushUndo(state, {
    ...undoBase({ ...state, selected: null }),
    kind: "match",
    removedTiles,
  });

  // Clearing or deadlocking the board stops the clock: bank the running
  // segment so the elapsed time is frozen and the result card can't tick.
  return withClock(
    {
      ...state,
      tiles: newTiles,
      pairsRemoved,
      score,
      selected: null,
      undoStack,
      isComplete,
      isDeadlocked,
      events,
    },
    ended ? stopClock(clock, now) : clock
  );
}

/**
 * Interleave slots so no consecutive pair (0,1), (2,3), … shares (col, row).
 *
 * Uses a greedy "largest-group-first" strategy: on each iteration pick one slot
 * from the biggest remaining group, then one from the biggest group with a
 * different (col, row). The invariant `maxGroupSize ≤ n/2` guarantees a
 * partner always exists, so the algorithm never stalls.
 *
 * Within each group, slots are sorted ascending by layer so that `pop()`
 * always returns the topmost (highest-layer) slot first. This guarantees the
 * very first pair in the result consists of two topmost-layer tiles from
 * different columns — both will be free — so the caller's `hasFreePairs` check
 * always passes as long as the feasibility condition holds.
 *
 * Returns null when the invariant is violated — i.e. one (col, row) position
 * holds more than half the remaining slots, making a valid pairing impossible
 * by the pigeonhole principle.
 */
function buildValidSlotPairing(slots: readonly Slot[], rng: RandomSource): Slot[] | null {
  const n = slots.length;

  // Build groups keyed by "col,row".
  const groups: Slot[][] = [];
  const keyToIdx = new Map<string, number>();
  for (const s of slots) {
    const key = `${s.col},${s.row}`;
    let idx = keyToIdx.get(key);
    if (idx === undefined) {
      idx = groups.length;
      groups.push([]);
      keyToIdx.set(key, idx);
    }
    groups[idx]!.push(s);
  }

  // Feasibility: no group may exceed half the total slot count.
  for (const g of groups) {
    if (g.length > n / 2) return null;
  }

  // Sort each group ascending by layer so pop() returns the topmost slot first.
  // Shuffle sub-topmost layers randomly for variety while keeping the topmost
  // guarantee that ensures hasFreePairs on the produced board.
  for (const g of groups) {
    g.sort((a, b) => a.layer - b.layer);
    if (g.length > 1) {
      const topmost = g.pop()!;
      fisherYates(g, rng);
      g.push(topmost); // topmost stays last → popped first
    }
  }

  // Shuffle group order for randomness between equal-size groups.
  fisherYates(groups, rng);

  const result: Slot[] = [];

  while (result.length < n) {
    // Re-sort descending by remaining size each round (O(k log k), k ≤ 72).
    groups.sort((a, b) => b.length - a.length);

    const gA = groups[0]!;
    if (gA.length === 0) break; // all slots consumed

    const sA = gA.pop()!;

    // Pick from the next non-empty group. All groups have unique col/row keys
    // (enforced by keyToIdx), so any group at index 1+ is guaranteed to differ
    // from gA — no col/row guard needed here.
    let sB: Slot | undefined;
    for (let i = 1; i < groups.length; i++) {
      const g = groups[i]!;
      if (g.length === 0) continue;
      sB = g.pop()!;
      break;
    }

    if (sB === undefined) return null; // shouldn't reach here if feasibility passed
    result.push(sA, sB);
  }

  return result.length === n ? result : null;
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
 *
 * Fallback: when all 50 random attempts fail (can happen on skewed boards
 * where most tiles share one (col,row) group), buildValidSlotPairing provides
 * a guaranteed-valid interleaving. If even that returns null the board is
 * geometrically deadlocked — no reshuffle can ever produce a playable
 * arrangement — so we consume the token and surface the deadlock overlay.
 */
export function shuffleBoard(state: MahjongState): MahjongState {
  // No token left, or the board is already deadlocked (e.g. a second tap while
  // the deadlock overlay is still delayed): nothing to shuffle, spend nothing.
  if (state.shufflesLeft === 0 || state.isDeadlocked) return state;

  const slots: Slot[] = state.tiles.map(({ col, row, layer }) => ({ col, row, layer }));
  const specs: TileSpec[] = state.tiles.map(({ suit, rank, faceId }) => ({ suit, rank, faceId }));
  const pairs = buildPairs(specs);

  let newTiles: SlotTile[] = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    const shuffledPairs = fisherYates([...pairs], rngSlot.rng);
    const shuffledSlots = fisherYates([...slots], rngSlot.rng);
    const candidate: SlotTile[] = [];
    let id = 0;
    for (let i = 0; i < shuffledPairs.length; i++) {
      const pair = shuffledPairs[i]!;
      const sA = shuffledSlots[i * 2]!;
      const sB = shuffledSlots[i * 2 + 1]!;
      candidate.push({ ...pair[0], id: id++, col: sA.col, row: sA.row, layer: sA.layer });
      candidate.push({ ...pair[1], id: id++, col: sB.col, row: sB.row, layer: sB.layer });
    }
    // Reject if any matching pair shares (col, row): removing the top tile
    // would leave the bottom tile with no partner, making the game unwinnable.
    const hasStackedMatch = shuffledPairs.some((_, i) => {
      const sA = shuffledSlots[i * 2]!;
      const sB = shuffledSlots[i * 2 + 1]!;
      return sA.col === sB.col && sA.row === sB.row;
    });
    if (!hasStackedMatch && hasFreePairs(candidate)) {
      newTiles = candidate;
      break;
    }
  }

  // Fallback: guaranteed interleaving algorithm for skewed or pure-stack boards.
  if (newTiles.length === 0) {
    const interleaved = buildValidSlotPairing(slots, rngSlot.rng);
    if (interleaved !== null) {
      const shuffledPairs = fisherYates([...pairs], rngSlot.rng);
      const candidate: SlotTile[] = [];
      for (let i = 0; i < shuffledPairs.length; i++) {
        const pair = shuffledPairs[i]!;
        const sA = interleaved[i * 2]!;
        const sB = interleaved[i * 2 + 1]!;
        candidate.push({ ...pair[0], id: i * 2, col: sA.col, row: sA.row, layer: sA.layer });
        candidate.push({ ...pair[1], id: i * 2 + 1, col: sB.col, row: sB.row, layer: sB.layer });
      }
      // buildValidSlotPairing guarantees hasFreePairs; check is a defensive
      // safety net in case the invariant is ever violated.
      if (hasFreePairs(candidate)) {
        newTiles = candidate;
      }
    }
  }

  // Geometric deadlock: no valid arrangement exists regardless of RNG.
  // Consume the token and surface the deadlock state so the user gets clear
  // feedback instead of a silent no-op.
  if (newTiles.length === 0) {
    const shufflesLeft = state.shufflesLeft - 1;
    const undoStack = pushUndo(state, { ...undoBase(state), kind: "shuffle", tilesBefore: null });
    return stopClock(
      {
        ...state,
        selected: null,
        shufflesLeft,
        isDeadlocked: true,
        undoStack,
        events: [{ type: "shuffle" }, { type: "deadlock" }],
      },
      Date.now()
    );
  }

  const undoStack = pushUndo(state, {
    ...undoBase(state),
    kind: "shuffle",
    tilesBefore: state.tiles,
  });

  return {
    ...state,
    tiles: newTiles,
    selected: null,
    shufflesLeft: state.shufflesLeft - 1,
    undoStack,
    isDeadlocked: false,
    events: [{ type: "shuffle" }],
  };
}

// ---------------------------------------------------------------------------
// Undo history — deltas, not board snapshots (#2961)
// ---------------------------------------------------------------------------

/** The non-board fields of `state` as an undo entry records them. */
function undoBase(state: MahjongState) {
  return {
    scoreBefore: state.score,
    pairsRemovedBefore: state.pairsRemoved,
    shufflesLeftBefore: state.shufflesLeft,
    selectedBefore: state.selected,
    isCompleteBefore: state.isComplete,
    isDeadlockedBefore: state.isDeadlocked,
  };
}

/** `state`'s undo history with `entry` on top, dropping the oldest past UNDO_CAP. */
function pushUndo(state: MahjongState, entry: MahjongUndoEntry): readonly MahjongUndoEntry[] {
  return pushCapped(state.undoStack, entry, UNDO_CAP);
}

/**
 * The board before the move `entry` records, given the board after it: a
 * match's two tiles go back at their old indices (ascending, so each index is
 * the one it had in the full array), a shuffle's board comes back whole.
 */
export function tilesBeforeUndo(
  tiles: readonly SlotTile[],
  entry: MahjongUndoEntry
): readonly SlotTile[] {
  if (entry.kind === "shuffle") return entry.tilesBefore ?? tiles;
  const restored = [...tiles];
  for (const { index, tile } of entry.removedTiles) restored.splice(index, 0, tile);
  return restored;
}

/** Undo the last pair removal or shuffle. */
export function undoMove(state: MahjongState, now: number = Date.now()): MahjongState {
  if (state.undoStack.length === 0) return state;
  const entry = state.undoStack[state.undoStack.length - 1]!;
  // The live clock stays (#2750): the clock as it was before the move
  // predates any pause or relaunch since, and restoring it would count that
  // gap as play. Backing out of a deadlock, which stopped the clock, starts
  // it again.
  const live =
    state.isDeadlocked && state.startedAt === null && state.paused !== true
      ? { startedAt: now, accumulatedMs: state.accumulatedMs }
      : state;
  return withClock(
    {
      ...state,
      tiles: tilesBeforeUndo(state.tiles, entry),
      score: entry.scoreBefore,
      pairsRemoved: entry.pairsRemovedBefore,
      shufflesLeft: entry.shufflesLeftBefore,
      selected: entry.selectedBefore,
      isComplete: entry.isCompleteBefore,
      isDeadlocked: entry.isDeadlockedBefore,
      undoStack: state.undoStack.slice(0, -1),
      // An undone shuffle can bring a selection back (a match never does):
      // that is a select, as the board shows it.
      events: entry.selectedBefore !== null ? [{ type: "tileSelect" }] : undefined,
    },
    live
  );
}

/**
 * Freeze the timer while the player is away: another screen covers the game
 * (Leaderboard, #2633) or the app is in the background (#2750). The screen
 * drives both through `usePauseWhileAway`. A no-op once the game has no
 * running timer to freeze (not yet started, or already finished).
 */
export function pauseGame(state: MahjongState, now: number = Date.now()): MahjongState {
  return pauseClock(state, now);
}

/** Resume a timer `pauseGame` froze. A no-op on a finished or unstarted game. */
export function resumeGame(state: MahjongState, now: number = Date.now()): MahjongState {
  return state.isComplete || state.isDeadlocked ? state : resumeClock(state, now);
}

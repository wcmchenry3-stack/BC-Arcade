/**
 * Client-side 2048 engine.
 *
 * Pure functions returning new state on each move — immutable for
 * React-friendly state updates.
 *
 * Each tile carries a stable numeric ID assigned at spawn. The `tiles`
 * array records per-tile animation metadata (prevRow/prevCol, isNew,
 * isMerge, mergedFrom) so the renderer can animate slides, merges, and spawns
 * without tracking state itself.
 */

import { createRngSlot, createSeededRng } from "../_shared/seededRng";
import { Twenty48State, TileData, GameEvent, MergeSource } from "./types";
import {
  pauseClock,
  resumeClock,
  startClockOnMove,
  stopClock,
  withClock,
} from "../_shared/playClock";

/**
 * Version of the rules this engine plays by (#3909, epic #3273). Sent in
 * `game_started` as `engine_version` so a stored game says which rules made it.
 * Bump it when a change to this engine would make an older recorded game
 * replay differently; a `game_started` without the field is version 1.
 */
export const ENGINE_VERSION = 1;

export const SIZE = 4;

export type Direction = "up" | "down" | "left" | "right";

// ---------------------------------------------------------------------------
// Tile ID counter
// ---------------------------------------------------------------------------

let _nextTileId = 1;

function nextId(): number {
  return _nextTileId++;
}

/**
 * Re-seed the tile ID counter so the next assigned ID is `fromId`.
 *
 * Must be called after restoring a persisted game whose tiles already hold
 * IDs produced by an earlier session — otherwise the counter (reset to 1 on
 * every JS reload) will re-issue IDs that collide with surviving tiles and
 * React will warn about duplicate keys in the Grid (#698).
 */
export function seedNextTileId(fromId: number): void {
  _nextTileId = Math.max(1, fromId);
}

/** Reset the ID counter — for testing only. */
export function _resetTileIds(): void {
  _nextTileId = 1;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Slide a single row/column toward index 0 and merge equal neighbours.
 * Each tile may only participate in one merge per move.
 *
 * Operates on parallel value and ID arrays so tile identity is preserved
 * through the slide. Merged tiles receive a new ID; the score delta and
 * the set of newly-merged IDs are returned alongside the output arrays.
 * It is also the merge rule `REPLAY_ENGINES` (replay.ts) replays engine_version 1 with.
 */
export function slideAndMerge(line: readonly number[]): { line: number[]; score: number } {
  const compacted = line.filter((v) => v !== 0);
  const merged: number[] = [];
  let score = 0;
  let i = 0;
  while (i < compacted.length) {
    const curr = compacted[i];
    const next = compacted[i + 1];
    if (curr === undefined) break;
    if (i + 1 < compacted.length && next !== undefined && curr === next) {
      const val = curr * 2;
      merged.push(val);
      score += val;
      i += 2;
    } else {
      merged.push(curr);
      i += 1;
    }
  }
  while (merged.length < SIZE) merged.push(0);
  return { line: merged, score };
}

/** Internal version that also threads tile IDs through the merge logic. */
function slideAndMergeWithIds(
  values: readonly number[],
  ids: readonly number[]
): {
  values: number[];
  ids: number[];
  score: number;
  mergedIds: Set<number>;
  /** Each merged tile's id -> the ids of the two tiles it was made from. */
  sources: Map<number, [number, number]>;
} {
  const cv: number[] = [];
  const ci: number[] = [];
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    const id = ids[k];
    if (v !== undefined && id !== undefined && v !== 0) {
      cv.push(v);
      ci.push(id);
    }
  }

  const outV: number[] = [];
  const outI: number[] = [];
  const mergedIds = new Set<number>();
  const sources = new Map<number, [number, number]>();
  let score = 0;
  let i = 0;
  while (i < cv.length) {
    const curr = cv[i];
    const currId = ci[i];
    if (curr === undefined || currId === undefined) break;
    const next = cv[i + 1];
    if (i + 1 < cv.length && next !== undefined && curr === next) {
      const val = curr * 2;
      const id = nextId();
      outV.push(val);
      outI.push(id);
      mergedIds.add(id);
      sources.set(id, [currId, ci[i + 1] ?? 0]);
      score += val;
      i += 2;
    } else {
      outV.push(curr);
      outI.push(currId);
      i++;
    }
  }
  while (outV.length < SIZE) {
    outV.push(0);
    outI.push(0);
  }
  return { values: outV, ids: outI, score, mergedIds, sources };
}

function transpose(board: readonly number[][]): number[][] {
  return Array.from({ length: SIZE }, (_, c) =>
    Array.from({ length: SIZE }, (_, r) => board[r]?.[c] ?? 0)
  );
}

function cloneBoard(board: readonly number[][]): number[][] {
  return board.map((row) => [...row]);
}

function cloneIds(ids: readonly number[][]): number[][] {
  return ids.map((row) => [...row]);
}

function boardsEqual(a: readonly number[][], b: readonly number[][]): boolean {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if ((a[r]?.[c] ?? -1) !== (b[r]?.[c] ?? -1)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Seedable RNG
// ---------------------------------------------------------------------------

const rngSlot = createRngSlot();
/** @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126). */
export const setRng = rngSlot.setRng;
/** @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126). */
export const getRng = rngSlot.getRng;
/** @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126). */
export { createSeededRng };

function spawnTile(board: number[][], idBoard: number[][]): void {
  const empty: Array<[number, number]> = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if ((board[r]?.[c] ?? -1) === 0) empty.push([r, c]);
    }
  }
  if (empty.length === 0) return;
  const pos = empty[Math.floor(rngSlot.rng() * empty.length)];
  if (pos === undefined) return;
  const [r, c] = pos;
  const boardRow = board[r];
  const idBoardRow = idBoard[r];
  if (boardRow !== undefined && idBoardRow !== undefined) {
    boardRow[c] = rngSlot.rng() < 0.9 ? 2 : 4;
    idBoardRow[c] = nextId();
  }
}

/**
 * A board is game-over when it is full AND no two adjacent cells are equal.
 */
export function isGameOver(board: readonly number[][]): boolean {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = board[r]?.[c] ?? 0;
      if (cell === 0) return false;
      if (c + 1 < SIZE && cell === (board[r]?.[c + 1] ?? -1)) return false;
      if (r + 1 < SIZE && cell === (board[r + 1]?.[c] ?? -1)) return false;
    }
  }
  return true;
}

/**
 * Ties go to the first of these, which keeps the big tiles in the top-left corner (the usual
 * strategy): left and up before right and down.
 */
const HINT_ORDER: readonly Direction[] = ["left", "up", "right", "down"];

/** What sliding one line toward index 0 does: whether it changes, how many merges, the points. */
function lineEffect(line: readonly number[]): { changed: boolean; merges: number; gained: number } {
  const { line: out, score } = slideAndMerge(line);
  const before = line.filter((v) => v !== 0).length;
  const after = out.filter((v) => v !== 0).length;
  return {
    changed: out.some((v, i) => v !== (line[i] ?? 0)),
    merges: before - after,
    gained: score,
  };
}

/**
 * The swipe to suggest for `board` (#3688): the legal move that merges the most tiles, then the
 * one that scores the most, then the first legal move in `HINT_ORDER`. Null when no move changes
 * the board (it is stuck). Pure: it neither spawns a tile nor draws from the RNG, so asking for a
 * hint never changes the game.
 */
export function suggestMove(board: readonly number[][]): Direction | null {
  let best: Direction | null = null;
  let bestMerges = -1;
  let bestGained = -1;
  for (const direction of HINT_ORDER) {
    let changed = false;
    let merges = 0;
    let gained = 0;
    for (let i = 0; i < SIZE; i++) {
      // The line as the move reads it, toward index 0: a column for up and down, reversed for
      // right and down.
      const line = Array.from({ length: SIZE }, (_, k) =>
        direction === "left" || direction === "right" ? (board[i]?.[k] ?? 0) : (board[k]?.[i] ?? 0)
      );
      if (direction === "right" || direction === "down") line.reverse();
      const effect = lineEffect(line);
      changed ||= effect.changed;
      merges += effect.merges;
      gained += effect.gained;
    }
    if (!changed) continue;
    if (merges > bestMerges || (merges === bestMerges && gained > bestGained)) {
      best = direction;
      bestMerges = merges;
      bestGained = gained;
    }
  }
  return best;
}

function boardHas2048(board: readonly number[][]): boolean {
  for (const row of board) {
    for (const cell of row) {
      if (cell === 2048) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Build TileData[] from board + idBoard + previous tile positions
// ---------------------------------------------------------------------------

/** A merged tile's id -> the ids of the two tiles it was made from. */
type Sources = Map<number, [number, number]>;

function buildTiles(
  board: number[][],
  idBoard: number[][],
  prevPositions: Map<number, { row: number; col: number }>,
  mergedIds: Set<number>,
  spawnedIds: Set<number>,
  sources: Sources = new Map()
): TileData[] {
  const tiles: TileData[] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const id = idBoard[r]?.[c] ?? 0;
      if (id === 0) continue;
      const prev = prevPositions.get(id);
      // Where the two tiles that merged into this one started (#3689), for the renderer to slide
      // them together. Only a tile whose two sources are both known gets it.
      const from = sources.get(id)?.map((sid) => ({ id: sid, ...prevPositions.get(sid) }));
      const mergedFrom =
        from !== undefined && from.every((f) => f.row !== undefined && f.col !== undefined)
          ? (from as MergeSource[])
          : undefined;
      tiles.push({
        id,
        value: board[r]?.[c] ?? 0,
        row: r,
        col: c,
        prevRow: prev?.row ?? null,
        prevCol: prev?.col ?? null,
        isNew: spawnedIds.has(id),
        isMerge: mergedIds.has(id),
        ...(mergedFrom ? { mergedFrom } : {}),
      });
    }
  }
  return tiles;
}

/** Extract previous tile positions from the current tiles array. */
function positionMap(tiles: readonly TileData[]): Map<number, { row: number; col: number }> {
  const map = new Map<number, { row: number; col: number }>();
  for (const t of tiles) map.set(t.id, { row: t.row, col: t.col });
  return map;
}

/** Derive an ID board from a tiles array. */
function idBoardFromTiles(tiles: readonly TileData[]): number[][] {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  for (const t of tiles) {
    const row = board[t.row];
    if (row !== undefined) row[t.col] = t.id;
  }
  return board;
}

// ---------------------------------------------------------------------------
// Direction kernels — mutate working board + idBoard, return gained score
// and accumulated merged IDs
// ---------------------------------------------------------------------------

function applyLeft(
  board: number[][],
  idBoard: number[][]
): { score: number; mergedIds: Set<number>; sources: Sources } {
  let score = 0;
  const mergedIds = new Set<number>();
  const sources: Sources = new Map();
  for (let r = 0; r < SIZE; r++) {
    const row = board[r];
    const idRow = idBoard[r];
    if (row === undefined || idRow === undefined) continue;
    const result = slideAndMergeWithIds(row, idRow);
    board[r] = result.values;
    idBoard[r] = result.ids;
    score += result.score;
    for (const id of result.mergedIds) mergedIds.add(id);
    for (const [id, from] of result.sources) sources.set(id, from);
  }
  return { score, mergedIds, sources };
}

function applyRight(
  board: number[][],
  idBoard: number[][]
): { score: number; mergedIds: Set<number>; sources: Sources } {
  let score = 0;
  const mergedIds = new Set<number>();
  const sources: Sources = new Map();
  for (let r = 0; r < SIZE; r++) {
    const row = board[r];
    const idRow = idBoard[r];
    if (row === undefined || idRow === undefined) continue;
    const revV = [...row].reverse();
    const revI = [...idRow].reverse();
    const result = slideAndMergeWithIds(revV, revI);
    board[r] = result.values.reverse();
    idBoard[r] = result.ids.reverse();
    score += result.score;
    for (const id of result.mergedIds) mergedIds.add(id);
    for (const [id, from] of result.sources) sources.set(id, from);
  }
  return { score, mergedIds, sources };
}

function applyUp(
  board: number[][],
  idBoard: number[][]
): {
  board: number[][];
  idBoard: number[][];
  score: number;
  mergedIds: Set<number>;
  sources: Sources;
} {
  let wb = transpose(board);
  let wi = transpose(idBoard);
  const { score, mergedIds, sources } = applyLeft(wb, wi);
  wb = transpose(wb);
  wi = transpose(wi);
  return { board: wb, idBoard: wi, score, mergedIds, sources };
}

function applyDown(
  board: number[][],
  idBoard: number[][]
): {
  board: number[][];
  idBoard: number[][];
  score: number;
  mergedIds: Set<number>;
  sources: Sources;
} {
  let wb = transpose(board);
  let wi = transpose(idBoard);
  const { score, mergedIds, sources } = applyRight(wb, wi);
  wb = transpose(wb);
  wi = transpose(wi);
  return { board: wb, idBoard: wi, score, mergedIds, sources };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function newGame(): Twenty48State {
  // Fresh game: restart IDs from 1 so a new game doesn't reuse stale IDs
  // carried over from a previous in-session game.
  _resetTileIds();
  const board: number[][] = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  const idBoard: number[][] = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  spawnTile(board, idBoard);
  spawnTile(board, idBoard);

  // All tiles in a new game are "new" (spawn animation).
  const spawnedIds = new Set<number>();
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const id = idBoard[r]?.[c] ?? 0;
      if (id !== 0) spawnedIds.add(id);
    }

  const tiles = buildTiles(board, idBoard, new Map(), new Set(), spawnedIds);
  return {
    board,
    tiles,
    score: 0,
    scoreDelta: 0,
    game_over: false,
    has_won: false,
    startedAt: null,
    accumulatedMs: 0,
  };
}

/**
 * Freeze the timer while the screen is covered by another (Stats,
 * Leaderboard, Scoreboard, #2735), so that time doesn't count as play. A
 * no-op once the game has no running timer to freeze (not yet started, or
 * already over).
 */
export function pauseGame(state: Twenty48State, now: number = Date.now()): Twenty48State {
  return pauseClock(state, now);
}

/** Resume a timer `pauseGame` froze. A no-op on a finished or unstarted game. */
export function resumeGame(state: Twenty48State, now: number = Date.now()): Twenty48State {
  return state.game_over ? state : resumeClock(state, now);
}

/**
 * Apply a move to `state`. Returns a new state.
 * Throws if the move has no effect or the game is already over.
 */
export function move(state: Twenty48State, direction: Direction): Twenty48State {
  if (state.game_over) {
    throw new Error("Game is over. Start a new game.");
  }
  if (direction !== "up" && direction !== "down" && direction !== "left" && direction !== "right") {
    throw new Error(`Invalid direction: ${direction}`);
  }

  const oldBoard = state.board;
  let nextBoard = cloneBoard(state.board);
  let nextIdBoard = cloneIds(idBoardFromTiles(state.tiles));
  let gained = 0;
  let mergedIds = new Set<number>();
  let sources: Sources = new Map();

  if (direction === "left") {
    const r = applyLeft(nextBoard, nextIdBoard);
    gained = r.score;
    mergedIds = r.mergedIds;
    sources = r.sources;
  } else if (direction === "right") {
    const r = applyRight(nextBoard, nextIdBoard);
    gained = r.score;
    mergedIds = r.mergedIds;
    sources = r.sources;
  } else if (direction === "up") {
    const r = applyUp(nextBoard, nextIdBoard);
    nextBoard = r.board;
    nextIdBoard = r.idBoard;
    gained = r.score;
    mergedIds = r.mergedIds;
    sources = r.sources;
  } else {
    const r = applyDown(nextBoard, nextIdBoard);
    nextBoard = r.board;
    nextIdBoard = r.idBoard;
    gained = r.score;
    mergedIds = r.mergedIds;
    sources = r.sources;
  }

  if (boardsEqual(nextBoard, oldBoard)) {
    throw new Error("Move has no effect.");
  }

  const prevPositions = positionMap(state.tiles);

  const spawnedIds = new Set<number>();
  spawnTile(nextBoard, nextIdBoard);
  // Find the newly spawned ID (the one in nextIdBoard not in prevPositions).
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const id = nextIdBoard[r]?.[c] ?? 0;
      if (id !== 0 && !prevPositions.has(id) && !mergedIds.has(id)) {
        spawnedIds.add(id);
      }
    }
  }

  const tiles = buildTiles(nextBoard, nextIdBoard, prevPositions, mergedIds, spawnedIds, sources);
  const has_won = state.has_won || boardHas2048(nextBoard);
  const game_over = isGameOver(nextBoard);

  const emittedEvents: GameEvent[] = [];
  if (!state.has_won && has_won) emittedEvents.push("win2048");
  if (game_over) emittedEvents.push("gameOver");

  // --- Timer tracking ---
  // The first move starts the clock (a move while it is paused leaves it
  // so), and the game ending freezes it.
  const now = Date.now();
  const clock = startClockOnMove(state, now);

  return withClock(
    {
      board: nextBoard,
      tiles,
      score: state.score + gained,
      scoreDelta: gained,
      game_over,
      has_won,
      startedAt: null,
      accumulatedMs: 0,
      events: emittedEvents.length > 0 ? emittedEvents : undefined,
    },
    game_over ? stopClock(clock, now) : clock
  );
}

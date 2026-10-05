/**
 * Shape checks for a loaded Mahjong undo history (#2961). Pure: no
 * AsyncStorage. `loadGame` keeps the newest run of entries that pass and
 * drops the rest, so a bad entry costs undo history, never the game.
 */

import type { MahjongUndoEntry, SlotTile } from "./types";
import { UNDO_CAP } from "./engine";

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}

export function isSlotTile(raw: unknown): raw is SlotTile {
  return (
    isRecord(raw) &&
    typeof raw.id === "number" &&
    typeof raw.suit === "string" &&
    typeof raw.rank === "number" &&
    typeof raw.faceId === "number" &&
    typeof raw.col === "number" &&
    typeof raw.row === "number" &&
    typeof raw.layer === "number"
  );
}

function isRemovedTile(raw: unknown): boolean {
  return isRecord(raw) && Number.isInteger(raw.index) && isSlotTile(raw.tile);
}

function isUndoEntry(raw: unknown): raw is MahjongUndoEntry {
  if (
    !isRecord(raw) ||
    typeof raw.scoreBefore !== "number" ||
    typeof raw.pairsRemovedBefore !== "number" ||
    typeof raw.shufflesLeftBefore !== "number" ||
    !(raw.selectedBefore === null || isSlotTile(raw.selectedBefore)) ||
    typeof raw.isCompleteBefore !== "boolean" ||
    typeof raw.isDeadlockedBefore !== "boolean"
  ) {
    return false;
  }
  if (raw.kind === "match") {
    const removed = raw.removedTiles;
    return Array.isArray(removed) && removed.length === 2 && removed.every(isRemovedTile);
  }
  if (raw.kind === "shuffle") {
    const before = raw.tilesBefore;
    return before === null || (Array.isArray(before) && before.every(isSlotTile));
  }
  return false;
}

/** The tile ids on a board; its size is the tile count. */
type BoardIds = Set<number>;

/**
 * The ids on the board before `entry`, given those on the board after it, or
 * null when the entry can't have led to that board: a shuffle keeps the tile
 * count (its `tilesBefore` null when it left the board as it was), a match's
 * indices fit the board and its two tiles aren't on it, and no board holds
 * an id twice. Only ids and a count are kept, never a board per entry.
 */
function idsBefore(entry: MahjongUndoEntry, after: BoardIds): BoardIds | null {
  if (entry.kind === "shuffle") {
    const before = entry.tilesBefore;
    if (before === null) return after;
    const ids = new Set(before.map((t) => t.id));
    return before.length === after.size && ids.size === before.length ? ids : null;
  }
  const [a, b] = entry.removedTiles;
  if (a.index < 0 || a.index >= b.index || b.index > after.size + 1) return null;
  if (a.tile.id === b.tile.id || after.has(a.tile.id) || after.has(b.tile.id)) return null;
  after.add(a.tile.id).add(b.tile.id);
  return after;
}

/**
 * A saved undo history, oldest first, for the board `tiles`: the newest
 * entries back to the first that isn't valid or can't have led to the board
 * the entries above it restore, at most UNDO_CAP.
 */
export function loadUndoEntries(
  raw: readonly unknown[],
  tiles: readonly SlotTile[]
): MahjongUndoEntry[] {
  let start = raw.length;
  let ids: BoardIds | null = new Set(tiles.map((t) => t.id));
  if (ids.size !== tiles.length) return [];
  while (start > 0 && raw.length - start < UNDO_CAP) {
    const entry = raw[start - 1];
    if (!isUndoEntry(entry)) break;
    ids = idsBefore(entry, ids);
    if (ids === null) break;
    start--;
  }
  return raw.slice(start) as MahjongUndoEntry[];
}

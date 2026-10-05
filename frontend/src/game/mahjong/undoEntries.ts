/**
 * Shape checks for a loaded Mahjong undo history (#2961). Pure: no
 * AsyncStorage. `loadGame` keeps the newest run of entries that pass and
 * drops the rest, so a bad entry costs undo history, never the game.
 */

import type { MahjongUndoEntry, SlotTile } from "./types";
import { tilesBeforeUndo, UNDO_CAP } from "./engine";

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

function uniqueIds(tiles: readonly SlotTile[]): boolean {
  return new Set(tiles.map((t) => t.id)).size === tiles.length;
}

/**
 * The board before `entry`, given the board after it, or null when the entry
 * can't have led to that board: a shuffle keeps the tile count (its
 * `tilesBefore` null when it left the board as it was), a match's indices
 * fit the board, and either way no tile id appears twice.
 */
function boardBefore(
  entry: MahjongUndoEntry,
  after: readonly SlotTile[]
): readonly SlotTile[] | null {
  if (entry.kind === "shuffle") {
    const before = entry.tilesBefore;
    if (before === null) return after;
    return before.length === after.length && uniqueIds(before) ? before : null;
  }
  const [a, b] = entry.removedTiles;
  if (a.index < 0 || a.index >= b.index || b.index > after.length + 1) return null;
  const before = tilesBeforeUndo(after, entry);
  return uniqueIds(before) ? before : null;
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
  let board: readonly SlotTile[] | null = tiles;
  while (start > 0 && raw.length - start < UNDO_CAP) {
    const entry = raw[start - 1];
    if (!isUndoEntry(entry)) break;
    board = boardBefore(entry, board);
    if (board === null) break;
    start--;
  }
  return raw.slice(start) as MahjongUndoEntry[];
}

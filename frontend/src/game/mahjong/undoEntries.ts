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

/**
 * The tile count before `entry`, given the count after it, or null when the
 * entry can't apply to a board that size (a match's indices out of range).
 */
function countBefore(entry: MahjongUndoEntry, after: number): number | null {
  if (entry.kind === "shuffle") return entry.tilesBefore?.length ?? after;
  const [a, b] = entry.removedTiles;
  return a.index >= 0 && a.index < b.index && b.index <= after + 1 ? after + 2 : null;
}

/**
 * A saved undo history, oldest first, for a board of `tileCount` tiles: the
 * newest entries back to the first that isn't valid or doesn't fit the
 * board the entries above it restore, at most UNDO_CAP.
 */
export function loadUndoEntries(raw: readonly unknown[], tileCount: number): MahjongUndoEntry[] {
  let start = raw.length;
  let count: number | null = tileCount;
  while (start > 0 && raw.length - start < UNDO_CAP) {
    const entry = raw[start - 1];
    if (!isUndoEntry(entry)) break;
    count = countBefore(entry, count);
    if (count === null) break;
    start--;
  }
  return raw.slice(start) as MahjongUndoEntry[];
}

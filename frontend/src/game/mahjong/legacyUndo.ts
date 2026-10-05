/**
 * Migration shim for version 1 Mahjong saves (#2961). Remove one release
 * after delta undo shipped, together with the `_v: 1` branch in `loadGame`
 * and the tests that use version 1 fixtures.
 *
 * A version 1 save held its undo history as full board snapshots (the state
 * before each move, with an empty nested `undoStack`). Each snapshot becomes
 * the delta the engine now records:
 *
 * - a match: the snapshot's board is the next board plus two tiles, every
 *   other tile the same and in the same order. The two tiles and their
 *   indices are kept.
 * - anything else (a shuffle, which renumbers and re-faces every tile): the
 *   snapshot's whole board is kept, as a shuffle entry does; null when it is
 *   the next board exactly (a geometric-deadlock shuffle changed nothing).
 *
 * Either way the undo restores the snapshot exactly: its board, score, pairs,
 * shuffles, selection and end flags (the clock never came from the snapshot,
 * #2750). "The next board" is the one after the move: the following snapshot
 * for all but the newest, and the saved game's own board for the newest.
 *
 * A snapshot that isn't one (a bad payload) ends the history there: it and
 * everything older are dropped, since undoing past it could not reach the
 * boards it hid. The game itself still loads.
 */

import type { MahjongUndoEntry, RemovedTile, SlotTile } from "./types";
import { UNDO_CAP } from "./engine";
import { isSlotTile } from "./undoEntries";

interface LegacySnapshot {
  readonly tiles: readonly SlotTile[];
  readonly score: number;
  readonly pairsRemoved: number;
  readonly shufflesLeft: number;
  readonly selected: SlotTile | null;
  readonly isComplete: boolean;
  readonly isDeadlocked: boolean;
}

function isLegacySnapshot(raw: unknown): raw is LegacySnapshot {
  if (raw === null || typeof raw !== "object") return false;
  const s = raw as Record<string, unknown>;
  return (
    Array.isArray(s.tiles) &&
    s.tiles.every(isSlotTile) &&
    typeof s.score === "number" &&
    typeof s.pairsRemoved === "number" &&
    typeof s.shufflesLeft === "number" &&
    (s.selected === null || s.selected === undefined || isSlotTile(s.selected)) &&
    typeof s.isComplete === "boolean" &&
    typeof s.isDeadlocked === "boolean"
  );
}

function sameTile(a: SlotTile, b: SlotTile): boolean {
  return (
    a.id === b.id &&
    a.suit === b.suit &&
    a.rank === b.rank &&
    a.faceId === b.faceId &&
    a.col === b.col &&
    a.row === b.row &&
    a.layer === b.layer
  );
}

/** The two tiles `before` has beyond `after`, if `after` is `before` less exactly two tiles. */
function removedPair(
  before: readonly SlotTile[],
  after: readonly SlotTile[]
): [RemovedTile, RemovedTile] | null {
  if (before.length !== after.length + 2) return null;
  const removed: RemovedTile[] = [];
  let j = 0;
  for (let i = 0; i < before.length; i++) {
    const tile = before[i]!;
    if (j < after.length && sameTile(tile, after[j]!)) {
      j++;
    } else {
      if (removed.length === 2) return null;
      removed.push({ index: i, tile });
    }
  }
  return removed.length === 2 ? [removed[0]!, removed[1]!] : null;
}

/** One snapshot as the delta from it to the board `after` the move. */
function toDelta(snapshot: LegacySnapshot, after: readonly SlotTile[]): MahjongUndoEntry {
  const base = {
    scoreBefore: snapshot.score,
    pairsRemovedBefore: snapshot.pairsRemoved,
    shufflesLeftBefore: snapshot.shufflesLeft,
    selectedBefore: snapshot.selected ?? null,
    isCompleteBefore: snapshot.isComplete,
    isDeadlockedBefore: snapshot.isDeadlocked,
  };
  const pair = removedPair(snapshot.tiles, after);
  if (pair) return { ...base, kind: "match", removedTiles: pair };
  // A shuffle that left the board as it was (a geometric deadlock) keeps no board.
  const unchanged =
    snapshot.tiles.length === after.length &&
    snapshot.tiles.every((tile, i) => sameTile(tile, after[i]!));
  return { ...base, kind: "shuffle", tilesBefore: unchanged ? null : snapshot.tiles };
}

/**
 * A version 1 save's snapshot history as delta entries, oldest first. `tiles`
 * is the saved game's own board. Stops at the newest snapshot that isn't one,
 * and keeps at most UNDO_CAP.
 */
export function migrateLegacyUndoStack(
  snapshots: readonly unknown[],
  tiles: readonly SlotTile[]
): MahjongUndoEntry[] {
  const entries: MahjongUndoEntry[] = [];
  let after = tiles;
  for (let i = snapshots.length - 1; i >= 0 && entries.length < UNDO_CAP; i--) {
    const snapshot = snapshots[i];
    if (!isLegacySnapshot(snapshot)) break;
    entries.push(toDelta(snapshot, after));
    after = snapshot.tiles;
  }
  return entries.reverse();
}

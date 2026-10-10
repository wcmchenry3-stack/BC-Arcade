import { migrateLegacyUndoStack } from "../legacyUndo";
import { UNDO_CAP } from "../engine";
import type { SlotTile } from "../types";

/** `n` tiles in a row, ids from `from`. */
function row(n: number, from = 0): SlotTile[] {
  return Array.from({ length: n }, (_, i) => ({
    id: from + i,
    suit: "bamboos",
    rank: 1,
    faceId: 26,
    col: (from + i) * 2,
    row: 0,
    layer: 0,
  }));
}

/** A version 1 snapshot of `tiles`, the rest as that build stored it. */
function snapshot(tiles: SlotTile[], extra: Record<string, unknown> = {}) {
  return {
    _v: 1,
    tiles,
    score: 0,
    pairsRemoved: 0,
    shufflesLeft: 3,
    selected: null,
    isComplete: false,
    isDeadlocked: false,
    undoStack: [],
    startedAt: 5,
    accumulatedMs: 9,
    ...extra,
  };
}

describe("migrateLegacyUndoStack (#2961)", () => {
  it("keeps a match as its two tiles and their indices", () => {
    const before = row(6);
    const after = [before[0]!, before[2]!, before[3]!, before[5]!];
    const [entry] = migrateLegacyUndoStack(
      [snapshot(before, { score: 40, pairsRemoved: 4 })],
      after
    );
    expect(entry).toEqual({
      kind: "match",
      removedTiles: [
        { index: 1, tile: before[1] },
        { index: 4, tile: before[4] },
      ],
      scoreBefore: 40,
      pairsRemovedBefore: 4,
      shufflesLeftBefore: 3,
      selectedBefore: null,
      isCompleteBefore: false,
      isDeadlockedBefore: false,
    });
  });

  it("keeps the whole board for any other move, so the undo is still exact", () => {
    const before = row(4);
    // A shuffle: same slots, tiles renumbered.
    const reshuffled = row(4, 10);
    const selected = before[2]!;
    const [entry] = migrateLegacyUndoStack(
      [snapshot(before, { shufflesLeft: 2, selected })],
      reshuffled
    );
    expect(entry).toEqual(
      expect.objectContaining({
        kind: "shuffle",
        tilesBefore: before,
        shufflesLeftBefore: 2,
        selectedBefore: selected,
      })
    );
    // The same size, one tile changed: a shuffle, kept whole.
    const moved = [{ ...before[0]!, col: 99 }, ...before.slice(1)];
    expect(migrateLegacyUndoStack([snapshot(before)], moved)[0]).toEqual(
      expect.objectContaining({ kind: "shuffle", tilesBefore: before })
    );
  });

  it("ends the history at a gap: a snapshot no single move leads from", () => {
    const b0 = row(8);
    const b1 = b0.slice(2);
    const b2 = b1.slice(2);
    // Two tiles fewer, but another tile changed too: not a match, and a
    // shuffle keeps the tile count, so it can't be one either.
    const moved = [{ ...b1[0]!, col: 99 }, ...b1.slice(3)];
    expect(migrateLegacyUndoStack([snapshot(b1)], moved)).toEqual([]);
    // A snapshot missing from the chain (the move from b1 to b2): the history
    // ends at the gap, keeping only the newer entry.
    const entries = migrateLegacyUndoStack([snapshot(b0), snapshot(b2)], b2.slice(2));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("match");
  });

  it("keeps no board for a shuffle that left it as it was (a geometric deadlock)", () => {
    const board = row(4);
    const [entry] = migrateLegacyUndoStack(
      [
        snapshot(
          board.map((t) => ({ ...t })),
          { shufflesLeft: 1 }
        ),
      ],
      board
    );
    expect(entry).toEqual(
      expect.objectContaining({ kind: "shuffle", tilesBefore: null, shufflesLeftBefore: 1 })
    );
    // Undone, it keeps the board as it is, which is the snapshot's.
    const faced = [{ ...board[0]!, faceId: 27 }, ...board.slice(1)];
    expect(migrateLegacyUndoStack([snapshot(faced)], board)[0]).toEqual(
      expect.objectContaining({ tilesBefore: faced })
    );
  });

  it("chains each snapshot to the next one's board", () => {
    const b0 = row(6);
    const b1 = b0.slice(2);
    const b2 = b1.slice(2);
    const entries = migrateLegacyUndoStack([snapshot(b0), snapshot(b1)], b2);
    expect(entries.map((e) => e.kind)).toEqual(["match", "match"]);
    expect(entries.map((e) => (e.kind === "match" ? e.removedTiles[0].tile.id : -1))).toEqual([
      0, 2,
    ]);
  });

  it("drops a bad snapshot and everything older, and keeps at most UNDO_CAP", () => {
    const b0 = row(6);
    const b1 = b0.slice(2);
    const entries = migrateLegacyUndoStack([snapshot(b0), { tiles: 7 }, snapshot(b1)], b1.slice(2));
    expect(entries).toHaveLength(1);
    const many = Array.from({ length: UNDO_CAP + 5 }, () => snapshot(row(2)));
    expect(migrateLegacyUndoStack(many, row(2))).toHaveLength(UNDO_CAP);
  });
});

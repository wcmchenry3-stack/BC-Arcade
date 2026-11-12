/**
 * The engine records which two tiles each merge was made from, and where they started (#3689),
 * so the renderer can slide both into the merged tile. It is an optional extra on `TileData`:
 * it changes neither the board, the score, the tile ids nor what a replay rebuilds.
 */
import { move, setRng, createSeededRng, Direction } from "../engine";
import { Twenty48State, TileData } from "../types";

function tile(id: number, value: number, row: number, col: number): TileData {
  return { id, value, row, col, prevRow: row, prevCol: col, isNew: false, isMerge: false };
}

function stateOf(tiles: TileData[]): Twenty48State {
  const board = Array.from({ length: 4 }, () => Array<number>(4).fill(0));
  for (const t of tiles) board[t.row]![t.col] = t.value;
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

beforeEach(() => setRng(createSeededRng(7)));

describe("engine: mergedFrom", () => {
  it("a merge records both source tiles and the cells they started in", () => {
    const s = stateOf([tile(10, 2, 0, 1), tile(11, 2, 0, 3)]);
    const next = move(s, "left");
    const merged = next.tiles.find((t) => t.isMerge)!;
    expect(merged.value).toBe(4);
    expect([merged.row, merged.col]).toEqual([0, 0]);
    expect(merged.mergedFrom).toEqual([
      { id: 10, row: 0, col: 1 },
      { id: 11, row: 0, col: 3 },
    ]);
  });

  it.each<[Direction, [number, number], [number, number], [number, number]]>([
    ["left", [1, 0], [1, 2], [1, 3]],
    ["right", [1, 3], [1, 1], [1, 0]],
    ["up", [0, 2], [1, 2], [3, 2]],
    ["down", [3, 2], [2, 2], [0, 2]],
  ])(
    "%s: the sources are the two tiles that met, in the order the move reads them",
    (direction, dest, first, second) => {
      // Two 2s and a 4 in one line, so only the 2s merge.
      const cells: Record<string, [number, number][]> = {
        left: [
          [1, 2],
          [1, 3],
        ],
        right: [
          [1, 0],
          [1, 1],
        ],
        up: [
          [1, 2],
          [3, 2],
        ],
        down: [
          [0, 2],
          [2, 2],
        ],
      };
      const [a, b] = cells[direction]!;
      const s = stateOf([tile(1, 2, a![0], a![1]), tile(2, 2, b![0], b![1])]);
      const merged = move(s, direction).tiles.find((t) => t.isMerge)!;
      expect([merged.row, merged.col]).toEqual(dest);
      expect(merged.mergedFrom!.map((m) => [m.row, m.col])).toEqual([first, second]);
      expect(merged.mergedFrom!.map((m) => m.id).sort()).toEqual([1, 2]);
    }
  );

  it("two merges in one move each carry their own sources", () => {
    const s = stateOf([tile(1, 2, 0, 0), tile(2, 2, 0, 1), tile(3, 4, 2, 0), tile(4, 4, 2, 2)]);
    const merged = move(s, "left").tiles.filter((t) => t.isMerge);
    expect(merged).toHaveLength(2);
    const byValue = new Map(merged.map((t) => [t.value, t]));
    expect(byValue.get(4)!.mergedFrom!.map((m) => m.id)).toEqual([1, 2]);
    expect(byValue.get(8)!.mergedFrom!.map((m) => m.id)).toEqual([3, 4]);
  });

  it("a tile that only slides, and a spawned tile, have none", () => {
    const s = stateOf([tile(1, 2, 0, 3), tile(2, 4, 2, 2)]);
    for (const t of move(s, "left").tiles) {
      expect(t.isMerge).toBe(false);
      expect("mergedFrom" in t).toBe(false);
    }
  });

  it("the source ids are the old tiles' ids, which are gone from the new board", () => {
    const s = stateOf([tile(10, 2, 0, 1), tile(11, 2, 0, 3)]);
    const next = move(s, "left");
    const ids = next.tiles.map((t) => t.id);
    expect(ids).not.toContain(10);
    expect(ids).not.toContain(11);
  });

  it("adds nothing else: the board, score and tile ids are what they were without it", () => {
    const s = stateOf([tile(1, 2, 0, 0), tile(2, 2, 0, 1), tile(3, 8, 3, 3)]);
    setRng(createSeededRng(99));
    const next = move(s, "left");
    expect(next.board[0]![0]).toBe(4);
    expect(next.score).toBe(4);
    expect(next.scoreDelta).toBe(4);
    // Every other field of every tile is as before; mergedFrom is the only extra.
    for (const t of next.tiles) {
      const { mergedFrom: _from, ...rest } = t;
      expect(Object.keys(rest).sort()).toEqual(
        ["col", "id", "isMerge", "isNew", "prevCol", "prevRow", "row", "value"].sort()
      );
    }
  });
});

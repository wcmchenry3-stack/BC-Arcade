/**
 * The free-tile index of #2962: `freeTileIds`, the `freePairs` generator behind the pair
 * functions, the free set passed into `selectTile`, and `accessibleInUnplaced` on the same
 * index. Each is checked against the definition it replaces: `isFreeTile` tile by tile, and a
 * brute-force pair search over the tiles `isFreeTile` accepts, on seeded boards of every layout
 * at several stages of play, plus hand-built edge cases.
 */
import {
  accessibleInUnplaced,
  createGame,
  createSeededRng,
  freePairs,
  freeTileIds,
  getAllFreePairs,
  getAnyFreePair,
  getMatchingFreeTileIds,
  hasFreePairs,
  isFreeTile,
  selectTile,
  tilesMatch,
} from "../engine";
import { getLayout, LAYOUTS } from "../layouts/registry";
import type { MahjongState, Slot, SlotTile } from "../types";

function tile(id: number, col: number, row: number, layer = 0, faceId = 8): SlotTile {
  return { id, suit: "characters", rank: 1, faceId, col, row, layer };
}

/** The tiles `isFreeTile` accepts, by id. */
function bruteFree(tiles: readonly SlotTile[]): Set<number> {
  return new Set(tiles.filter((t) => isFreeTile(t, tiles)).map((t) => t.id));
}

/** Every matching pair of free tiles, by the definition (board order, i < j). */
function brutePairs(tiles: readonly SlotTile[]): [number, number][] {
  const free = tiles.filter((t) => isFreeTile(t, tiles));
  const pairs: [number, number][] = [];
  free.forEach((a, i) =>
    free.slice(i + 1).forEach((b) => {
      if (tilesMatch(a, b)) pairs.push([a.id, b.id]);
    })
  );
  return pairs;
}

const ids = (pairs: [SlotTile, SlotTile][]) => pairs.map(([a, b]) => [a.id, b.id]);

/**
 * Seeded boards of a layout: the deal, then the board after removing 10, 30 and 50 pairs
 * (the hint's pair each time), so blocked, uncovered and nearly empty boards all appear.
 */
function boardsOf(layoutId: string): readonly (readonly SlotTile[])[] {
  const out: (readonly SlotTile[])[] = [];
  for (const seed of [1, 2]) {
    let tiles: readonly SlotTile[] = createGame(getLayout(layoutId), seed).tiles;
    out.push(tiles);
    for (let removed = 1; removed <= 50; removed++) {
      const pair = getAnyFreePair(tiles);
      if (!pair) break;
      tiles = tiles.filter((t) => t.id !== pair[0] && t.id !== pair[1]);
      if (removed % 20 === 10) out.push(tiles);
    }
  }
  return out;
}
const BOARDS_BY_LAYOUT = LAYOUTS.map((m) => [m.id, boardsOf(m.id)] as const);
const BOARDS = BOARDS_BY_LAYOUT.flatMap(([, boards]) => boards);

describe("freeTileIds", () => {
  it("covers layered layouts at several stages of play", () => {
    expect(BOARDS.length).toBeGreaterThanOrEqual(LAYOUTS.length * 2 * 3);
    expect(BOARDS.some((tiles) => tiles.some((t) => t.layer >= 4))).toBe(true);
    expect(BOARDS.some((tiles) => tiles.length < 50)).toBe(true);
  });

  it.each(BOARDS_BY_LAYOUT)("agrees with isFreeTile for every tile (%s)", (_id, boards) => {
    for (const tiles of boards) {
      const free = freeTileIds(tiles);
      expect(tiles.map((t) => [t.id, free.has(t.id)])).toEqual(
        tiles.map((t) => [t.id, isFreeTile(t, tiles)])
      );
      expect(free.size).toBe(bruteFree(tiles).size);
    }
  });

  it("an empty board has no free tiles", () => {
    expect(freeTileIds([]).size).toBe(0);
  });

  it("a tile two layers up still covers once the layer between is gone", () => {
    const tiles = [tile(0, 4, 2, 0), tile(1, 4, 2, 2)];
    expect([...freeTileIds(tiles)]).toEqual([1]);
    expect(isFreeTile(tiles[0]!, tiles)).toBe(false);
  });

  it("only a tile in the same row and layer, two columns over, blocks a side", () => {
    // 0 is blocked on both sides; 3 and 4 sit beside it in other rows and layers.
    const tiles = [
      tile(0, 4, 0),
      tile(1, 2, 0),
      tile(2, 6, 0),
      tile(3, 2, 1),
      tile(4, 6, 0, 1),
      tile(5, 5, 0, 1), // overlapping by one column: neither blocks nor covers
    ];
    const free = freeTileIds(tiles);
    expect(free.has(0)).toBe(false);
    expect([...free].sort()).toEqual([...bruteFree(tiles)].sort());
  });

  it("negative columns and rows index like any other", () => {
    const tiles = [tile(0, -2, -1), tile(1, 0, -1), tile(2, 2, -1), tile(3, 0, -1, 1)];
    expect([...freeTileIds(tiles)].sort()).toEqual([...bruteFree(tiles)].sort());
  });
});

describe("freePairs and the pair functions", () => {
  it.each(BOARDS_BY_LAYOUT)("agree with a brute-force pair search (%s)", (_id, boards) => {
    for (const tiles of boards) {
      const expected = brutePairs(tiles);
      expect(ids([...freePairs(tiles)])).toEqual(expected);
      expect(ids(getAllFreePairs(tiles))).toEqual(expected);
      expect(hasFreePairs(tiles)).toBe(expected.length > 0);
      expect(getAnyFreePair(tiles)).toEqual(expected[0] ?? null);
    }
  });

  it("finds no pair on a board whose free tiles all differ", () => {
    // 0 and 2 match but 0 is covered; 1 and 3 are free and differ from everything free.
    const tiles = [tile(0, 0, 0), tile(1, 0, 0, 1, 9), tile(2, 8, 0), tile(3, 12, 0, 0, 20)];
    tiles[1] = { ...tiles[1]!, suit: "dragons", rank: 1 };
    tiles[3] = { ...tiles[3]!, suit: "circles", rank: 4 };
    expect(brutePairs(tiles)).toEqual([]);
    expect(hasFreePairs(tiles)).toBe(false);
    expect(getAnyFreePair(tiles)).toBeNull();
  });

  it("a free set passed in gives the same answers as the default", () => {
    for (const tiles of BOARDS.slice(0, 12)) {
      const free = freeTileIds(tiles);
      expect(getAllFreePairs(tiles, free)).toEqual(getAllFreePairs(tiles));
      expect(hasFreePairs(tiles, free)).toBe(hasFreePairs(tiles));
      expect(getAnyFreePair(tiles, free)).toEqual(getAnyFreePair(tiles));
    }
  });

  it("the pair functions use the free set they are given", () => {
    const tiles = [tile(0, 0, 0), tile(1, 2, 0), tile(2, 4, 0)];
    // By the board, 0 and 2 are free and match; told only 1 is free, nothing pairs.
    expect(hasFreePairs(tiles)).toBe(true);
    const onlyOne = new Set([1]);
    expect(hasFreePairs(tiles, onlyOne)).toBe(false);
    expect(getAnyFreePair(tiles, onlyOne)).toBeNull();
    expect(getAllFreePairs(tiles, onlyOne)).toEqual([]);
  });

  it("stops at the first pair when only one is asked for", () => {
    const tiles = createGame(getLayout("turtle"), 5).tiles;
    const gen = freePairs(tiles);
    const first = gen.next();
    expect(first.done).toBe(false);
    expect([first.value![0].id, first.value![1].id]).toEqual(getAnyFreePair(tiles));
  });
});

describe("getMatchingFreeTileIds", () => {
  const base = createGame(getLayout("turtle"), 1);
  const state = (tiles: readonly SlotTile[], selected: SlotTile | null): MahjongState => ({
    ...base,
    tiles,
    selected,
  });

  it("agrees with the definition for every tile selected, free or not", () => {
    for (const tiles of BOARDS.filter((_, i) => i % 5 === 0)) {
      const isFree = bruteFree(tiles);
      const free = freeTileIds(tiles);
      for (const sel of tiles) {
        // By the definition: free tiles other than the selection that match it.
        const expected = tiles
          .filter((t) => t.id !== sel.id && isFree.has(t.id) && tilesMatch(t, sel))
          .map((t) => t.id);
        expect([...getMatchingFreeTileIds(state(tiles, sel))]).toEqual(expected);
        expect([...getMatchingFreeTileIds(state(tiles, sel), free)]).toEqual(expected);
      }
    }
  });

  it("is empty with no selection", () => {
    expect(getMatchingFreeTileIds(state(BOARDS[0]!, null)).size).toBe(0);
  });
});

describe("selectTile with the screen's free set", () => {
  it("gives the same state as without it, tap for tap", () => {
    jest.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      let a = createGame(getLayout("turtle"), 9);
      let b = a;
      for (let n = 0; n < 40; n++) {
        const taps = [...(getAnyFreePair(a.tiles) ?? []), a.tiles[n % a.tiles.length]!.id];
        for (const id of taps) {
          a = selectTile(a, id);
          b = selectTile(b, id, freeTileIds(b.tiles));
          expect(b).toEqual(a);
        }
      }
      expect(a.pairsRemoved).toBeGreaterThan(20);
    } finally {
      jest.restoreAllMocks();
    }
  });

  it("trusts the free set it is given instead of checking the tile again", () => {
    const s = createGame(getLayout("turtle"), 4);
    const blocked = s.tiles.find((t) => !isFreeTile(t, s.tiles))!;
    const free = s.tiles.find((t) => isFreeTile(t, s.tiles))!;
    expect(selectTile(s, blocked.id)).toBe(s);
    expect(selectTile(s, blocked.id, new Set([blocked.id])).selected).toBe(blocked);
    expect(selectTile(s, free.id, new Set())).toBe(s);
  });
});

describe("accessibleInUnplaced", () => {
  /** By the definition: nothing one layer straight up, and a horizontal side open. */
  function bruteAccessible(slots: readonly Slot[], unplaced: Set<number>): number[] {
    const at = (col: number, row: number, layer: number) =>
      [...unplaced].some((j) => {
        const o = slots[j]!;
        return o.col === col && o.row === row && o.layer === layer;
      });
    return [...unplaced].filter((i) => {
      const s = slots[i]!;
      if (at(s.col, s.row, s.layer + 1)) return false;
      return !at(s.col - 2, s.row, s.layer) || !at(s.col + 2, s.row, s.layer);
    });
  }

  it.each(LAYOUTS.map((m) => [m.id] as const))(
    "matches the definition, in the unplaced set's order, as slots are taken (%s)",
    (id) => {
      const slots = getLayout(id);
      const rng = createSeededRng(id.length * 101);
      const unplaced = new Set(slots.map((_, i) => i));
      while (unplaced.size > 0) {
        expect(accessibleInUnplaced(slots, unplaced)).toEqual(bruteAccessible(slots, unplaced));
        // Take a few random slots at a time, whether accessible or not, so covered tiles with
        // a gap above them (layer + 2 placed, layer + 1 taken) appear too.
        for (let k = 0; k < 9 && unplaced.size > 0; k++) {
          const all = [...unplaced];
          unplaced.delete(all[Math.floor(rng() * all.length)]!);
        }
      }
    }
  );

  it("looks one layer up only, as the deal always has", () => {
    const slots: Slot[] = [
      { col: 0, row: 0, layer: 0 },
      { col: 0, row: 0, layer: 2 },
    ];
    expect(accessibleInUnplaced(slots, new Set([0, 1]))).toEqual([0, 1]);
    expect(accessibleInUnplaced(slots, new Set([1, 0]))).toEqual([1, 0]);
  });
});

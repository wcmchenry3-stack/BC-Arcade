/**
 * The shipped level catalog (#2761). The backend regenerates
 * `levels.catalog.json` and proves every level (backend/tests/test_sort_catalog.py);
 * these check what the app reads from it, and that it agrees with the server.
 */
import { BOARDS } from "../../../api/vocab";
import { applyPour, initState } from "../engine";
import { solve } from "../solver";
import { SORT_CATALOG_VERSION, SORT_LEVELS, decodeBottles, decodeCatalog } from "../catalog";
import { BOTTLE_DEPTH, type Color } from "../types";

// Levels per chapter (backend/sort/catalog.py CHAPTER_SIZE).
const CHAPTER_SIZE = 20;

const COLOURS: readonly Color[] = [
  "red",
  "blue",
  "green",
  "yellow",
  "orange",
  "purple",
  "pink",
  "teal",
  "brown",
  "lime",
  "navy",
  "maroon",
  "gold",
  "indigo",
];

describe("decodeCatalog", () => {
  it("numbers levels from 1 and maps letters through the legend", () => {
    const levels = decodeCatalog({
      version: 7,
      legend: ["red", "blue"],
      levels: [
        ["ABAB,BABA,,", 9],
        ["AABB,BBAA,", 5],
      ],
    });
    expect(levels).toEqual([
      {
        id: 1,
        bottles: [["red", "blue", "red", "blue"], ["blue", "red", "blue", "red"], [], []],
        par: 9,
      },
      {
        id: 2,
        bottles: [["red", "red", "blue", "blue"], ["blue", "blue", "red", "red"], []],
        par: 5,
      },
    ]);
  });

  it("rejects a letter outside the legend", () => {
    expect(() => decodeBottles("AC", ["red", "blue"])).toThrow("unknown colour C");
  });
});

describe("the shipped catalog", () => {
  it("has 120 levels in 6 chapters of 20, matching the server's board", () => {
    expect(SORT_LEVELS).toHaveLength(120);
    expect(SORT_LEVELS.length / CHAPTER_SIZE).toBe(6);
    expect(SORT_LEVELS.map((l) => l.id)).toEqual(SORT_LEVELS.map((_, i) => i + 1));
    // The server caps level_reached at the catalog's size and ranks only its version.
    expect(BOARDS.sort?.maxValue).toBe(SORT_LEVELS.length);
    expect(BOARDS.sort?.edition).toEqual(["catalog_version", SORT_CATALOG_VERSION]);
    expect(BOARDS.sort?.tiebreak).toEqual(["total_moves", "asc"]);
  });

  it("deals every level from known colours, four units each, and gives it a par", () => {
    for (const level of SORT_LEVELS) {
      const units = level.bottles.flat();
      const colours = new Set(units);
      for (const colour of colours) {
        expect(COLOURS).toContain(colour);
        expect(units.filter((u) => u === colour)).toHaveLength(BOTTLE_DEPTH);
      }
      expect(level.bottles.every((b) => b.length === 0 || b.length === BOTTLE_DEPTH)).toBe(true);
      expect(Number.isInteger(level.par) && level.par > 0).toBe(true);
    }
    expect(new Set(SORT_LEVELS[0]!.bottles.flat()).size).toBe(3);
    expect(new Set(SORT_LEVELS[119]!.bottles.flat()).size).toBe(14);
  });

  it("the app's own solver solves the first level of every chapter within par", () => {
    for (let id = 1; id <= SORT_LEVELS.length; id += CHAPTER_SIZE) {
      const level = SORT_LEVELS[id - 1]!;
      let state = initState(level.bottles as Color[][]);
      const moves = solve(state);
      expect(moves).not.toBeNull();
      for (const { from, to } of moves!) state = applyPour(state, from, to);
      expect(state.isComplete).toBe(true);
      // The backend sets par from the same search (fast_solver), plus 15%.
      expect(moves!.length).toBeLessThanOrEqual(level.par);
    }
  });
});

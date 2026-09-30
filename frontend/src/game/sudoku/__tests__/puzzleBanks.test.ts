/**
 * The packed puzzle banks the app ships (#2869) must hold exactly the
 * puzzles in the JSON source of truth, in the same order — the order matters
 * because saved games and `loadPuzzle`'s index pick refer to it.
 *
 * If this fails after regenerating puzzles.json or puzzles_mini.json, re-run
 * `npx tsx scripts/pack-sudoku-puzzles.ts` from the repo root.
 */

import classicJson from "../puzzles.json";
import miniJson from "../puzzles_mini.json";
import { PACKED_CLASSIC_BANK, PACKED_MINI_BANK } from "../puzzleBanks.generated";
import { decodePuzzleBank, decodePuzzles, encodePuzzleBank, type PuzzleBank } from "../puzzleCodec";
import { loadPuzzle } from "../engine";

describe("packed Sudoku banks", () => {
  it("Classic bank decodes to exactly puzzles.json", () => {
    expect(decodePuzzleBank(PACKED_CLASSIC_BANK, 81)).toEqual(classicJson);
  });

  it("Mini bank decodes to exactly puzzles_mini.json", () => {
    expect(decodePuzzleBank(PACKED_MINI_BANK, 36)).toEqual(miniJson);
  });

  it("loadPuzzle picks by index from the decoded bank", () => {
    const classic = classicJson as PuzzleBank;
    const mini = miniJson as PuzzleBank;
    expect(loadPuzzle("easy", "classic", () => 0).puzzle).toBe(classic.easy[0]);
    expect(loadPuzzle("hard", "classic", () => 0.9999).puzzle).toBe(
      classic.hard[classic.hard.length - 1]
    );
    expect(loadPuzzle("medium", "mini", () => 0.5).puzzle).toBe(
      mini.medium[Math.floor(0.5 * mini.medium.length)]
    );
  });
});

describe("puzzle codec", () => {
  it("round-trips a small bank", () => {
    const bank: PuzzleBank = { easy: ["1234", "0000"], medium: [], hard: ["9876"] };
    expect(decodePuzzleBank(encodePuzzleBank(bank, 4), 4)).toEqual(bank);
  });

  it("rejects puzzles of the wrong length or with non-digits", () => {
    expect(() => encodePuzzleBank({ easy: ["123"], medium: [], hard: [] }, 4)).toThrow(
      /is not 4 digits/
    );
    expect(() => encodePuzzleBank({ easy: ["12a4"], medium: [], hard: [] }, 4)).toThrow(
      /is not 4 digits/
    );
  });

  it("rejects a payload that doesn't split into whole puzzles", () => {
    const packed = encodePuzzleBank({ easy: ["1234"], medium: [], hard: [] }, 4);
    expect(() => decodePuzzles(packed.easy, 3)).toThrow(/not a multiple of 3/);
  });
});

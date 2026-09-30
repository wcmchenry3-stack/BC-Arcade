/**
 * Compact encoding for the Sudoku puzzle banks (#2869).
 *
 * `puzzles.json` (Classic) and `puzzles_mini.json` (Mini) stay the source of
 * truth: the backend generator writes them and the backend and frontend audit
 * tests read them. They are not bundled into the app. Imported as JSON they
 * cost ~370 KB of the JS bundle. Instead `scripts/pack-sudoku-puzzles.ts`
 * packs each difficulty's puzzles into one string (all puzzles joined,
 * zlib-compressed, base64-encoded) in `puzzleBanks.generated.ts`, ~155 KB in
 * all. The engine unpacks one difficulty the first time a game asks for it.
 *
 * `puzzleBanks.test.ts` checks that the generated module decodes to exactly
 * the JSON banks, so a regenerated JSON without a re-pack fails CI.
 */

import { unzlibSync, zlibSync, strFromU8, strToU8 } from "fflate";
import { base64ToBytes, bytesToBase64 } from "../_shared/base64Bytes";
import { DIFFICULTIES, type Difficulty } from "./types";

export type PuzzleBank = Record<Difficulty, readonly string[]>;
export type PackedPuzzleBank = Record<Difficulty, string>;

/** Pack a bank whose puzzles are all `cells` characters long (build-time only). */
export function encodePuzzleBank(bank: PuzzleBank, cells: number): PackedPuzzleBank {
  const out = {} as Record<Difficulty, string>;
  for (const d of DIFFICULTIES) {
    const puzzles = bank[d];
    for (const p of puzzles) {
      if (p.length !== cells || !/^[0-9]+$/.test(p)) {
        throw new Error(`encodePuzzleBank: ${d} puzzle "${p}" is not ${cells} digits`);
      }
    }
    out[d] = bytesToBase64(zlibSync(strToU8(puzzles.join("")), { level: 9 }));
  }
  return out;
}

/** Unpack one difficulty of a bank produced by `encodePuzzleBank`. */
export function decodePuzzles(packed: string, cells: number): string[] {
  const joined = strFromU8(unzlibSync(base64ToBytes(packed)));
  if (joined.length % cells !== 0) {
    throw new Error(`decodePuzzles: ${joined.length} digits is not a multiple of ${cells}`);
  }
  const puzzles: string[] = [];
  for (let i = 0; i < joined.length; i += cells) puzzles.push(joined.slice(i, i + cells));
  return puzzles;
}

/** Unpack every difficulty of a bank. */
export function decodePuzzleBank(packed: PackedPuzzleBank, cells: number): PuzzleBank {
  const out = {} as Record<Difficulty, string[]>;
  for (const d of DIFFICULTIES) out[d] = decodePuzzles(packed[d], cells);
  return out;
}

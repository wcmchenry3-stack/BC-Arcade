/**
 * Packs the Sudoku puzzle banks into the module the app ships (#2869).
 *
 * Reads frontend/src/game/sudoku/puzzles.json (Classic 9×9) and
 * puzzles_mini.json (Mini 6×6), the source of truth that
 * backend/scripts/gen_sudoku_puzzles.py writes, and writes
 * frontend/src/game/sudoku/puzzleBanks.generated.ts. Re-run it after
 * regenerating either JSON file; puzzleBanks.test.ts fails until you do.
 *
 * Usage (from the repo root):
 *   npx --prefix frontend tsx scripts/pack-sudoku-puzzles.ts
 *   (cd frontend && npx prettier --write src/game/sudoku/puzzleBanks.generated.ts)
 */

import { readFileSync, writeFileSync } from "node:fs";
import {
  encodePuzzleBank,
  type PackedPuzzleBank,
  type PuzzleBank,
} from "../frontend/src/game/sudoku/puzzleCodec";

const DIR = "frontend/src/game/sudoku";
const OUTPUT_PATH = `${DIR}/puzzleBanks.generated.ts`;

function pack(file: string, cells: number): PackedPuzzleBank {
  const bank = JSON.parse(readFileSync(`${DIR}/${file}`, "utf8")) as PuzzleBank;
  return encodePuzzleBank(bank, cells);
}

function render(name: string, packed: PackedPuzzleBank): string {
  const rows = Object.entries(packed)
    .map(([difficulty, data]) => `  ${difficulty}:\n    "${data}",`)
    .join("\n");
  return `export const ${name}: PackedPuzzleBank = {\n${rows}\n};\n`;
}

const content = `/**
 * GENERATED FILE — do not edit by hand.
 * Produced by scripts/pack-sudoku-puzzles.ts (#2869) from puzzles.json and
 * puzzles_mini.json. Format: see puzzleCodec.ts.
 */

import type { PackedPuzzleBank } from "./puzzleCodec";

${render("PACKED_CLASSIC_BANK", pack("puzzles.json", 81))}
${render("PACKED_MINI_BANK", pack("puzzles_mini.json", 36))}`;

writeFileSync(OUTPUT_PATH, content);
console.log(`Wrote ${OUTPUT_PATH} (${(content.length / 1024).toFixed(1)} KB)`);

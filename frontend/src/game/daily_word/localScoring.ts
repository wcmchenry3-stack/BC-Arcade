/**
 * On-device guess checking and scoring for offline play (#3230).
 *
 * `scoreGuess` mirrors the server's `_score_guess` (backend/daily_word/router.py)
 * exactly: exact-position matches first, then the answer's remaining letters
 * are used up left to right for wrong-position matches, so a duplicate letter
 * in the guess is "present" only while the answer has an unmatched copy left.
 * Both sides are checked against backend/tests/fixtures/daily_word_scoring.json.
 *
 * English only: Hindi stays online-only (its word list is 434 KB), so there is
 * no grapheme handling here.
 */

import type { TileResult } from "./api";
import { VALID_EN_WORDS, VALID_EN_WORD_LENGTH } from "./validWordsEn.generated";

/** Puzzle languages that can be played offline: the ones with a bundled word list. */
export const OFFLINE_LANGUAGES: readonly string[] = ["en"];

/** One tile per code point of `guess`, like the server's. */
export function scoreGuess(answer: string, guess: string): TileResult[] {
  const g = Array.from(guess);
  const a = Array.from(answer);
  const tiles: { letter: string; status: TileResult["status"] }[] = g.map((letter) => ({
    letter,
    status: "absent",
  }));
  const remaining: (string | null)[] = [...a];

  // zip(guess, answer): only positions both words have.
  for (let i = 0; i < Math.min(g.length, a.length); i++) {
    if (g[i] === a[i]) {
      tiles[i]!.status = "correct";
      remaining[i] = null;
    }
  }
  for (const tile of tiles) {
    if (tile.status === "correct") continue;
    const at = remaining.indexOf(tile.letter);
    if (at !== -1) {
      tile.status = "present";
      remaining[at] = null;
    }
  }
  return tiles;
}

/** Whether the bundled English list (the server's `_VALID_EN`) accepts `word`. */
export function isValidEnglishGuess(word: string): boolean {
  if (word.length !== VALID_EN_WORD_LENGTH) return false;
  const w = word.toLowerCase();
  let lo = 0;
  let hi = VALID_EN_WORDS.length / VALID_EN_WORD_LENGTH - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const start = mid * VALID_EN_WORD_LENGTH;
    const probe = VALID_EN_WORDS.slice(start, start + VALID_EN_WORD_LENGTH);
    if (probe === w) return true;
    if (probe < w) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

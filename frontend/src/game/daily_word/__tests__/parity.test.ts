/**
 * App side of the Daily Word scoring parity check (#3230).
 *
 * Reads the fixture backend/tests/test_daily_word_parity.py also reads, so the
 * on-device scoring and blob decoding cannot drift from the server's.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { scoreGuess, isValidEnglishGuess } from "../localScoring";
import { decodeAnswerBlob } from "../offlinePuzzles";
import { sha256 } from "../sha256";
import { VALID_EN_WORDS, VALID_EN_WORD_LENGTH } from "../validWordsEn.generated";
// resolveJsonModule is enabled via expo/tsconfig.base.
// Path: 5 levels up from __tests__/ to repo root, then into backend/tests/fixtures/.
import fixture from "../../../../../backend/tests/fixtures/daily_word_parity.json";

const REPO_ROOT = join(__dirname, "../../../../..");

describe("scoreGuess matches the server's _score_guess", () => {
  it.each(fixture.scoring.map((c) => [`${c.answer}/${c.guess}`, c] as const))("%s", (_name, c) => {
    const tiles = scoreGuess(c.answer, c.guess);
    expect(tiles.map((t) => t.status)).toEqual(c.tiles);
    expect(tiles.map((t) => t.letter)).toEqual(Array.from(c.guess));
  });
});

describe("decodeAnswerBlob reverses the server's scramble_answer", () => {
  it.each(fixture.answer_blobs.map((c) => [c.puzzle_id, c] as const))("%s", (_id, c) => {
    expect(decodeAnswerBlob(c.puzzle_id, c.answer_blob)).toBe(c.answer);
  });

  it("returns null for a blob that is not base64", () => {
    expect(decodeAnswerBlob("2026-10-13:en:2", "%%%")).toBeNull();
  });

  it("returns null for bytes that are not UTF-8", () => {
    // 0xff XOR key byte 0 of this id's digest decodes to an invalid lead byte.
    const key = sha256(new TextEncoder().encode("x"));
    const bad = btoa(String.fromCharCode(0xff ^ key[0]!));
    expect(decodeAnswerBlob("x", bad)).toBeNull();
  });
});

describe("sha256", () => {
  const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const enc = (s: string) => new TextEncoder().encode(s);

  it("matches the FIPS 180-4 test vectors", () => {
    expect(hex(sha256(enc("")))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(hex(sha256(enc("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(hex(sha256(enc("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
  });

  it("handles inputs that span block boundaries", () => {
    // 55, 56 and 64 bytes: the padding edge cases.
    const { createHash } = jest.requireActual<typeof import("crypto")>("crypto");
    for (const n of [55, 56, 63, 64, 65, 200]) {
      const data = enc("a".repeat(n));
      expect(hex(sha256(data))).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });
});

describe("the bundled English word list", () => {
  function readList(file: string): string[] {
    return readFileSync(join(REPO_ROOT, "backend/daily_word/words", file), "utf8")
      .split("\n")
      .map((w) => w.trim())
      .filter((w) => w !== "");
  }

  it("is the server's valid_en.txt + answers_en.txt (re-run pack-daily-word-valid-en.ts)", () => {
    const expected = [
      ...new Set([...readList("valid_en.txt"), ...readList("answers_en.txt")]),
    ].sort();
    expect(VALID_EN_WORDS).toBe(expected.join(""));
    expect(VALID_EN_WORDS.length).toBe(expected.length * VALID_EN_WORD_LENGTH);
  });

  it("accepts every answer and valid word, and rejects others", () => {
    for (const w of readList("answers_en.txt")) expect(isValidEnglishGuess(w)).toBe(true);
    expect(isValidEnglishGuess("aahed")).toBe(true); // first
    expect(isValidEnglishGuess("zymes")).toBe(VALID_EN_WORDS.endsWith("zymes"));
    expect(isValidEnglishGuess("CRANE")).toBe(true);
    expect(isValidEnglishGuess("xxxxx")).toBe(false);
    expect(isValidEnglishGuess("cran")).toBe(false);
    expect(isValidEnglishGuess("cranes")).toBe(false);
    // Offsets between words never match: "hedaa" spans "aahed" + "aalii".
    expect(isValidEnglishGuess("hedaa")).toBe(false);
  });
});

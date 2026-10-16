/**
 * The Daily Word puzzles fetched ahead for offline play (#3230, #3043).
 *
 * While online, `warmUpcoming` stores `GET /daily-word/upcoming` (today and
 * the next two local days, each with a scrambled answer) under
 * `daily_word_upcoming_<lang>`. Offline, the screen takes the entry for the
 * device's local day and scores guesses against its decoded answer.
 *
 * The answers stay scrambled in storage and are decoded only when played
 * (`decodeAnswerBlob`, the scheme in docs/games/daily_word.md). That stops a
 * glance at app storage from spoiling a puzzle; it is not security (#3022).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { base64ToBytes } from "../_shared/base64Bytes";
import { offlineWindowExhausted } from "../_shared/lastConnected";
import { dailyWordApi, type UpcomingPuzzle } from "./api";
import { OFFLINE_LANGUAGES } from "./localScoring";
import { sha256 } from "./sha256";

const UPCOMING_KEY_PREFIX = "daily_word_upcoming_";

const PUZZLE_ID_RE = /^\d{4}-\d{2}-\d{2}:[a-z]{2}(:\d+)?$/;

function isUpcomingPuzzle(v: unknown): v is UpcomingPuzzle {
  if (v === null || typeof v !== "object") return false;
  const p = v as Partial<UpcomingPuzzle>;
  return (
    typeof p.puzzle_id === "string" &&
    PUZZLE_ID_RE.test(p.puzzle_id) &&
    typeof p.word_length === "number" &&
    Number.isInteger(p.word_length) &&
    p.word_length > 0 &&
    typeof p.answer_blob === "string" &&
    p.answer_blob !== "" &&
    (p.display_blob === undefined || typeof p.display_blob === "string")
  );
}

/** The puzzle's local date, `YYYY-MM-DD` (the first part of its id). */
function puzzleDate(puzzleId: string): string {
  return puzzleId.split(":")[0] ?? "";
}

/** The local date `dayOffset` days from today at `tzOffsetMinutes`, `YYYY-MM-DD`. */
export function localDateString(
  tzOffsetMinutes: number,
  dayOffset = 0,
  now: number = Date.now()
): string {
  const localMs = now + tzOffsetMinutes * 60_000 + dayOffset * 86_400_000;
  return new Date(Math.floor(localMs / 86_400_000) * 86_400_000).toISOString().slice(0, 10);
}

// --- UTF-8 (Hermes has no reliable TextDecoder) ----------------------------

function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    }
  }
  return Uint8Array.from(out);
}

/** UTF-8 decode; null for a malformed sequence. */
function utf8Decode(bytes: Uint8Array): string | null {
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]!;
    let extra: number;
    if (b < 0x80) extra = 0;
    else if ((b & 0xe0) === 0xc0) extra = 1;
    else if ((b & 0xf0) === 0xe0) extra = 2;
    else if ((b & 0xf8) === 0xf0) extra = 3;
    else return null;
    let cp = extra === 0 ? b : b & (0xff >> (extra + 2));
    for (let k = 1; k <= extra; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    out += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return out;
}

/**
 * The text in a scrambled blob (`answer_blob`, and `display_blob` the same
 * way): base64-decode, XOR with SHA-256(puzzle_id)
 * repeated, UTF-8 decode. Null if the blob is not decodable.
 */
export function decodeAnswerBlob(puzzleId: string, blob: string): string | null {
  try {
    const key = sha256(utf8Encode(puzzleId));
    const data = base64ToBytes(blob);
    const plain = data.map((b, i) => b ^ key[i % key.length]!);
    const answer = utf8Decode(plain);
    return answer ? answer : null;
  } catch {
    return null;
  }
}

// --- cache -----------------------------------------------------------------

async function loadUpcoming(lang: string): Promise<UpcomingPuzzle[]> {
  try {
    const raw = await AsyncStorage.getItem(`${UPCOMING_KEY_PREFIX}${lang}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isUpcomingPuzzle) : [];
  } catch {
    return [];
  }
}

/** An offline-playable puzzle: today's metadata and its decoded answer. */
export interface OfflinePuzzle {
  readonly puzzle_id: string;
  readonly word_length: number;
  readonly answer: string;
  /** The answer's accented spelling, decoded from `display_blob` (fr/es, #3241). */
  readonly display?: string;
}

/**
 * What the cache holds for the device's local day: the puzzle, `"none"` when
 * puzzles were fetched ahead but none is for today (the backlog has run out),
 * or `"never"` when nothing was ever fetched for `lang`, which includes every
 * language that is not offline-playable.
 */
export async function findOfflinePuzzle(
  tzOffsetMinutes: number,
  lang: string,
  now: number = Date.now()
): Promise<OfflinePuzzle | "none" | "never"> {
  if (!OFFLINE_LANGUAGES.includes(lang)) return "never";
  const cached = await loadUpcoming(lang);
  if (cached.length === 0) return "never";
  const today = localDateString(tzOffsetMinutes, 0, now);
  const entry = cached.find(
    (p) => puzzleDate(p.puzzle_id) === today && p.puzzle_id.split(":")[1] === lang
  );
  if (!entry) return "none";
  const answer = decodeAnswerBlob(entry.puzzle_id, entry.answer_blob);
  if (answer === null || Array.from(answer).length !== entry.word_length) return "none";
  const display = decodedDisplay(entry);
  return {
    puzzle_id: entry.puzzle_id,
    word_length: entry.word_length,
    answer,
    ...(display === null ? {} : { display }),
  };
}

/**
 * The accented spelling in an entry's `display_blob` (#3241), decoded like its
 * answer. Null when there is none or it is not decodable.
 */
function decodedDisplay(entry: UpcomingPuzzle): string | null {
  return entry.display_blob ? decodeAnswerBlob(entry.puzzle_id, entry.display_blob) : null;
}

/** The cached accented spelling for `puzzleId`, decoded, or null when there is none (#3241). */
export async function offlineDisplayFor(puzzleId: string): Promise<string | null> {
  const lang = puzzleId.split(":")[1] ?? "";
  if (!OFFLINE_LANGUAGES.includes(lang)) return null;
  const entry = (await loadUpcoming(lang)).find((p) => p.puzzle_id === puzzleId);
  return entry ? decodedDisplay(entry) : null;
}

/** The cached answer for `puzzleId`, decoded, or null when it is not cached. */
export async function offlineAnswerFor(puzzleId: string): Promise<string | null> {
  const lang = puzzleId.split(":")[1] ?? "";
  if (!OFFLINE_LANGUAGES.includes(lang)) return null;
  const entry = (await loadUpcoming(lang)).find((p) => p.puzzle_id === puzzleId);
  return entry ? decodeAnswerBlob(entry.puzzle_id, entry.answer_blob) : null;
}

/**
 * The puzzle to play offline today (#3230): the cached one for the device's
 * local day, `"exhausted"` once the offline window is used up (no cached
 * puzzle for today, or `offlineWindowExhausted`), or null when offline play
 * does not apply (an online-only language, or nothing ever fetched ahead and
 * the window not used up), so the caller keeps its online-only fallback.
 */
export async function resolveOfflinePuzzle(
  tzOffsetMinutes: number,
  lang: string,
  now: number = Date.now()
): Promise<OfflinePuzzle | "exhausted" | null> {
  if (!OFFLINE_LANGUAGES.includes(lang)) return null;
  const found = await findOfflinePuzzle(tzOffsetMinutes, lang, now);
  const exhausted = await offlineWindowExhausted(now);
  if (found === "never") return exhausted ? "exhausted" : null;
  if (found === "none" || exhausted) return "exhausted";
  return found;
}

/**
 * Fetch and store the puzzles ahead for `lang`, unless the cache already
 * reaches the last day a fetch now would return. Only offline-playable
 * languages are fetched. Best-effort: every failure is swallowed.
 */
export async function warmUpcoming(tzOffsetMinutes: number, lang: string): Promise<void> {
  if (!OFFLINE_LANGUAGES.includes(lang)) return;
  try {
    const lastDay = localDateString(tzOffsetMinutes, 2);
    const cached = await loadUpcoming(lang);
    if (cached.some((p) => puzzleDate(p.puzzle_id) >= lastDay)) return;
    const fetched: unknown = await dailyWordApi.getUpcoming(tzOffsetMinutes, lang);
    if (!Array.isArray(fetched)) return;
    const puzzles = fetched.filter(isUpcomingPuzzle);
    if (puzzles.length === 0) return;
    await AsyncStorage.setItem(`${UPCOMING_KEY_PREFIX}${lang}`, JSON.stringify(puzzles));
  } catch {
    // Warming is an optimisation only.
  }
}

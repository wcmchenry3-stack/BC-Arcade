/**
 * daily_word.ts — helpers for Daily Word e2e specs (#1254).
 *
 * Mirrors the pattern in helpers/sort.ts / helpers/hearts.ts.
 */

import { Page } from "@playwright/test";
import { installEntitlementsMock } from "./api-mock";
import type { DailyWordState } from "../../../frontend/src/game/daily_word/types";

const STORAGE_KEY = "daily_word_state_v1";

// ---------------------------------------------------------------------------
// Default mock data
// ---------------------------------------------------------------------------

const DEFAULT_PUZZLE_ID = "2026-05-03:en";
const DEFAULT_WORD_LENGTH = 5;

/** Default GET /today response */
const TODAY_RESPONSE = {
  puzzle_id: DEFAULT_PUZZLE_ID,
  word_length: DEFAULT_WORD_LENGTH,
};

/** Default POST /guess response — all absent */
const ABSENT_TILES = Array.from({ length: DEFAULT_WORD_LENGTH }, (_, i) => ({
  letter: "crane"[i] ?? "a",
  status: "absent",
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const FRESH_STATE: DailyWordState = {
  _v: 1,
  puzzle_id: DEFAULT_PUZZLE_ID,
  word_length: DEFAULT_WORD_LENGTH,
  language: "en",
  rows: Array.from({ length: 6 }, () => ({
    tiles: Array.from({ length: DEFAULT_WORD_LENGTH }, () => ({
      letter: "",
      status: "empty" as const,
    })),
    submitted: false,
  })),
  current_row: 0,
  keyboard_state: {},
  is_complete: false,
  won: false,
  completed_at: null,
};

/** 2 guesses typed but not submitted */
export const MID_GAME_STATE: DailyWordState = {
  ...FRESH_STATE,
  rows: FRESH_STATE.rows.map((row, i) => {
    if (i === 0) {
      return {
        tiles: [
          { letter: "s", status: "correct" },
          { letter: "t", status: "absent" },
          { letter: "o", status: "absent" },
          { letter: "r", status: "present" },
          { letter: "e", status: "absent" },
        ],
        submitted: true,
      };
    }
    if (i === 1) {
      return {
        tiles: [
          { letter: "b", status: "absent" },
          { letter: "r", status: "correct" },
          { letter: "a", status: "absent" },
          { letter: "i", status: "absent" },
          { letter: "n", status: "absent" },
        ],
        submitted: true,
      };
    }
    return row;
  }),
  current_row: 2,
  keyboard_state: {
    s: "correct",
    t: "absent",
    o: "absent",
    r: "correct",
    e: "absent",
    b: "absent",
    a: "absent",
    i: "absent",
    n: "absent",
  },
};

/** Won on row 3 (3 guesses) */
export const WIN_STATE: DailyWordState = {
  ...FRESH_STATE,
  rows: FRESH_STATE.rows.map((row, i) => {
    if (i === 0) {
      return {
        tiles: Array.from("store", (letter) => ({ letter, status: "absent" as const })),
        submitted: true,
      };
    }
    if (i === 1) {
      return {
        tiles: Array.from("brain", (letter) => ({ letter, status: "absent" as const })),
        submitted: true,
      };
    }
    if (i === 2) {
      return {
        tiles: Array.from("crane", (letter) => ({
          letter,
          status: "correct" as const,
        })),
        submitted: true,
      };
    }
    return row;
  }),
  current_row: 3,
  keyboard_state: {
    s: "absent",
    t: "absent",
    o: "absent",
    r: "absent",
    e: "correct",
    b: "absent",
    a: "correct",
    i: "absent",
    n: "correct",
    c: "correct",
  },
  is_complete: true,
  won: true,
  completed_at: "2026-05-03T12:00:00.000Z",
};

/** Lost — 6 guesses used, won=false */
export const LOSS_STATE: DailyWordState = {
  ...FRESH_STATE,
  rows: Array.from({ length: 6 }, () => ({
    tiles: Array.from("store", (letter) => ({
      letter,
      status: "absent" as const,
    })),
    submitted: true,
  })),
  current_row: 6,
  is_complete: true,
  won: false,
  completed_at: "2026-05-03T12:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Route mocking
// ---------------------------------------------------------------------------

export interface MockDailyWordApiOptions {
  /** Override for POST /guess response tiles */
  guessTiles?: Array<{ letter: string; status: string }>;
  /** Override for GET /answer response */
  answer?: string;
}

export async function mockDailyWordApi(
  page: Page,
  options: MockDailyWordApiOptions = {}
): Promise<void> {
  await page.route("**/daily-word/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes("/daily-word/today")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(TODAY_RESPONSE),
      });
    } else if (url.includes("/daily-word/guess") && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tiles: options.guessTiles ?? ABSENT_TILES }),
      });
    } else if (url.includes("/daily-word/answer")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ answer: options.answer ?? "crane" }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

export async function gotoDailyWord(page: Page): Promise<void> {
  await installEntitlementsMock(page);
  await mockDailyWordApi(page);
  await page.goto("/");
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.getByRole("button", { name: "Play Daily Word" }).click();
  await page.getByRole("heading", { name: "Daily Word" }).waitFor({ timeout: 10_000 });
}

export async function injectDailyWordState(
  page: Page,
  state: Partial<DailyWordState>
): Promise<void> {
  await installEntitlementsMock(page);
  await mockDailyWordApi(page);
  await page.goto("/");
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key as string, JSON.stringify(value)),
    [STORAGE_KEY, state] as const
  );
  await page.goto("/");
}

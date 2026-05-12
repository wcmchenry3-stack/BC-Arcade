/**
 * mahjong-persistence.spec.ts — GH #1146
 *
 * Persistence: inject a mid-game state (score=100, pairsRemoved=5), navigate
 * to Mahjong, verify the HUD reflects the injected values, navigate away,
 * return, and confirm the values are unchanged.
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { mockMahjongApi, injectMahjongState } from "./helpers/mahjong";

const MID_GAME_STATE = {
  _v: 1,
  tiles: [],
  pairsRemoved: 5,
  score: 100,
  shufflesLeft: 2,
  selected: null,
  undoStack: [],
  isComplete: false,
  isDeadlocked: false,
  startedAt: null,
  accumulatedMs: 5000,
  dealId: "abcd",
};

test("SCORE and PAIRS persist after navigating away and back", async ({ page }) => {
  await mockMahjongApi(page);
  await injectMahjongState(page, MID_GAME_STATE);

  await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
  await page
    .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
    .waitFor({ timeout: 10_000 });

  await expect(page.getByText(/^SCORE\s+100/).first()).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/^PAIRS\s+5\/72/).first()).toBeVisible({ timeout: 5_000 });

  // Navigate away — MahjongScreen saves state on every state change.
  await page.goto("/");
  await page.getByText("BC Arcade").first().waitFor();

  // Return to Mahjong.
  await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
  await page
    .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
    .waitFor({ timeout: 10_000 });

  // Injected score and pairs should survive the round-trip.
  await expect(page.getByText(/^SCORE\s+100/).first()).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/^PAIRS\s+5\/72/).first()).toBeVisible({ timeout: 5_000 });
});

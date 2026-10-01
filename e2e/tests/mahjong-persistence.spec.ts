/**
 * mahjong-persistence.spec.ts — GH #1146
 *
 * Persistence: inject a mid-game state (5 s played, pairsRemoved=5), navigate
 * to Mahjong, verify the HUD reflects the injected values, navigate away,
 * return, and confirm the values are unchanged.
 *
 * No running backend is needed: the routes this spec depends on are
 * intercepted with page.route(), and any other call (such as SyncWorker's
 * game sync) fails, which the app handles like being offline.
 */

import { test, expect } from "@playwright/test";
import { injectMahjongState } from "./helpers/mahjong";

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

test("play clock and PAIRS persist after navigating away and back", async ({ page }) => {
  await injectMahjongState(page, MID_GAME_STATE);

  await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
  await page
    .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
    .waitFor({ timeout: 10_000 });

  // The clock carries the 5 s banked in the save (#2747): never reset to 0:00.
  await expect(page.getByText(/^TIME\s+\d+:\d{2}$/).first()).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/^TIME\s+0:0[0-4]$/)).toHaveCount(0);
  await expect(page.getByText(/^PAIRS\s+5\/72/).first()).toBeVisible({ timeout: 5_000 });

  // Navigate away — MahjongScreen saves state on every state change.
  await page.goto("/");
  await page.getByText("BC Arcade").first().waitFor();

  // Return to Mahjong.
  await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
  await page
    .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
    .waitFor({ timeout: 10_000 });

  // Injected play time and pairs should survive the round-trip.
  // The clock carries the 5 s banked in the save (#2747): never reset to 0:00.
  await expect(page.getByText(/^TIME\s+\d+:\d{2}$/).first()).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/^TIME\s+0:0[0-4]$/)).toHaveCount(0);
  await expect(page.getByText(/^PAIRS\s+5\/72/).first()).toBeVisible({ timeout: 5_000 });
});

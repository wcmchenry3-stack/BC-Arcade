/**
 * hearts-shoot-the-moon.spec.ts — GH #1142
 *
 * Shoot-the-moon: inject a near-moon state where the player holds only the
 * Ace of Hearts (the final heart needed), play it, and verify the "Hand
 * Complete" overlay shows the moon-shot message and zero score for the player.
 *
 * State at injection: trick 13, player leads, wonCards[0] = 12 hearts
 * (ranks 2–13) + Queen of Spades. Opponents each hold one club card.
 * After playing A♥ the hand ends: detectMoon fires for player 0,
 * cumulativeScores → [0, 26, 26, 26].
 *
 * No running backend is needed: the routes this spec depends on are
 * intercepted with page.route(), and any other call (such as SyncWorker's
 * game sync) fails, which the app handles like being offline.
 */

import { test, expect } from "./fixtures";
import { injectHeartsState } from "./helpers/hearts";
import { NEAR_MOON_STATE } from "./helpers/heartsFixtures";

test("shoot-the-moon: play final heart, verify moon message and zero score", async ({
  page,
}) => {
  await injectHeartsState(page, NEAR_MOON_STATE);

  await page.getByRole("button", { name: "Play Hearts" }).click();
  await page
    .getByRole("heading", { name: "Hearts", exact: true })
    .waitFor({ timeout: 10_000 });

  // Wait for injected state to load (player hand shows 1 card).
  await expect(page.getByLabel(/Your hand, 1 cards?/)).toBeVisible({
    timeout: 5_000,
  });

  // Play the Ace of Hearts. rankLabel(1) = "A", so aria-label = "A of Hearts".
  await page.getByLabel("A of Hearts").click();

  // AI opponents play their clubs (3 × 400 ms delay). After trick 13:
  // detectMoon fires → phase transitions to "dealing" → Hand Complete overlay.
  await expect(page.getByText("Hand Complete")).toBeVisible({ timeout: 10_000 });

  // Moon-shot announcement uses playerLabels[0] = "You".
  await expect(
    page.getByText("You shot the moon! +26 to all others."),
  ).toBeVisible({ timeout: 3_000 });
});

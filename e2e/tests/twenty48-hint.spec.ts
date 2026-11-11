/**
 * twenty48-hint.spec.ts — #3688
 *
 * The Hint button (the action bar Mahjong shares) replaces the always-on instruction lines:
 *   no "Swipe to move tiles" / "Or use arrow keys" → Hint shows an arrow + "Swipe left or ←"
 *   for 2 s → a swipe (arrow key) clears it and still moves.
 */

import { test, expect } from "@playwright/test";
import {
  gotoTwenty48,
  injectGameState,
  midGameState,
} from "./helpers/twenty48";

test.describe("2048 — hint", () => {
  test("the always-on instruction lines are gone; a Hint button is in the action bar", async ({
    page,
  }) => {
    await gotoTwenty48(page);
    await expect(page.getByText("Swipe to move tiles")).toHaveCount(0);
    await expect(page.getByText("Or use arrow keys")).toHaveCount(0);
    const bar = page.getByTestId("twenty48-action-bar");
    await expect(
      bar.getByRole("button", {
        name: "Show a hint: suggests a swipe for 2 seconds",
      }),
    ).toBeVisible();
  });

  test("Hint shows the suggested swipe, then clears after 2 s", async ({
    page,
  }) => {
    await injectGameState(page, midGameState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    await page.getByTestId("twenty48-hint-button").click();
    const text = page.getByTestId("twenty48-hint-text");
    await expect(text).toHaveText(/^Swipe (up|down|left|right) or [←→↑↓]$/);
    await expect(page.getByTestId("twenty48-hint")).toHaveCount(0, {
      timeout: 4000,
    });
  });

  test("a swipe clears the hint and still moves the tiles", async ({
    page,
  }) => {
    await injectGameState(
      page,
      midGameState({
        board: [
          [2, 2, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
      }),
    );
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    await page.getByTestId("twenty48-hint-button").click();
    // The only merge is the pair in row 0: left (first of left / right).
    await expect(page.getByTestId("twenty48-hint-text")).toHaveText(
      "Swipe left or ←",
    );
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("twenty48-hint")).toHaveCount(0);
    await expect(page.getByLabel(/^Current score: 4$/)).toBeVisible();
  });
});

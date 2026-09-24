/**
 * twenty48-win-flow.spec.ts — GH #209
 *
 * Win-state + keep-playing flow:
 *   Inject near-win → merge → win overlay → Continue → play on → New Game resets
 */

import { test, expect } from "@playwright/test";
import {
  injectGameState,
  nearWinState,
  wonState,
  gameOverState,
} from "./helpers/twenty48";

test.describe("2048 — win-state + keep-playing flow", () => {
  test("win overlay appears after reaching 2048", async ({ page }) => {
    await injectGameState(page, nearWinState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    // Win overlay should NOT be visible yet (hasn't hit 2048)
    await expect(page.getByText("You Win!")).not.toBeVisible();

    // ArrowLeft merges two 1024s in row 0 → 2048 tile created
    await page.keyboard.press("ArrowLeft");

    await expect(page.getByText("You Win!")).toBeVisible({ timeout: 5000 });
  });

  test("win overlay shows Continue and New Game buttons", async ({ page }) => {
    await injectGameState(page, nearWinState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();
    await page.keyboard.press("ArrowLeft");
    await page.getByText("You Win!").waitFor();

    await expect(
      page.getByRole("button", {
        name: "Continue playing after reaching 2048",
      }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("twenty48-result")
        .getByRole("button", { name: "Play Again" }),
    ).toBeVisible();
  });

  test("Continue dismisses win overlay and allows further play", async ({
    page,
  }) => {
    await injectGameState(page, nearWinState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();
    await page.keyboard.press("ArrowLeft");
    await page.getByText("You Win!").waitFor();

    await page
      .getByRole("button", { name: "Continue playing after reaching 2048" })
      .click();

    // Overlay gone
    await expect(page.getByText("You Win!")).not.toBeVisible({ timeout: 3000 });

    // Can still make moves — board accepts input
    const emptyBefore = await page.getByLabel("empty").count();
    await page.keyboard.press("ArrowRight");
    // Either a tile spawned (empty count dropped) or it was a no-op — either is
    // fine; we just verify no error/overlay reappears
    await expect(page.getByText("You Win!")).not.toBeVisible();
    // Empty count should not increase (no tiles disappear)
    const emptyAfter = await page.getByLabel("empty").count();
    expect(emptyAfter).toBeLessThanOrEqual(emptyBefore);
  });

  test("win overlay does NOT reappear after Continue on subsequent moves", async ({
    page,
  }) => {
    await injectGameState(page, nearWinState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();
    await page.keyboard.press("ArrowLeft");
    await page.getByText("You Win!").waitFor();
    await page
      .getByRole("button", { name: "Continue playing after reaching 2048" })
      .click();

    // Make several more moves
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      await page.keyboard.press(key);
    }
    await expect(page.getByText("You Win!")).not.toBeVisible();
  });

  test("New Game from win overlay starts fresh", async ({ page }) => {
    await injectGameState(page, nearWinState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();
    await page.keyboard.press("ArrowLeft");
    await page.getByText("You Win!").waitFor();

    // Click New Game inside the overlay (nth(1) = overlay button, first() is header)
    await page
      .getByTestId("twenty48-result")
      .getByRole("button", { name: "Play Again" })
      .click();

    // Overlay gone, score reset to 0
    await expect(page.getByText("You Win!")).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator('[aria-label="Current score: 0"]')).toBeVisible({
      timeout: 3000,
    });
  });

  test("win overlay does NOT show when has_won=true but game_over=true", async ({
    page,
  }) => {
    // Inject won + game_over simultaneously (edge case from Twenty48Screen:144)
    await injectGameState(page, gameOverState({ has_won: true }));
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor({ timeout: 5000 });

    await expect(page.getByText("You Win!")).not.toBeVisible();
    await expect(page.getByText("Game Over")).toBeVisible();
  });

  test("win overlay reappears after New Game + reaching 2048 again", async ({
    page,
  }) => {
    // Start with a won state and dismiss it
    await injectGameState(page, nearWinState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();
    await page.keyboard.press("ArrowLeft");
    await page.getByText("You Win!").waitFor();
    await page
      .getByTestId("twenty48-result")
      .getByRole("button", { name: "Play Again" })
      .click();
    await expect(page.locator('[aria-label="Current score: 0"]')).toBeVisible({
      timeout: 3000,
    });

    // Inject another near-win into storage, reload, navigate back in
    await page.evaluate(
      (s) => localStorage.setItem("twenty48_game_v2", JSON.stringify(s)),
      nearWinState(),
    );
    await page.reload();
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();
    await page.keyboard.press("ArrowLeft");

    // Win overlay must reappear (winDismissed was reset by New Game)
    await expect(page.getByText("You Win!")).toBeVisible({ timeout: 5000 });
  });

  test("Home button in win overlay navigates back to Home", async ({
    page,
  }) => {
    await injectGameState(page, wonState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByText("You Win!").waitFor();

    await page
      .getByTestId("twenty48-result")
      .getByRole("button", { name: "Home" })
      .click();

    await expect(page.getByText("BC Arcade").first()).toBeVisible({
      timeout: 10000,
    });
  });
});

/**
 * twenty48-persistence.spec.ts — GH #212
 *
 * State persistence across reload + New Game path:
 *   Inject state → verify board → reload → same board
 *   Navigate away + back → state preserved
 *   Game-over → storage cleared
 *   Corrupted storage → fresh new game
 */

import { test, expect } from "@playwright/test";
import {
  injectGameState,
  midGameState,
  gameOverState,
  wonState,
} from "./helpers/twenty48";

test.describe("2048 — state persistence", () => {
  test("injected mid-game state loads on navigation to 2048", async ({
    page,
  }) => {
    await injectGameState(page, midGameState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    // midGameState has score=0, tiles at [1][1]=4 and [2][2]=2
    await expect(page.locator('[aria-label="Current score: 0"]')).toBeVisible();
    // Two non-empty tiles: "4" and "2"
    await expect(page.locator('[aria-label="4"]').first()).toBeVisible();
    await expect(page.locator('[aria-label="2"]').first()).toBeVisible();
  });

  test("board and score survive a page reload", async ({ page }) => {
    // Use default midGameState — tiles slide (no merge) on ArrowLeft, spawning one new tile
    await injectGameState(page, midGameState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    // Make a move so saveGame() is called with the new state
    const emptyBefore = await page.getByLabel("empty").count();
    await page.keyboard.press("ArrowLeft");
    // After slide + spawn, one more tile exists → one fewer empty
    await expect(page.getByLabel("empty")).toHaveCount(emptyBefore - 1, {
      timeout: 3000,
    });

    // Reload — should resume from the saved state (tile count preserved, not reset)
    await page.reload();
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    // After reload the board should still have the extra tile (emptyBefore - 1), not a fresh 14
    await expect(page.getByLabel("empty")).toHaveCount(emptyBefore - 1, {
      timeout: 3000,
    });
  });

  test("state preserved when navigating away and back", async ({ page }) => {
    await injectGameState(page, midGameState({ score: 64 }));
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();
    await expect(
      page.locator('[aria-label="Current score: 64"]'),
    ).toBeVisible();

    // Navigate home via URL (Lobby tab pop-to-root not reliable on web)
    await page.goto("/");
    await page.getByText("BC Arcade").first().waitFor();

    // Return to 2048
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    // Score preserved
    await expect(
      page.locator('[aria-label="Current score: 64"]'),
    ).toBeVisible();
  });

  test("game-over state: localStorage cleared automatically", async ({
    page,
  }) => {
    await injectGameState(page, gameOverState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByText("Game Over").waitFor();

    // clearGame() fires via the useEffect on game_over=true
    const stored = await page.evaluate(() =>
      localStorage.getItem("twenty48_game_v2"),
    );
    expect(stored).toBeNull();
  });

  test("reload after game-over starts a fresh game", async ({ page }) => {
    await injectGameState(page, gameOverState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByText("Game Over").waitFor();

    // localStorage was cleared → reload → newGame()
    await page.reload();
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    await expect(page.locator('[aria-label="Current score: 0"]')).toBeVisible();
    await expect(page.getByLabel("empty")).toHaveCount(14);
    await expect(page.getByText("Game Over")).not.toBeVisible();
  });

  test("corrupted localStorage falls back to a fresh new game", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() =>
      localStorage.setItem("twenty48_game_v2", "garbage{not json}"),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    await expect(page.locator('[aria-label="Current score: 0"]')).toBeVisible();
    await expect(page.getByLabel("empty")).toHaveCount(14);
  });

  test("shape-drift (missing required field) falls back to fresh game", async ({
    page,
  }) => {
    await page.goto("/");
    // Missing 'board' field — fails the sanity check in loadGame()
    await page.evaluate(() =>
      localStorage.setItem(
        "twenty48_game_v2",
        JSON.stringify({ score: 100, game_over: false, has_won: false }),
      ),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    await expect(page.locator('[aria-label="Current score: 0"]')).toBeVisible();
  });

  test("New Game is always reachable from mid-game", async ({ page }) => {
    await injectGameState(page, midGameState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    const newGameBtn = page.getByRole("button", {
      name: "Start a new 2048 game",
    });
    await expect(newGameBtn).toBeVisible();
    await newGameBtn.click();

    await expect(page.locator('[aria-label="Current score: 0"]')).toBeVisible({
      timeout: 3000,
    });
  });

  test("New Game from win overlay resets winDismissed and has_won", async ({
    page,
  }) => {
    await injectGameState(page, wonState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByText("You Win!").waitFor();

    await page
      .getByTestId("twenty48-result")
      .getByRole("button", { name: "Play Again" })
      .click();

    await expect(page.locator('[aria-label="Current score: 0"]')).toBeVisible({
      timeout: 3000,
    });
    await expect(page.getByText("You Win!")).not.toBeVisible();

    // Verify the saved state has has_won=false
    const stored = await page.evaluate(() =>
      localStorage.getItem("twenty48_game_v2"),
    );
    const parsed = JSON.parse(stored ?? "{}");
    expect(parsed.has_won).toBe(false);
    expect(parsed.score).toBe(0);
  });

  test("New Game from game-over overlay resets and saves fresh state", async ({
    page,
  }) => {
    await injectGameState(page, gameOverState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByText("Game Over").waitFor();

    await page
      .getByTestId("twenty48-result")
      .getByRole("button", { name: "Play Again" })
      .click();

    await expect(page.locator('[aria-label="Current score: 0"]')).toBeVisible({
      timeout: 3000,
    });

    const stored = await page.evaluate(() =>
      localStorage.getItem("twenty48_game_v2"),
    );
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.game_over).toBe(false);
    expect(parsed.score).toBe(0);
  });
});

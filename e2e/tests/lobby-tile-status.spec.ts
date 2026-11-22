/**
 * lobby-tile-status.spec.ts — #4008
 *
 * The lobby tile says what is stored on this device: a 2048 game in progress shows "In progress"
 * in place of its description and a "Resume" button, and tapping it opens the same board. A tile
 * with nothing stored keeps its description and "Play".
 */
import { test, expect } from "./fixtures";
import { injectGameState, midGameState } from "./helpers/twenty48";

const DESCRIPTION = "Slide and merge tiles to reach 2048.";

test.describe("Lobby tile status (#4008)", () => {
  test("a 2048 game in progress shows Resume, and the tap opens the same board", async ({
    page,
  }) => {
    await injectGameState(page, midGameState({ score: 64 }));

    const tile = page.getByTestId("game-tile-twenty48");
    await expect(tile).toContainText("In progress");
    await expect(page.getByTestId("game-btn-twenty48")).toHaveText("Resume");
    await expect(page.getByText(DESCRIPTION)).toHaveCount(0);
    // Screen readers: the label keeps the Play label and adds the status.
    await expect(tile).toHaveAttribute(
      "aria-label",
      "Play 2048 — in progress, tap to resume",
    );

    await tile.click();
    await page.getByLabel("Game board").waitFor();
    await expect(
      page.locator('[aria-label="Current score: 64"]'),
    ).toBeVisible();
    await expect(page.locator('[aria-label="4"]').first()).toBeVisible();
    await expect(page.locator('[aria-label="2"]').first()).toBeVisible();
  });

  test("a tile with nothing stored keeps its description and Play, and starts a new game", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("twenty48_game_v2"));
    await page.goto("/");

    await expect(page.getByText(DESCRIPTION)).toBeVisible();
    await expect(page.getByTestId("game-btn-twenty48")).toHaveText("Play");
    await expect(page.getByTestId("game-status-twenty48")).toHaveCount(0);

    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();
    await expect(page.locator('[aria-label="Current score: 0"]')).toBeVisible();
  });
});

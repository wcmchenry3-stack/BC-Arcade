/**
 * mahjong-layout-select.spec.ts — GH #1695
 *
 * E2E coverage for layout selection, unlock flow, and game resume:
 *   1. Locked layouts show lock icon and are non-interactive
 *   2. Completing a game unlocks the next layout in the grid
 *   3. A saved game on a non-default layout resumes on the correct layout
 */

import { test, expect } from "@playwright/test";
import { mockMahjongApi, injectMahjongFull } from "./helpers/mahjong";

const PROGRESS_TURTLE_ONLY = {
  unlockedLayouts: ["turtle"],
  currentLayoutId: null,
  currentState: null,
};

const PROGRESS_TURTLE_PYRAMID = {
  unlockedLayouts: ["turtle", "pyramid"],
  currentLayoutId: "pyramid",
  currentState: null,
};

const MID_GAME_PYRAMID = {
  _v: 1,
  tiles: [],
  pairsRemoved: 7,
  score: 70,
  shufflesLeft: 3,
  selected: null,
  undoStack: [],
  isComplete: false,
  isDeadlocked: false,
  startedAt: null,
  accumulatedMs: 35_000,
  dealId: "cafe",
  currentLayoutId: "pyramid",
};

const COMPLETED_TURTLE_GAME = {
  _v: 1,
  tiles: [],
  pairsRemoved: 72,
  score: 1220,
  shufflesLeft: 3,
  selected: null,
  undoStack: [],
  isComplete: true,
  isDeadlocked: false,
  startedAt: null,
  accumulatedMs: 120_000,
  dealId: "beef",
  currentLayoutId: "turtle",
};

test.describe("Mahjong — layout select screen", () => {
  test.beforeEach(async ({ page }) => {
    await mockMahjongApi(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("mahjong_game");
      localStorage.removeItem("mahjong_stats_v1");
      localStorage.removeItem("@mahjong/progress");
    });
  });

  test("locked layouts show lock label and are non-interactive", async ({
    page,
  }) => {
    // With only turtle unlocked (default), all other layouts should appear locked.
    await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
    await page
      .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
      .waitFor({ timeout: 10_000 });

    // Layout select appears because there is no saved game.
    await page
      .getByRole("heading", { name: "Choose Layout", exact: true })
      .waitFor({ timeout: 5_000 });

    // Pyramid is locked by default — shows the locked accessibility label.
    const pyramidBtn = page.getByRole("button", {
      name: /^Pyramid.*locked/i,
    });
    await expect(pyramidBtn).toBeVisible({ timeout: 5_000 });
    await expect(pyramidBtn).toBeDisabled();
  });

  test("turtle layout is unlocked and interactive by default", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
    await page
      .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
      .waitFor({ timeout: 10_000 });
    await page
      .getByRole("heading", { name: "Choose Layout", exact: true })
      .waitFor({ timeout: 5_000 });

    // Turtle is the only unlocked layout — its button should be enabled.
    const turtleBtn = page.getByRole("button", { name: "Turtle", exact: true });
    await expect(turtleBtn).toBeVisible({ timeout: 5_000 });
    await expect(turtleBtn).toBeEnabled();
  });

  test("completing a game unlocks the next layout in the grid", async ({
    page,
  }) => {
    // Inject a completed turtle game with only turtle unlocked.
    // MahjongScreen fires the win lifecycle on initial load when the persisted
    // state is already complete (prevCompleteRef starts false → isComplete true
    // transition triggers unlockNextLayout on first render).
    await injectMahjongFull(page, COMPLETED_TURTLE_GAME, PROGRESS_TURTLE_ONLY);

    await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
    await page
      .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
      .waitFor({ timeout: 10_000 });

    // The win modal should appear because the loaded game is complete.
    await page
      .getByRole("button", { name: "Start a new game" })
      .waitFor({ timeout: 10_000 });

    // Dismiss the win modal — this triggers the layout select screen.
    await page.getByRole("button", { name: "Start a new game" }).click();

    await page
      .getByRole("heading", { name: "Choose Layout", exact: true })
      .waitFor({ timeout: 5_000 });

    // Pyramid should now be unlocked after completing turtle.
    const pyramidBtn = page.getByRole("button", {
      name: "Pyramid",
      exact: true,
    });
    await expect(pyramidBtn).toBeVisible({ timeout: 5_000 });
    await expect(pyramidBtn).toBeEnabled();
  });

  test("resume saved game on correct layout after app restart", async ({
    page,
  }) => {
    // Inject a mid-game pyramid state along with progress that has pyramid unlocked.
    await injectMahjongFull(page, MID_GAME_PYRAMID, PROGRESS_TURTLE_PYRAMID);

    await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
    await page
      .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
      .waitFor({ timeout: 10_000 });

    // With a saved game, the app resumes directly in play view (no layout select).
    await expect(page.getByText(/^SCORE\s+70/).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/^PAIRS\s+7\/72/).first()).toBeVisible({
      timeout: 5_000,
    });

    // Verify the active game is specifically the pyramid layout.
    const gameState = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("mahjong_game") ?? "null"),
    );
    expect(gameState?.currentLayoutId).toBe("pyramid");

    // Simulate an app restart by navigating away and back.
    await page.goto("/");
    await page.getByText("BC Arcade").first().waitFor();

    await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
    await page
      .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
      .waitFor({ timeout: 10_000 });

    // State should survive the restart.
    await expect(page.getByText(/^SCORE\s+70/).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/^PAIRS\s+7\/72/).first()).toBeVisible({
      timeout: 5_000,
    });
  });
});

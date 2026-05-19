/**
 * twenty48-a11y.spec.ts — GH #213
 *
 * Keyboard controls, accessibility labels, and axe-core scan for 2048.
 * Arrow keys + WASD, tile/grid/score ARIA labels, overlay button roles.
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  gotoTwenty48,
  injectGameState,
  midGameState,
  gameOverState,
  nearWinState,
  wonState,
} from "./helpers/twenty48";

test.describe("2048 — keyboard controls", () => {
  test("ArrowLeft fires a move", async ({ page }) => {
    await injectGameState(page, midGameState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    const emptyBefore = await page.getByLabel("empty").count();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByLabel("empty")).toHaveCount(emptyBefore - 1, {
      timeout: 3000,
    });
  });

  test("ArrowRight fires a move", async ({ page }) => {
    await injectGameState(page, midGameState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    const emptyBefore = await page.getByLabel("empty").count();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByLabel("empty")).toHaveCount(emptyBefore - 1, {
      timeout: 3000,
    });
  });

  test("ArrowUp fires a move", async ({ page }) => {
    await injectGameState(page, midGameState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    const emptyBefore = await page.getByLabel("empty").count();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByLabel("empty")).toHaveCount(emptyBefore - 1, {
      timeout: 3000,
    });
  });

  test("ArrowDown fires a move", async ({ page }) => {
    await injectGameState(page, midGameState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    const emptyBefore = await page.getByLabel("empty").count();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByLabel("empty")).toHaveCount(emptyBefore - 1, {
      timeout: 3000,
    });
  });

  test("W fires up move", async ({ page }) => {
    await injectGameState(page, midGameState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    const emptyBefore = await page.getByLabel("empty").count();
    await page.keyboard.press("w");
    await expect(page.getByLabel("empty")).toHaveCount(emptyBefore - 1, {
      timeout: 3000,
    });
  });

  test("S fires down move", async ({ page }) => {
    await injectGameState(page, midGameState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    const emptyBefore = await page.getByLabel("empty").count();
    await page.keyboard.press("s");
    await expect(page.getByLabel("empty")).toHaveCount(emptyBefore - 1, {
      timeout: 3000,
    });
  });

  test("A fires left move", async ({ page }) => {
    await injectGameState(page, midGameState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    const emptyBefore = await page.getByLabel("empty").count();
    await page.keyboard.press("a");
    await expect(page.getByLabel("empty")).toHaveCount(emptyBefore - 1, {
      timeout: 3000,
    });
  });

  test("D fires right move", async ({ page }) => {
    await injectGameState(page, midGameState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    const emptyBefore = await page.getByLabel("empty").count();
    await page.keyboard.press("d");
    await expect(page.getByLabel("empty")).toHaveCount(emptyBefore - 1, {
      timeout: 3000,
    });
  });

  test("uppercase WASD also fire moves", async ({ page }) => {
    await injectGameState(page, midGameState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    // At least one uppercase key fires a valid move
    const emptyBefore = await page.getByLabel("empty").count();
    for (const key of ["W", "A", "S", "D"]) {
      await page.keyboard.press(key);
    }
    const emptyAfter = await page.getByLabel("empty").count();
    expect(emptyAfter).toBeLessThan(emptyBefore);
  });

  test("arrow keys are ignored when game_over=true", async ({ page }) => {
    await injectGameState(page, gameOverState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByText("Game Over").waitFor();

    const emptyBefore = await page.getByLabel("empty").count();
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      await page.keyboard.press(key);
    }
    await expect(page.getByLabel("empty")).toHaveCount(emptyBefore);
  });
});

test.describe("2048 — accessibility labels", () => {
  test("each non-empty tile has an accessibility label matching its value", async ({
    page,
  }) => {
    await injectGameState(
      page,
      midGameState({
        board: [
          [4, 2, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
      }),
    );
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    await expect(page.locator('[aria-label="4"]').first()).toBeVisible();
    await expect(page.locator('[aria-label="2"]').first()).toBeVisible();
  });

  test("empty tiles have accessibility label 'empty'", async ({ page }) => {
    await injectGameState(page, midGameState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    // midGameState has 14 empty cells
    await expect(page.getByLabel("empty")).toHaveCount(14);
  });

  test("grid has accessible label 'Game board'", async ({ page }) => {
    await gotoTwenty48(page);
    await expect(page.getByLabel("Game board")).toBeVisible();
  });

  test("score element has accessibility label with current score", async ({
    page,
  }) => {
    await injectGameState(page, midGameState({ score: 128 }));
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    await expect(
      page.locator('[aria-label="Current score: 128"]'),
    ).toBeVisible();
  });

  test("New Game button has accessible role and label", async ({ page }) => {
    await gotoTwenty48(page);
    await expect(
      page.getByRole("button", { name: "Start a new 2048 game" }),
    ).toBeVisible();
  });

  test("win overlay buttons have accessible roles", async ({ page }) => {
    await injectGameState(page, wonState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByText("You Win!").waitFor();

    await expect(
      page.getByRole("button", {
        name: "Continue playing after reaching 2048",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start a new 2048 game" }).first(),
    ).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: "Quit and return to home screen" })
        .first(),
    ).toBeVisible();
  });

  test("game-over overlay buttons have accessible roles", async ({ page }) => {
    await injectGameState(page, gameOverState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByText("Game Over").waitFor();

    await expect(
      page.getByRole("button", { name: "Start a new 2048 game" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Quit and return to home screen" }),
    ).toBeVisible();
  });
});

test.describe("2048 — axe-core scans", () => {
  test("no axe violations on betting (start) phase", async ({ page }) => {
    await gotoTwenty48(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("no axe violations during active game (mid-game)", async ({ page }) => {
    await injectGameState(page, midGameState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByLabel("Game board").waitFor();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("no axe violations on win overlay", async ({ page }) => {
    await injectGameState(page, wonState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByText("You Win!").waitFor();
    // AnimationOverlay fades in over 300 ms. Two overlays share the testID
    // (win + game-over), so filter to the one containing this overlay's text.
    // Mid-animation opacity composites effective fg/bg against the page,
    // deflating contrast ratios — wait for 1 before running axe (#1743).
    await expect(
      page.getByTestId("animation-overlay").filter({ has: page.getByText("You Win!") }),
    ).toHaveCSS("opacity", "1");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("no axe violations on game-over overlay", async ({ page }) => {
    await injectGameState(page, gameOverState());
    await page.getByRole("button", { name: "Play 2048" }).click();
    await page.getByText("Game Over").waitFor();
    // AnimationOverlay fades in over 300 ms. Two overlays share the testID
    // (win + game-over), so filter to the one containing this overlay's text.
    // Mid-animation opacity composites effective fg/bg against the page,
    // deflating contrast ratios — wait for 1 before running axe (#1743).
    await expect(
      page.getByTestId("animation-overlay").filter({ has: page.getByText("Game Over") }),
    ).toHaveCSS("opacity", "1");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

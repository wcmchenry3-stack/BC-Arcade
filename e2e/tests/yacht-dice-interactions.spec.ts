/**
 * yacht-dice-interactions.spec.ts
 *
 * GH #182 — Dice hold/unhold interactions.
 *
 * After the first roll, the player can tap individual dice to hold them
 * so they are excluded from subsequent rolls. Tapping again unholds.
 */

import { test, expect } from "./fixtures";

test.describe("Yacht — dice hold/unhold (#182)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("yacht_game_v1"));
    await page.goto("/");
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();
  });

  test("five die buttons appear after rolling", async ({ page }) => {
    await page.getByRole("button", { name: /Roll/i }).click();
    for (let i = 1; i <= 5; i++) {
      await expect(
        page.getByRole("button", { name: new RegExp(`Die ${i}: showing \\d`) }),
      ).toBeVisible();
    }
  });

  test("die buttons are disabled before first roll", async ({ page }) => {
    // Before rolling, dice show blank — buttons are disabled
    for (let i = 1; i <= 5; i++) {
      await expect(
        page.getByRole("button", { name: new RegExp(`Die ${i}:`) }),
      ).toBeDisabled();
    }
  });

  test("clicking a die after rolling marks it as held", async ({ page }) => {
    await page.getByRole("button", { name: /Roll/i }).click();

    const die1 = page.getByRole("button", { name: /Die 1: showing \d/ });
    await expect(die1).toBeVisible();
    await die1.click();

    // After holding, the accessibility label includes ", held"
    await expect(
      page.getByRole("button", { name: /Die 1: showing \d+, held/ }),
    ).toBeVisible();
  });

  test("holding a die preserves its value on the next roll", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Roll/i }).click();

    const die1 = page.getByRole("button", { name: /Die 1: showing \d/ });
    await expect(die1).toBeVisible();

    // Read the current value of die 1
    const labelBefore = (await die1.getAttribute("aria-label")) ?? "";
    const valueBefore = labelBefore.match(/showing (\d)/)?.[1];

    // Hold die 1
    await die1.click();
    await expect(
      page.getByRole("button", { name: /Die 1: showing \d+, held/ }),
    ).toBeVisible();

    // Roll again (die 1 should not change)
    await page.getByRole("button", { name: /Roll/i }).click();
    await expect(page.getByRole("button", { name: /Roll/i })).toBeVisible();

    // Die 1 should still show the same value
    if (valueBefore) {
      await expect(
        page.getByRole("button", {
          name: new RegExp(`Die 1: showing ${valueBefore}(, held)?`),
        }),
      ).toBeVisible();
    }
  });

  test("clicking a held die unholds it", async ({ page }) => {
    await page.getByRole("button", { name: /Roll/i }).click();

    // Hold die 2
    const die2 = page.getByRole("button", { name: /Die 2: showing \d/ });
    await die2.click();
    await expect(
      page.getByRole("button", { name: /Die 2: showing \d+, held/ }),
    ).toBeVisible();

    // Unhold die 2
    await page
      .getByRole("button", { name: /Die 2: showing \d+, held/ })
      .click();
    await expect(
      page.getByRole("button", { name: /Die 2: showing \d+(?!, held)/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Die 2: showing \d+, held/ }),
    ).not.toBeVisible();
  });

  test("held dice are reset to unheld at the start of a new turn (after scoring)", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Roll/i }).click();

    // Hold die 1
    await page.getByRole("button", { name: /Die 1: showing \d/ }).click();
    await expect(
      page.getByRole("button", { name: /Die 1: showing \d+, held/ }),
    ).toBeVisible();

    // Score Chance to end the turn
    await page.getByRole("button", { name: /Chance: potential score/ }).click();
    await expect(page.getByText("Round 2 / 13")).toBeVisible();

    // On the new turn, die buttons are disabled (no roll yet) and not held
    await expect(
      page.getByRole("button", { name: /Die 1: showing \d+, held/ }),
    ).not.toBeVisible();
  });

  test("holding multiple dice preserves all their values on next roll", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Roll/i }).click();

    // Hold dice 3 and 5
    await page.getByRole("button", { name: /Die 3: showing \d/ }).click();
    await page.getByRole("button", { name: /Die 5: showing \d/ }).click();

    await expect(
      page.getByRole("button", { name: /Die 3: showing \d+, held/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Die 5: showing \d+, held/ }),
    ).toBeVisible();

    const die3LabelBefore =
      (await page
        .getByRole("button", { name: /Die 3: showing \d+, held/ })
        .getAttribute("aria-label")) ?? "";
    const die5LabelBefore =
      (await page
        .getByRole("button", { name: /Die 5: showing \d+, held/ })
        .getAttribute("aria-label")) ?? "";
    const val3 = die3LabelBefore.match(/showing (\d)/)?.[1];
    const val5 = die5LabelBefore.match(/showing (\d)/)?.[1];

    // Second roll
    await page.getByRole("button", { name: /Roll/i }).click();

    if (val3) {
      await expect(
        page.getByRole("button", {
          name: new RegExp(`Die 3: showing ${val3}`),
        }),
      ).toBeVisible();
    }
    if (val5) {
      await expect(
        page.getByRole("button", {
          name: new RegExp(`Die 5: showing ${val5}`),
        }),
      ).toBeVisible();
    }
  });
});

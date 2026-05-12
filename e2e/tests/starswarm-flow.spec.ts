/**
 * starswarm-flow.spec.ts
 *
 * E2E smoke tests for the Star Swarm game.
 *
 * Canvas content is not DOM-inspectable, so tests focus on:
 *   - Navigation (Home → Star Swarm → Back → Home)
 *   - Accessibility labels (canvas role, charge shot button)
 *   - App stability under pointer and keyboard input
 *
 * API endpoints are mocked so tests are hermetic (no running backend required).
 */

import { test, expect } from "./fixtures";
import { mockStarswarmApi } from "./helpers/starswarm";

test.describe("Star Swarm — navigation and smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    await mockStarswarmApi(page);
  });

  test("navigates from Home to Star Swarm screen", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Play Star Swarm" }).click();
    await expect(
      page.getByRole("heading", { name: "Star Swarm", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("game canvas is present with correct accessibility label", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Play Star Swarm" }).click();
    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("charge-shot button is absent from active play UI", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Play Star Swarm" }).click();
    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: /Charge shot/i }),
    ).not.toBeAttached();
  });

  test("drag interaction on canvas does not crash the game", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Play Star Swarm" }).click();

    const canvas = page.getByRole("img", { name: /Star Swarm game/i });
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    const box = await canvas.boundingBox();
    if (box) {
      // Drag across the lower portion of the canvas (player movement zone)
      await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.8);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.8);
      await page.mouse.up();
    }

    // Canvas must still be present (no crash/navigate-away)
    await expect(canvas).toBeVisible({ timeout: 3_000 });
  });

  test("multiple drags across the canvas do not cause a crash", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Play Star Swarm" }).click();

    const canvas = page.getByRole("img", { name: /Star Swarm game/i });
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    const box = await canvas.boundingBox();
    if (box) {
      for (let i = 0; i < 4; i++) {
        const startX = box.x + (box.width / 5) * (i + 1);
        const endX = box.x + (box.width / 5) * (i + 2);
        const y = box.y + box.height * 0.85;
        await page.mouse.move(startX, y);
        await page.mouse.down();
        await page.mouse.move(endX, y);
        await page.mouse.up();
      }
    }

    await expect(canvas).toBeVisible({ timeout: 3_000 });
  });

  test("arrow-key movement does not crash the game", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Play Star Swarm" }).click();
    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");

    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("navigating away from Star Swarm returns to Home", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Play Star Swarm" }).click();
    await expect(
      page.getByRole("heading", { name: "Star Swarm", exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    await page.goto("/");

    await expect(page.getByText("BC Arcade").first()).toBeVisible({
      timeout: 5_000,
    });
  });
});

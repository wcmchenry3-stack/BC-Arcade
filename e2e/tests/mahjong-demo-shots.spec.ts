/**
 * mahjong-demo-shots.spec.ts — GH #3804
 *
 * The web counterpart of the Maestro demo flows `e2e/maestro/flows/mahjong/demo-open.yaml`
 * and `demo-zoom.yaml` (#3801). Web draws Mahjong on Canvas2D, iOS and Android on Skia, so a
 * look that differs between them goes unnoticed. In a test build (`EXPO_PUBLIC_TEST_HOOKS=1`,
 * which the Playwright web build sets) Mahjong deals the same fixed board (`E2E_DEAL_SEED`,
 * #3803) as the Maestro run, so these shots can be put side by side with the Maestro ones.
 *
 * The screenshots keep the Maestro names (`mahjong-demo-open.png`, `mahjong-demo-zoom.png`) and
 * are written to `e2e/test-results/mahjong-demo/`, which the `Playwright E2E` job uploads in the
 * `playwright-report` artifact. They are a CI artifact for a person to look at: no pixel
 * assertion, only that the board is visible (and zoomed, for the zoom shot) and the files were written.
 *
 * "Settled": the run uses reduced motion (so no deal-in or camera ease runs; the app reads
 * `prefers-reduced-motion`), and the board canvas must then draw the same pixels on several
 * reads in a row. The tile faces load after the first paint (suit-colour fallbacks first), so
 * the test build marks the canvas `data-faces-loaded` once they are in (GameCanvas.web.tsx);
 * the spec waits for that, then for the pixels to stop changing (the repaint follows the load).
 */

import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, statSync } from "fs";
import { join } from "path";
import { gotoMahjong } from "./helpers/mahjong";
import { installEntitlementsMock } from "./helpers/api-mock";

/** Where the PNGs land: under `test-results/`, which CI uploads (see the header). */
const SHOT_DIR = join(__dirname, "..", "test-results", "mahjong-demo");

// The Maestro flows run on a phone; Turtle fits at about 25.6 px a tile on 390 x 844.
test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

/** A cheap fingerprint of the board canvas's pixels. */
async function boardFingerprint(page: Page): Promise<string> {
  return page
    .getByRole("img", { name: /Mahjong Solitaire/i })
    .evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      const url = canvas.toDataURL();
      // Length plus a sample of the data is enough to tell two different frames apart.
      return `${url.length}:${url.slice(-256)}`;
    });
}

/** Resolves once the faces are loaded and the board has drawn the same pixels on `STABLE_READS` reads in a row. */
async function waitForBoardSettled(page: Page): Promise<void> {
  await expect(
    page.getByRole("img", { name: /Mahjong Solitaire/i }),
  ).toHaveAttribute("data-faces-loaded", "true", { timeout: 15_000 });
  const STABLE_READS = 5;
  let last = "";
  let same = 0;
  await expect
    .poll(
      async () => {
        const now = await boardFingerprint(page);
        same = now === last ? same + 1 : 0;
        last = now;
        return same >= STABLE_READS;
      },
      { timeout: 15_000, intervals: [250] },
    )
    .toBe(true);
}

async function saveShot(page: Page, name: string): Promise<string> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const path = join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

test.describe("Mahjong — web demo screenshots for the Maestro comparison (#3804)", () => {
  test.beforeEach(async ({ page }) => {
    await installEntitlementsMock(page);
    await page.goto("/");
    // A clean start, so the layout picker deals the fixed board.
    await page.evaluate(() => localStorage.removeItem("mahjong_game"));
    // Open Mahjong, pick Turtle if the picker shows (gotoMahjong), then the viewport.
    await gotoMahjong(page);
    await expect(page.getByTestId("mahjong-board-viewport")).toBeVisible({
      timeout: 15_000,
    });
    await waitForBoardSettled(page);
  });

  test("mahjong-demo-open: the untouched Turtle board", async ({ page }) => {
    const path = await saveShot(page, "mahjong-demo-open");
    await expect(page.getByTestId("mahjong-board-viewport")).toBeVisible();
    expect(statSync(path).size).toBeGreaterThan(10_000);
  });

  test("mahjong-demo-zoom: after a double-tap on the board viewport", async ({
    page,
  }) => {
    const board = page.getByRole("img", { name: /Mahjong Solitaire/i });
    const fit = (await board.boundingBox())!;
    // The centre of the board viewport, as Maestro's `doubleTapOn: id: mahjong-board-viewport`
    // does (demo-zoom.yaml): the zoom centres on the tap, so the two shots frame the same tiles.
    const viewport = (await page
      .getByTestId("mahjong-board-viewport")
      .boundingBox())!;
    await page.mouse.dblclick(
      viewport.x + viewport.width / 2,
      viewport.y + viewport.height / 2,
    );
    // The zoom is a CSS transform, so the canvas pixels don't show it: check the box grew.
    await expect
      .poll(async () => (await board.boundingBox())!.width)
      .toBeGreaterThan(fit.width * 1.5);
    await expect(page.getByTestId("mahjong-minimap")).toBeVisible();
    await waitForBoardSettled(page);
    const path = await saveShot(page, "mahjong-demo-zoom");
    expect(statSync(path).size).toBeGreaterThan(10_000);
  });
});

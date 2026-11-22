/**
 * sudoku-motion.spec.ts — #3774
 *
 * The motion of a move ("Calm"): the solving digit runs a wave along the board and the result card
 * follows it by about a second, never earlier; under Reduce Motion the card is up at once with no
 * beat; an illegal digit marks its cell instead of flashing the screen.
 *
 * The page records every frame from before the move (`requestAnimationFrame`), with the board's
 * state, whether the card shows and whether the wave's mark is up. The test then reads the
 * frames: no wall-clock round trip between Playwright and the page is in the measurement.
 */

import { test, expect, type Page } from "@playwright/test";
import { installEntitlementsMock } from "./helpers/api-mock";
import { injectSudokuState, nearSolvedSudokuState } from "./helpers/sudoku";

interface Frame {
  /** performance.now() of the frame. */
  t: number;
  /** The board's cells differ from the snapshot taken before the move. */
  landed: boolean;
  /** The result card ("You Win!") is showing. */
  card: boolean;
  /** The solved wave's mark is in the page. */
  beat: boolean;
}

async function open(page: Page, extraEmpty: number[] = []): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await installEntitlementsMock(page);
  await injectSudokuState(page, nearSolvedSudokuState(extraEmpty));
  await page.getByRole("button", { name: "Play Sudoku" }).click();
  await page
    .getByRole("heading", { name: "Sudoku", exact: true })
    .waitFor({ timeout: 10_000 });
  const lastCell = page.getByRole("button", {
    name: "Cell row 9, column 9, empty",
  });
  await expect(lastCell).toBeVisible({ timeout: 5_000 });
  await lastCell.click();
}

/**
 * Starts the page's frame recorder. The board is snapshotted inside this awaited call, so the
 * snapshot is taken before the key is pressed, and every frame from here on is recorded.
 */
async function startRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const CELLS = '[data-testid^="sudoku-cell-"][aria-label]';
    const read = () =>
      Array.from(document.querySelectorAll(CELLS))
        .map((el) => el.getAttribute("aria-label"))
        .join("|");
    const cardShows = () =>
      Array.from(document.querySelectorAll("body *")).some((el) => {
        if (el.textContent !== "You Win!") return false;
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      });
    const before = read();
    const rec = { frames: [] as Frame[], stop: false, landed: false };
    (window as unknown as { __rec: typeof rec }).__rec = rec;
    const tick = () => {
      rec.landed ||= read() !== before;
      rec.frames.push({
        t: performance.now(),
        landed: rec.landed,
        card: cardShows(),
        beat: !!document.querySelector('[data-testid="sudoku-solved-wave"]'),
      });
      if (!rec.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopRecording(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    const rec = (
      window as unknown as { __rec: { frames: unknown[]; stop: boolean } }
    ).__rec;
    rec.stop = true;
    return rec.frames as Frame[];
  });
}

/** Presses the solving digit and returns the frames until the card shows. */
async function solve(page: Page): Promise<Frame[]> {
  await startRecording(page);
  await page.getByRole("button", { name: "Enter digit 5" }).click();
  await expect(page.getByText("You Win!")).toBeVisible({ timeout: 10_000 });
  // A few frames past the card, to see the wave's mark go.
  await page.waitForTimeout(150);
  return stopRecording(page);
}

test.describe("Sudoku — motion (#3774)", () => {
  test("the card follows the solving move by about a second, with the wave running until then", async ({
    page,
  }) => {
    await open(page);
    const frames = await solve(page);

    const landedAt = frames.findIndex((f) => f.landed);
    expect(landedAt).toBeGreaterThanOrEqual(0);
    const t0 = frames[landedAt].t;
    const sinceMove = (f: Frame) => f.t - t0;

    // The very frame the move lands in already has the beat and no card: it never flashes early.
    expect(frames[landedAt].card).toBe(false);
    expect(frames[landedAt].beat).toBe(true);

    // About 400 ms in: the wave is running and there is no card.
    const early = frames.filter((f) => f.landed && sinceMove(f) < 400);
    expect(early.length).toBeGreaterThan(3);
    expect(early.every((f) => !f.card && f.beat)).toBe(true);

    // The card shows within 2.5 s, no sooner than the beat, and the wave's mark goes with it.
    const cardAt = frames.findIndex((f) => f.card);
    expect(cardAt).toBeGreaterThan(landedAt);
    expect(sinceMove(frames[cardAt])).toBeGreaterThan(900);
    expect(sinceMove(frames[cardAt])).toBeLessThan(2500);
    expect(frames[cardAt].beat).toBe(false);
    // It stays up once it shows.
    expect(frames.slice(cardAt).every((f) => f.card)).toBe(true);
  });

  test("an illegal digit marks its cell, not the screen", async ({ page }) => {
    await open(page, [0]);
    await page.getByRole("button", { name: "Enter digit 1" }).click();
    await expect(page.getByTestId("sudoku-cell-8-8-error")).toHaveCount(1);
    await expect(page.getByTestId("sudoku-invalid-flash")).toHaveCount(0);
    await expect(page.getByTestId("sudoku-unit-flash")).toHaveCount(0);
    // It is a single run: the cell's pulse is back to nothing shortly after.
    await expect
      .poll(
        () =>
          page
            .getByTestId("sudoku-cell-8-8-error")
            .evaluate((el) => Number(getComputedStyle(el).opacity)),
        { timeout: 3000 },
      )
      .toBe(0);
  });

  test.describe("Reduce Motion", () => {
    test.use({ reducedMotion: "reduce" });
    // On CI the context option alone didn't reach the page (matchMedia read false, #3725), so
    // the page's media is also set directly; it holds across the navigations in the test.
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
    });

    test("the card is up within a few frames of the solving move, with no beat", async ({
      page,
    }) => {
      await open(page);
      // The page sees Reduce Motion before anything is measured.
      expect(
        await page.evaluate(
          () => matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
      ).toBe(true);
      // And the board has settled after the restore.
      await page.waitForTimeout(500);

      const frames = await solve(page);
      const landedAt = frames.findIndex((f) => f.landed);
      expect(landedAt).toBeGreaterThanOrEqual(0);
      const cardAt = frames.findIndex((f) => f.card);
      expect(cardAt).toBeGreaterThanOrEqual(landedAt);
      // Counted in frames: the card is up on the first frame (1, measured idle); the beat is ~60.
      expect(cardAt - landedAt + 1).toBeLessThanOrEqual(5);
      expect(frames.some((f) => f.beat)).toBe(false);
      await expect(page.getByTestId("sudoku-solved-wave")).toHaveCount(0);
    });

    test("an illegal digit shows only its static style: no pulse", async ({
      page,
    }) => {
      await open(page, [0]);
      expect(
        await page.evaluate(
          () => matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
      ).toBe(true);
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: "Enter digit 1" }).click();
      await expect(
        page.getByRole("button", { name: /Cell row 9, column 9, 1,/ }),
      ).toBeVisible();
      await expect(page.getByTestId("sudoku-cell-8-8-error")).toHaveCount(0);
    });
  });
});

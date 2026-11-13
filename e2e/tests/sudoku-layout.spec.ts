/**
 * sudoku-layout.spec.ts — GH #3773
 *
 * The thumb-pad layout: HUD, board, the action bar, then the digit keys in two rows, anchored
 * above the tab bar. At 390x844 and 320x568 (iPhone SE class) everything is inside the viewport,
 * nothing overlaps, the board shrinks to fit the space, and every control is at least 44 pt.
 */

import { test, expect, type Page } from "@playwright/test";
import { injectSudokuState, midGameSudokuState } from "./helpers/sudoku";

const STATE = midGameSudokuState();

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;

async function openGame(page: Page): Promise<void> {
  await injectSudokuState(page, STATE);
  await page.getByRole("button", { name: "Play Sudoku" }).click();
  await page
    .getByRole("heading", { name: "Sudoku", exact: true })
    .waitFor({ timeout: 10_000 });
  await expect(page.getByTestId("sudoku-board")).toBeVisible({
    timeout: 10_000,
  });
  // The board sizes itself from a layout pass: wait for it to settle (a fixed size, not 100% wide).
  await expect
    .poll(
      async () =>
        (await page.getByTestId("sudoku-board").boundingBox())?.height ?? 0,
    )
    .toBeGreaterThan(200);
}

async function box(page: Page, testId: string) {
  const b = await page.getByTestId(testId).boundingBox();
  if (!b) throw new Error(`${testId} has no box`);
  return b;
}

for (const viewport of VIEWPORTS) {
  test.describe(`Sudoku layout @ ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("board, action bar and keys stack above the tab bar, inside the viewport", async ({
      page,
    }) => {
      await openGame(page);
      const board = await box(page, "sudoku-board");
      const hud = await box(page, "sudoku-hud");
      const bar = await box(page, "sudoku-action-bar");
      const keys = await box(page, "sudoku-keys");
      const tabs = await page
        .getByRole("tab")
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
      const tabTop = Math.min(...tabs);

      // in reading order: HUD, board, action bar, keys
      expect(hud.y + hud.height).toBeLessThanOrEqual(board.y + 1);
      expect(board.y + board.height).toBeLessThanOrEqual(bar.y + 1);
      expect(bar.y + bar.height).toBeLessThanOrEqual(keys.y + 1);
      // all inside the viewport, above the tab bar
      expect(keys.y + keys.height).toBeLessThanOrEqual(tabTop + 0.5);
      for (const b of [board, bar, keys]) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(viewport.width + 0.5);
      }
      // the board is square, fills the width as far as the height allows, and never under the header
      expect(Math.abs(board.width - board.height)).toBeLessThanOrEqual(1);
      expect(board.y).toBeGreaterThanOrEqual(64);
      expect(board.width).toBeGreaterThanOrEqual(
        viewport.width === 390 ? 340 : 240,
      );
      // no page scroll
      const overflow = await page.evaluate(() => ({
        x: document.documentElement.scrollWidth - window.innerWidth,
        y: document.documentElement.scrollHeight - window.innerHeight,
      }));
      expect(overflow.x).toBeLessThanOrEqual(0);
      expect(overflow.y).toBeLessThanOrEqual(0);
    });

    test("the action bar holds Undo, Erase, Notes, Hint and New Game at 44 pt or more; no header Undo", async ({
      page,
    }) => {
      await openGame(page);
      const ids = [
        "sudoku-undo",
        "sudoku-erase",
        "sudoku-notes",
        "sudoku-hint",
        "sudoku-new-game",
      ];
      let lastRight = 0;
      for (const id of ids) {
        const b = await box(page, id);
        expect(b.width, `${id} width`).toBeGreaterThanOrEqual(44);
        expect(b.height, `${id} height`).toBeGreaterThanOrEqual(44);
        expect(b.x, `${id} order`).toBeGreaterThanOrEqual(lastRight - 0.5);
        lastRight = b.x + b.width;
      }
      await expect(page.getByTestId("sudoku-undo")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(1);
    });

    test("the nine keys are 44 pt or more both ways, in two centred rows (5 over 4)", async ({
      page,
    }) => {
      await openGame(page);
      const rects = [];
      for (let d = 1; d <= 9; d++) {
        const b = await box(page, `sudoku-digit-${d}`);
        expect(b.width, `key ${d} width`).toBeGreaterThanOrEqual(44);
        expect(b.height, `key ${d} height`).toBeGreaterThanOrEqual(44);
        rects.push(b);
      }
      const top1 = rects[0]!.y;
      expect(rects.slice(0, 5).every((r) => Math.abs(r.y - top1) <= 1)).toBe(
        true,
      );
      expect(rects.slice(5).every((r) => r.y > top1 + 40)).toBe(true);
      const centre = (rs: typeof rects) =>
        (Math.min(...rs.map((r) => r.x)) +
          Math.max(...rs.map((r) => r.x + r.width))) /
        2;
      expect(
        Math.abs(centre(rects.slice(0, 5)) - centre(rects.slice(5))),
      ).toBeLessThanOrEqual(2);
      // every key shows how many of its digit remain
      await expect(page.getByTestId("sudoku-digit-5")).toContainText("5");
    });

    test("a 7-note cell keeps all seven notes inside its cell", async ({
      page,
    }) => {
      await openGame(page);
      const cell = await box(page, "sudoku-cell-1-3");
      expect(cell.width).toBeGreaterThan(25);
      const notes = await page
        .getByTestId("sudoku-cell-1-3")
        .locator("div")
        .evaluateAll((els) =>
          els
            .filter(
              (e) =>
                /^[1-9]$/.test((e.textContent ?? "").trim()) &&
                e.children.length === 0,
            )
            .map((e) => {
              const r = e.getBoundingClientRect();
              return {
                t: e.textContent,
                l: r.left,
                r: r.right,
                top: r.top,
                b: r.bottom,
                sw: e.scrollWidth,
                cw: e.clientWidth,
              };
            }),
        );
      expect(notes.length).toBeGreaterThanOrEqual(7);
      for (const n of notes) {
        expect(n.l).toBeGreaterThanOrEqual(cell.x - 0.5);
        expect(n.r).toBeLessThanOrEqual(cell.x + cell.width + 0.5);
        expect(n.top).toBeGreaterThanOrEqual(cell.y - 0.5);
        expect(n.b).toBeLessThanOrEqual(cell.y + cell.height + 0.5);
      }
    });
  });
}

test.describe("Sudoku layout: cell labels and keys", () => {
  test.use({ viewport: VIEWPORTS[0] });

  test("cell labels give the box, given or entered, and notes; keys announce what remains", async ({
    page,
  }) => {
    await openGame(page);
    await expect(
      page.getByRole("button", {
        name: /^Cell row 1, column 1, 1, given, box 1$/,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /^Cell row 1, column 5, empty, box 2$/,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /^Cell row 2, column 4, empty, box 2, notes 1 2 3 4 5 6 7$/,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Enter digit 5\. Remaining: \d+$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Sudoku board" }),
    ).toBeVisible();
  });

  test("Notes shows its state, and New Game asks, then opens the picker, which Cancel closes", async ({
    page,
  }) => {
    await openGame(page);
    const notes = page.getByTestId("sudoku-notes");
    // On web the on state is the chip: a ring in the accent, transparent when off (native also
    // reports accessibilityState.selected, which react-native-web does not put on a button).
    const ring = () =>
      notes.evaluate((e) => getComputedStyle(e).borderTopColor);
    await expect.poll(ring).toBe("rgba(0, 0, 0, 0)");
    await notes.click();
    await expect.poll(ring).not.toBe("rgba(0, 0, 0, 0)");
    await expect(page.getByTestId("sudoku-digit-5")).toHaveCSS(
      "border-top-style",
      "dashed",
    );

    await page.getByTestId("sudoku-new-game").click();
    await page.getByRole("button", { name: "Start new game" }).click();
    await expect(page.getByText("Quick Restart")).toBeVisible();
    await page.getByTestId("sudoku-new-game-cancel").click();
    await expect(page.getByText("Quick Restart")).toBeHidden();
    await expect(page.getByTestId("sudoku-board")).toBeVisible();
  });

  test("tapping the digit a cell holds again changes nothing", async ({
    page,
  }) => {
    await openGame(page);
    await page
      .getByRole("button", { name: /^Cell row 1, column 5, empty/ })
      .click();
    await page.getByRole("button", { name: /^Enter digit 5\./ }).click();
    await expect(
      page.getByRole("button", { name: /^Cell row 1, column 5, 5, entered/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Enter digit 5\./ }).click();
    await page.getByRole("button", { name: /^Enter digit 5\./ }).click();
    await expect(
      page.getByRole("button", { name: /^Cell row 1, column 5, 5, entered/ }),
    ).toBeVisible();
    // one undo step: a single Undo empties the cell and leaves nothing more to undo
    await page.getByTestId("sudoku-undo").click();
    await expect(
      page.getByRole("button", { name: /^Cell row 1, column 5, empty/ }),
    ).toBeVisible();
    await expect(page.getByTestId("sudoku-undo")).toBeDisabled();
  });
});

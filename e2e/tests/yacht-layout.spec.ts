/**
 * yacht-layout.spec.ts — #3748 (epic #3682)
 *
 * The Yacht thumb tray on a phone: one scorecard for solo and VS with all 13 rows, the subtotal
 * band and the total on screen at 390x844 (no tabs, no scrolling), the tray under it (turn hint,
 * five dice, Roll and the action bar), the Hint in solo only, and the dice and the held ring
 * staying inside the card at 320 pt.
 */

import { test, expect, type Page } from "./fixtures";
import { gotoYacht } from "./helpers/yacht";

const ROWS = [
  "ones",
  "twos",
  "threes",
  "fours",
  "fives",
  "sixes",
  "three_of_a_kind",
  "four_of_a_kind",
  "full_house",
  "small_straight",
  "large_straight",
  "yacht",
  "chance",
];

const PHONE = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };

async function gotoYachtVs(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("yacht_game_v2"));
  await page.goto("/");
  await page.getByRole("button", { name: "Play Yacht" }).click();
  await page.getByRole("radio", { name: /^Easy$/i }).click();
  await page.getByRole("button", { name: /^VS Computer$/i }).click();
  await page.getByText("Round 1 / 13").waitFor();
}

/** All 13 rows, the band and the total are inside the viewport and the card does not scroll. */
async function expectWholeCardOnScreen(page: Page): Promise<void> {
  for (const key of ROWS) {
    await expect(page.getByTestId(`score-row-${key}`)).toBeInViewport({
      ratio: 1,
    });
  }
  await expect(page.getByTestId("yacht-upper-subtotal")).toBeInViewport({
    ratio: 1,
  });
  await expect(page.getByTestId("yacht-total-row")).toBeInViewport({
    ratio: 1,
  });
  const scrolls = await page
    .getByTestId("yacht-scorecard")
    .evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(scrolls, "the scorecard has to scroll to show its rows").toBe(false);
}

for (const [mode, open] of [
  ["solo", gotoYacht],
  ["VS", gotoYachtVs],
] as const) {
  test.describe(`Yacht layout — ${mode} @ 390x844`, () => {
    test.use({ viewport: PHONE });

    test.beforeEach(async ({ page }) => {
      await open(page);
    });

    test("all 13 rows, the subtotal band and the total are on screen, no tabs, no scrolling", async ({
      page,
    }) => {
      await expectWholeCardOnScreen(page);
      await expect(
        page.getByRole("tab", { name: /^(Upper|Lower)$/ }),
      ).toHaveCount(0);
      // After a roll the rows carry potentials; it still all fits.
      await page.getByTestId("yacht-roll-button").click();
      await expectWholeCardOnScreen(page);
    });

    test("the scorecard has the computer's column in VS and only yours in solo", async ({
      page,
    }) => {
      const cpu = page
        .getByTestId("yacht-scorecard")
        .getByText("CPU", { exact: true });
      await expect(cpu).toHaveCount(mode === "VS" ? 1 : 0);
    });

    test("the tray holds the hint, five dice, Roll and New Game, under the scorecard", async ({
      page,
    }) => {
      const tray = page.getByTestId("yacht-tray");
      await expect(tray.getByTestId("yacht-hint-line")).toBeVisible();
      for (let i = 0; i < 5; i++)
        await expect(tray.getByTestId(`yacht-die-${i}`)).toBeVisible();
      await expect(tray.getByTestId("yacht-roll-button")).toBeVisible();
      await expect(tray.getByTestId("yacht-new-game-button")).toBeVisible();
      const card = await page.getByTestId("yacht-scorecard").boundingBox();
      const box = await tray.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(card!.y + card!.height - 1);
    });

    test("the subtotal band is not a score row: it can't be tapped", async ({
      page,
    }) => {
      await page.getByTestId("yacht-roll-button").click();
      const band = page.getByTestId("yacht-upper-subtotal");
      await expect(band).toBeVisible();
      await expect(band).not.toHaveAttribute("role", "button");
      await band.click({ force: true });
      await expect(page.getByText("Round 1 / 13")).toBeVisible();
    });

    test("the dice and a held die's ring stay inside the tray", async ({
      page,
    }) => {
      await page.getByTestId("yacht-roll-button").click();
      await page.getByTestId("yacht-die-4").click();
      await expect(page.getByTestId("yacht-die-4-held-ring")).toBeVisible();
      await expect(page.getByText("HELD", { exact: true })).toHaveCount(0);
      const tray = (await page.getByTestId("yacht-tray").boundingBox())!;
      for (const id of [
        "yacht-die-0",
        "yacht-die-4",
        "yacht-die-4-held-ring",
      ]) {
        const b = (await page.getByTestId(id).boundingBox())!;
        expect(b.x, id).toBeGreaterThanOrEqual(tray.x);
        expect(b.x + b.width, id).toBeLessThanOrEqual(tray.x + tray.width);
      }
    });
  });
}

test.describe("Yacht Hint is solo only", () => {
  test.use({ viewport: PHONE });

  test("solo: Hint shows a hint for 2 s after a roll, then it is gone", async ({
    page,
  }) => {
    await gotoYacht(page);
    const hint = page.getByTestId("yacht-hint-button");
    await expect(hint).toBeVisible();
    await page.getByTestId("yacht-roll-button").click();
    await hint.click();
    await expect(page.getByTestId("yacht-hint-message")).toContainText("Hint:");
    await expect(page.getByTestId("yacht-hint-message")).toBeHidden({
      timeout: 4000,
    });
  });

  test("solo: before the first roll Hint says there is none", async ({
    page,
  }) => {
    await gotoYacht(page);
    await page.getByTestId("yacht-hint-button").click();
    await expect(page.getByTestId("yacht-no-hint-toast")).toHaveText(
      "No hint available",
    );
    await expect(page.getByTestId("yacht-no-hint-toast")).toBeHidden({
      timeout: 4000,
    });
  });

  test("VS: there is no Hint, only New Game", async ({ page }) => {
    await gotoYachtVs(page);
    await expect(page.getByTestId("yacht-hint-button")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show a hint" })).toHaveCount(
      0,
    );
    await expect(page.getByTestId("yacht-new-game-button")).toBeVisible();
  });
});

test.describe("Yacht layout — the computer's turn", () => {
  test.use({ viewport: PHONE });

  test("shows its own hint, 'Computer's Turn' on Roll, and highlights the row it scored", async ({
    page,
  }) => {
    await gotoYachtVs(page);
    await page.getByTestId("yacht-roll-button").click();
    await page.getByTestId("score-row-chance").click();
    await expect(page.getByText("Computer is rolling…")).toBeVisible();
    await expect(page.getByTestId("yacht-roll-button")).toContainText(
      "Computer's Turn",
    );
    await expect(page.getByTestId("yacht-roll-button")).toBeDisabled();
    // The computer's dice are at full opacity.
    const opacity = await page
      .getByTestId("yacht-die-0")
      .evaluate((el) => getComputedStyle(el).opacity);
    expect(opacity).toBe("1");
    // Its scored row is highlighted once it has played, and stays until you roll.
    await expect(page.getByTestId("yacht-cpu-row-bar")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Your Turn", { exact: true })).toBeVisible();
    await page.getByTestId("yacht-roll-button").click();
    await expect(page.getByTestId("yacht-cpu-row-bar")).toHaveCount(0);
  });
});

test.describe("Yacht layout — a small phone (320x568)", () => {
  test.use({ viewport: SMALL });

  test("the tray and its controls fit; the scorecard scrolls within its card", async ({
    page,
  }) => {
    await gotoYachtVs(page);
    await expect(page.getByTestId("yacht-roll-button")).toBeInViewport({
      ratio: 1,
    });
    await expect(page.getByTestId("yacht-new-game-button")).toBeInViewport({
      ratio: 1,
    });
    for (let i = 0; i < 5; i++) {
      await expect(page.getByTestId(`yacht-die-${i}`)).toBeInViewport({
        ratio: 1,
      });
    }
    // The page itself does not scroll sideways.
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(wide).toBe(false);
    // 13 rows can't fit above the tray here: the card scrolls, and the total is reachable.
    await page.getByTestId("yacht-total-row").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("yacht-total-row")).toBeInViewport();
  });
});

/**
 * sort-motion.spec.ts — GH #3660
 *
 * A pour must land (the move counter changes) within the owner's ceiling, measured from the
 * player's tap on the destination: 900 ms for one unit, 300 ms more for each extra unit.
 * The page itself timestamps the tap (pointerdown) and the moment the counter text changes
 * (a MutationObserver), so the number is the page's own, not Playwright's round trips.
 *
 * Plays catalog level 1: each full bottle poured into the first empty one, grouped by how
 * many units its top run moves.
 */

import { test, expect, type Page } from "@playwright/test";
import { mockSortApi, gotoSort, catalogLevel } from "./helpers/sort";

/**
 * Slack on the ceiling for the test machine only. None today: measured here, a 1-unit pour
 * takes about 825 ms and a 2-unit one about 1120 ms from the tap, so the design margin
 * (motion.ts: pourTotalMs(1) + POUR_START_LATENCY_BUDGET_MS = 830) already covers the machine.
 * Add a few tens of ms here, with a note, only if a slow runner needs it.
 */
const MACHINE_TOLERANCE_MS = 0;
const CEILING_MS = (units: number) => 900 + (units - 1) * 300;

const LEVEL_1 = catalogLevel(1);
const topRun = (bottle: string[]) => {
  let n = 0;
  while (
    n < bottle.length &&
    bottle[bottle.length - 1 - n] === bottle[bottle.length - 1]
  )
    n++;
  return n;
};
const firstEmpty = LEVEL_1.findIndex((b) => b.length === 0) + 1;
/** One full-bottle source per unit count that level 1 offers (1-based bottle numbers). */
const SOURCES = new Map<number, number>();
LEVEL_1.forEach((bottle, i) => {
  if (bottle.length !== 4) return;
  const units = topRun(bottle);
  if (!SOURCES.has(units)) SOURCES.set(units, i + 1);
});

async function installProbe(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __tap?: number; __landed?: number };
    w.__tap = undefined;
    w.__landed = undefined;
    document.addEventListener("pointerdown", (e) => (w.__tap = e.timeStamp), {
      capture: true,
    });
    new MutationObserver(() => {
      if (
        w.__tap !== undefined &&
        w.__landed === undefined &&
        /Moves:\s*1/.test(document.body.innerText)
      ) {
        w.__landed = performance.now();
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}

test.describe("Sort Puzzle — pour timing from the tap (#3660)", () => {
  for (const [units, source] of SOURCES) {
    test(`a ${units}-unit pour lands within ${CEILING_MS(units)} ms of the tap`, async ({
      page,
    }) => {
      await mockSortApi(page);
      await gotoSort(page);
      await page.getByRole("button", { name: "Level 1", exact: true }).click();
      await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({
        timeout: 5_000,
      });
      await page
        .getByRole("button", { name: `Bottle ${source}, 4 of 4 filled` })
        .click();
      await installProbe(page);
      // Let the select settle, so the pour is the only thing measured.
      await page.waitForTimeout(400);
      await page
        .getByRole("button", { name: `Bottle ${firstEmpty}, empty` })
        .click();
      await expect(page.getByText(/Moves:\s*1/)).toBeVisible({
        timeout: 5_000,
      });
      const { tap, landed } = await page.evaluate(() => {
        const w = window as unknown as { __tap?: number; __landed?: number };
        return { tap: w.__tap ?? NaN, landed: w.__landed ?? NaN };
      });
      const elapsed = landed - tap;
      console.log(
        `pour ${units} unit(s): tap -> move counter ${Math.round(elapsed)} ms`,
      );
      expect(elapsed).toBeGreaterThan(0);
      expect(elapsed).toBeLessThanOrEqual(
        CEILING_MS(units) + MACHINE_TOLERANCE_MS,
      );
    });
  }
});

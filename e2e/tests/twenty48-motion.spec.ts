/**
 * twenty48-motion.spec.ts — #3689
 *
 * The motion of a move: the two tiles of a merge slide into each other (positions sampled every
 * frame), the win card follows the 2048 tile by about a second, the game-over card follows the
 * dimmed board by about 0.6 s, and under Reduce Motion both cards come up at once.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  injectGameState,
  nearWinState,
  tilesFromBoard,
  type InjectedTwenty48State,
} from "./helpers/twenty48";

/** Row 0 is [0, 0, 2, 2]: ArrowLeft slides both 2s to column 0 and merges them. */
function slideMergeState(): InjectedTwenty48State {
  const board = [
    [0, 0, 2, 2],
    [0, 0, 0, 0],
    [0, 0, 0, 8],
    [0, 0, 0, 0],
  ];
  return {
    board,
    tiles: tilesFromBoard(board),
    score: 0,
    scoreDelta: 0,
    game_over: false,
    has_won: false,
  };
}

/**
 * The one move left: ArrowRight slides row 3 and the spawn fills the empty corner, whose
 * neighbours (64 and 8) can't merge with a 2 or a 4, so the board is stuck.
 */
function lastMoveState(): InjectedTwenty48State {
  const board = [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [64, 128, 64, 128],
    [8, 16, 32, 0],
  ];
  return {
    board,
    tiles: tilesFromBoard(board),
    score: 100,
    scoreDelta: 0,
    game_over: false,
    has_won: false,
  };
}

async function open(page: Page, state: InjectedTwenty48State): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await injectGameState(page, state);
  await page.getByRole("button", { name: "Play 2048" }).click();
  await page.getByLabel("Game board").waitFor();
}

interface Sample {
  t: number;
  /** left edge of each merge ghost, by testid */
  ghosts: Record<string, number>;
  /** the merged tile's opacity, or null while it is not on the board */
  mergedOpacity: number | null;
}

/** Samples the merge's ghosts and the merged tile every frame for `ms`, starting now. */
function sampleMerge(
  page: Page,
  mergedLabel: string,
  ms: number,
): Promise<Sample[]> {
  return page.evaluate(
    ([label, duration]) =>
      new Promise<Sample[]>((resolve) => {
        const out: Sample[] = [];
        const t0 = performance.now();
        const tick = () => {
          const ghosts: Record<string, number> = {};
          document
            .querySelectorAll('[data-testid^="twenty48-ghost-"]')
            .forEach((el) => {
              ghosts[el.getAttribute("data-testid") ?? ""] =
                el.getBoundingClientRect().left;
            });
          const merged = document.querySelector(`[aria-label="${label}"]`);
          out.push({
            t: performance.now() - t0,
            ghosts,
            mergedOpacity: merged
              ? Number(getComputedStyle(merged).opacity)
              : null,
          });
          if (performance.now() - t0 < (duration as number))
            requestAnimationFrame(tick);
          else resolve(out);
        };
        tick();
      }),
    [mergedLabel, ms] as const,
  );
}

test.describe("2048 — motion (#3689)", () => {
  test("a merge slides both tiles into each other, then the merged tile appears", async ({
    page,
  }) => {
    await open(page, slideMergeState());
    const sampling = sampleMerge(page, "4", 400);
    await page.keyboard.press("ArrowLeft");
    const samples = await sampling;

    const ids = Object.keys(
      samples
        .flatMap((s) => Object.keys(s.ghosts))
        .reduce(
          (acc, id) => ({ ...acc, [id]: 1 }),
          {} as Record<string, number>,
        ),
    );
    expect(ids).toHaveLength(2);

    // Each ghost moves left, frame by frame, and the two end on the same cell.
    for (const id of ids) {
      const lefts = samples
        .filter((s) => id in s.ghosts)
        .map((s) => s.ghosts[id]);
      expect(lefts.length).toBeGreaterThan(3);
      const start = lefts[0];
      const end = lefts[lefts.length - 1];
      expect(start - end).toBeGreaterThan(40);
      // Somewhere in between: it was seen travelling, not just at its ends.
      expect(lefts.some((x) => x < start - 8 && x > end + 8)).toBe(true);
      for (let i = 1; i < lefts.length; i++)
        expect(lefts[i]).toBeLessThanOrEqual(lefts[i - 1] + 0.5);
    }
    const [a, b] = ids.map(
      (id) => samples.filter((s) => id in s.ghosts).at(-1)!.ghosts[id],
    );
    expect(Math.abs(a - b)).toBeLessThan(6);

    // The merged tile is not seen until they meet, then it is.
    const firstSeen = samples.find((s) => s.mergedOpacity === 1);
    expect(firstSeen).toBeDefined();
    expect(
      samples[0].mergedOpacity === null || samples[0].mergedOpacity === 0,
    ).toBe(true);
    expect(firstSeen!.t).toBeGreaterThan(40);
    expect(firstSeen!.t).toBeLessThan(250);

    // The board settles: the merged 4 is there and no ghost is left showing.
    await expect(
      page.getByRole("img", { name: "4", exact: true }).first(),
    ).toBeVisible();
    const shown = await page.evaluate(
      () =>
        [
          ...document.querySelectorAll('[data-testid^="twenty48-ghost-"]'),
        ].filter((el) => Number(getComputedStyle(el).opacity) > 0).length,
    );
    expect(shown).toBe(0);
  });

  test("the win card follows the 2048 tile by about a second", async ({
    page,
  }) => {
    await open(page, nearWinState());
    const t0 = Date.now();
    await page.keyboard.press("ArrowLeft");

    // Part-way through: the 2048 tile has formed (with its glow) and no card yet.
    await expect(
      page.getByRole("img", { name: "2048", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("twenty48-win-glow")).toHaveCount(1);
    await page.waitForTimeout(350);
    await expect(page.getByText("You Win!")).not.toBeVisible();

    await page.getByText("You Win!").waitFor({ timeout: 5000 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThan(850);
    expect(elapsed).toBeLessThan(2500);
  });

  test("the game-over card follows the dimmed board by about 0.6 s", async ({
    page,
  }) => {
    await open(page, lastMoveState());
    const t0 = Date.now();
    await page.keyboard.press("ArrowRight");

    await expect(page.getByTestId("twenty48-dim")).toBeVisible();
    await page.waitForTimeout(250);
    await expect(page.getByText("Game Over")).not.toBeVisible();

    await page.getByText("Game Over").waitFor({ timeout: 5000 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThan(500);
    expect(elapsed).toBeLessThan(1800);
    await expect(page.getByTestId("twenty48-dim")).toHaveCount(0);
  });

  test.describe("Reduce Motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("the win card and the game-over card come up at once, with nothing sliding", async ({
      page,
    }) => {
      // The page's timers are frozen for each move, so the card can only show if it needs no
      // timer: the beats' (1 s, 0.6 s) never fire. No wall-clock limit, which a busy runner
      // can miss (#3725 CI).
      await page.clock.install();

      await open(page, nearWinState());
      await page.clock.pauseAt(Date.now() + 60_000);
      await page.keyboard.press("ArrowLeft");
      await page.getByText("You Win!").waitFor();
      await expect(
        page.locator('[data-testid^="twenty48-ghost-"]'),
      ).toHaveCount(0);
      await expect(page.getByTestId("twenty48-win-glow")).toHaveCount(0);
      await page.clock.resume();

      await open(page, lastMoveState());
      await page.clock.pauseAt(Date.now() + 120_000);
      await page.keyboard.press("ArrowRight");
      await page.getByText("Game Over").waitFor();
      await expect(page.getByTestId("twenty48-dim")).toHaveCount(0);
    });
  });
});

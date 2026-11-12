/**
 * yacht-motion.spec.ts — #3749
 *
 * The motion of a turn: a rolled die really tumbles (its box sampled every frame: it hops, turns
 * and lands where it started), the win card follows the end beat by about a second, and under
 * Reduce Motion the cards come up at once (counted in frames inside the page, #3725).
 */

import { test, expect, type Page } from "./fixtures";
import { blankScores, type InjectedGameState } from "./helpers/yacht";

const PHONE = { width: 390, height: 844 };

/** A last round: every row scored 0 but Chance, five 6s on the table after one roll. */
function lastRound(total = 0): InjectedGameState {
  const scores = blankScores();
  for (const k of Object.keys(scores)) if (k !== "chance") scores[k] = 0;
  scores.three_of_a_kind = total;
  return {
    dice: [6, 6, 6, 6, 6],
    held: [false, false, false, false, false],
    rolls_used: 1,
    round: 13,
    scores,
    game_over: false,
    upper_subtotal: 0,
    upper_bonus: 0,
    yacht_bonus_count: 0,
    yacht_bonus_total: 0,
    total_score: total,
  };
}

/** Opens Yacht on `state` (and, for vs, the computer's `aiState`), with no stored best. */
async function open(
  page: Page,
  state: InjectedGameState,
  aiState: InjectedGameState | null = null,
): Promise<void> {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await page.evaluate(
    ([s, ai]) => {
      localStorage.removeItem("yacht_best_score_v1");
      localStorage.setItem(
        "yacht_game_v2",
        JSON.stringify({
          state: s,
          aiDifficulty: ai ? "easy" : null,
          aiState: ai,
        }),
      );
    },
    [state, aiState] as const,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Play Yacht" }).click();
  await page.getByTestId("yacht-score-card").waitFor();
}

interface CardDelay {
  /** Frames drawn from the last score landing until the card showed. */
  frames: number;
  /** Milliseconds (the page's clock) from the last score landing until the card showed. */
  ms: number;
}

/**
 * Presses the Chance row and counts, inside the page, from the last score landing (`landed`
 * reads it off the scorecard) to the result card's title showing. Frames, not wall-clock time,
 * for "at once": a slow machine makes each frame longer but adds none (#3725).
 */
async function cardDelayAfterScore(
  page: Page,
  landedTestId: string,
): Promise<CardDelay> {
  // The row before the press, read (and awaited) before the press.
  const before = await page
    .getByTestId(landedTestId)
    .evaluate((el) => el.getAttribute("aria-label"));
  await page.getByTestId("score-row-chance").click();
  return page.evaluate(
    ([id, was]) =>
      new Promise<CardDelay>((resolve, reject) => {
        const row = () =>
          document
            .querySelector(`[data-testid="${id}"]`)
            ?.getAttribute("aria-label");
        const shows = () => {
          const el = document.querySelector(
            '[data-testid="yacht-result-title"]',
          );
          if (!el) return false;
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        };
        let landedAt: number | null = null;
        let frames = 0;
        const giveUp = setTimeout(
          () => reject(new Error(landedAt ? "no card" : "never scored")),
          15_000,
        );
        const tick = () => {
          if (landedAt === null && row() !== was) landedAt = performance.now();
          if (landedAt !== null) {
            frames += 1;
            if (shows()) {
              clearTimeout(giveUp);
              resolve({ frames, ms: performance.now() - landedAt });
              return;
            }
          }
          requestAnimationFrame(tick);
        };
        tick();
      }),
    [landedTestId, before] as const,
  );
}

interface Box {
  t: number;
  top: number;
  width: number;
}

/** Samples die 0's box every frame for `ms`, starting now. */
function sampleDie(page: Page, ms: number): Promise<Box[]> {
  return page.evaluate(
    (duration) =>
      new Promise<Box[]>((resolve) => {
        const out: Box[] = [];
        const t0 = performance.now();
        const tick = () => {
          const el = document.querySelector('[data-testid="yacht-die-0"]');
          const b = el?.getBoundingClientRect();
          if (b)
            out.push({
              t: performance.now() - t0,
              top: b.top,
              width: b.width,
            });
          if (performance.now() - t0 < duration) requestAnimationFrame(tick);
          else resolve(out);
        };
        tick();
      }),
    ms,
  );
}

test.describe("Yacht — motion (#3749)", () => {
  test("a rolled die tumbles: it hops, turns and lands where it started", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("yacht_game_v2"));
    await page.goto("/");
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await page.getByRole("button", { name: /^Solo$/i }).click();
    await page.getByText("Round 1 / 13").waitFor();

    const rest = await page
      .getByTestId("yacht-die-0")
      .evaluate((el) => el.getBoundingClientRect().toJSON());
    const sampling = sampleDie(page, 900);
    await page.getByTestId("yacht-roll-button").click();
    const samples = await sampling;

    expect(samples.length).toBeGreaterThan(10);
    // The hop: it rises well above its place (up to 18 px), frame by frame.
    const highest = Math.min(...samples.map((s) => s.top));
    expect(rest.top - highest).toBeGreaterThan(8);
    const midAir = samples.filter((s) => s.top < rest.top - 3);
    expect(midAir.length).toBeGreaterThan(3);
    // The turn: a rotated square's box is wider than the die.
    const widest = Math.max(...samples.map((s) => s.width));
    expect(widest - rest.width).toBeGreaterThan(8);
    // It lands where it started.
    const last = samples.at(-1)!;
    expect(Math.abs(last.top - rest.top)).toBeLessThan(1);
    expect(Math.abs(last.width - rest.width)).toBeLessThan(1);
  });

  test("the win card follows the end beat by about a second", async ({
    page,
  }) => {
    // No best stored: the first finished solo game is a new best, so a win.
    await open(page, lastRound(100));
    const delay = await cardDelayAfterScore(page, "score-row-chance");
    expect(delay.ms).toBeGreaterThan(900);
    expect(delay.ms).toBeLessThan(3000);
    await expect(page.getByTestId("yacht-result-title")).toHaveText(
      "Game Over",
    );
  });

  test.describe("Reduce Motion", () => {
    test.use({ reducedMotion: "reduce" });
    // On CI the context option alone didn't reach the page (#3725): set the page's media too.
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
    });

    /** The page sees Reduce Motion, and the restored board has settled. */
    async function settled(page: Page) {
      expect(
        await page.evaluate(
          () => matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
      ).toBe(true);
      await page.waitForTimeout(500);
    }

    test("the solo card comes up at once", async ({ page }) => {
      await open(page, lastRound(100));
      await settled(page);
      const delay = await cardDelayAfterScore(page, "score-row-chance");
      // Up on the first frames (the win beat takes ~60).
      expect(delay.frames).toBeLessThanOrEqual(5);
    });

    test("the vs card comes up as the computer's last score lands", async ({
      page,
    }) => {
      const ai = { ...lastRound(0), dice: [0, 0, 0, 0, 0], rolls_used: 0 };
      await open(page, lastRound(100), ai);
      await settled(page);
      // The computer's total changes with its last score, after its (quick) last turn.
      const delay = await cardDelayAfterScore(page, "yacht-total-cpu");
      expect(delay.frames).toBeLessThanOrEqual(5);
      await expect(page.getByTestId("yacht-result-title")).toHaveText(
        "You Win!",
      );
    });
  });
});

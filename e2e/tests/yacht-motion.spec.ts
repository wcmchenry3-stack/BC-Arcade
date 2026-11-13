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

interface Frame {
  /** Frames drawn since the Roll press (null before it). */
  sincePress: number | null;
  /** Each die's box. */
  dice: { top: number; width: number }[];
  /** The bottom of the hint line above the dice. */
  hintBottom: number;
  /** Whether Roll says it takes no press (the input lock). */
  rollLocked: boolean;
}

/**
 * Samples the tray every frame for `ms`, starting now: the dice's boxes, the hint line's bottom,
 * Roll's lock, and how many frames have passed since Roll was pressed (a capture listener in the
 * page notes the press, so the count is the page's own, #3725).
 */
function sampleTray(page: Page, ms: number): Promise<Frame[]> {
  return page.evaluate(
    (duration) =>
      new Promise<Frame[]>((resolve) => {
        const out: Frame[] = [];
        let pressedAt: number | null = null;
        let frame = 0;
        const roll = () =>
          document.querySelector('[data-testid="yacht-roll-button"]');
        document.addEventListener(
          "click",
          (e) => {
            if (roll()?.contains(e.target as Node) && pressedAt === null)
              pressedAt = frame;
          },
          true,
        );
        const t0 = performance.now();
        const tick = () => {
          frame += 1;
          const dice = [0, 1, 2, 3, 4].map((i) => {
            const b = document
              .querySelector(`[data-testid="yacht-die-${i}"]`)!
              .getBoundingClientRect();
            return { top: b.top, width: b.width };
          });
          out.push({
            sincePress: pressedAt === null ? null : frame - pressedAt,
            dice,
            hintBottom: document
              .querySelector('[data-testid="yacht-hint-line"]')!
              .getBoundingClientRect().bottom,
            rollLocked: roll()?.getAttribute("aria-disabled") === "true",
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
  test("a roll tumbles: it starts at once, stays inside the tray, and input waits for the last die", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("yacht_game_v2"));
    await page.goto("/");
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await page.getByRole("button", { name: /^Solo$/i }).click();
    await page.getByText("Round 1 / 13").waitFor();
    await page.waitForTimeout(300);

    const rest = await page.evaluate(() =>
      [0, 1, 2, 3, 4].map((i) => {
        const b = document
          .querySelector(`[data-testid="yacht-die-${i}"]`)!
          .getBoundingClientRect();
        return { top: b.top, width: b.width };
      }),
    );
    const sampling = sampleTray(page, 1400);
    await page.getByTestId("yacht-roll-button").click();
    const frames = (await sampling).filter((f) => f.sincePress !== null);
    expect(frames.length).toBeGreaterThan(10);

    const moved = (f: Frame) =>
      f.dice.some(
        (d, i) =>
          Math.abs(d.top - rest[i].top) > 0.5 ||
          Math.abs(d.width - rest[i].width) > 0.5,
      );
    // It starts at once: the first moved frame comes within a few frames of the press (review
    // round 1: it used to sit still for about 160 ms).
    const first = frames.find(moved);
    expect(first).toBeDefined();
    expect(first!.sincePress).toBeLessThanOrEqual(4);

    // It hops and turns (die 0, the first to go).
    const highest = Math.min(...frames.map((f) => f.dice[0].top));
    expect(rest[0].top - highest).toBeGreaterThan(4);
    const widest = Math.max(...frames.map((f) => f.dice[0].width));
    expect(widest - rest[0].width).toBeGreaterThan(8);

    // Every die stays below the hint line, every frame (it once covered the hint text).
    for (const f of frames)
      for (const d of f.dice)
        expect(d.top).toBeGreaterThanOrEqual(f.hintBottom);

    // Roll is locked while any die is still moving, and is free once they have all landed.
    for (const f of frames) if (moved(f)) expect(f.rollLocked).toBe(true);
    const last = frames.at(-1)!;
    expect(moved(last)).toBe(false);
    expect(last.rollLocked).toBe(false);
  });

  test("during the end beat the tray shows the final dice and 'Game over', with Roll disabled", async ({
    page,
  }) => {
    await open(page, { ...lastRound(100), dice: [2, 3, 4, 5, 6] });
    await page.getByTestId("score-row-chance").click();
    await expect(page.getByTestId("yacht-game-over-hint")).toHaveText(
      "Game over",
    );
    await expect(page.getByTestId("yacht-result-title")).toHaveCount(0);
    await expect(page.getByTestId("yacht-die-4")).toHaveAccessibleName(
      /showing 6/,
    );
    await expect(page.getByTestId("yacht-roll-button")).toBeDisabled();
    await expect(page.getByText(/Press Roll/)).toHaveCount(0);
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

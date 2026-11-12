/**
 * Spam-bot regression for the lid (#3694).
 *
 * Before #3694 a bot tapping every 250 ms at a random x never lost: in 30 simulated minutes, on
 * every seed, a merge somewhere in the bin kept resetting the overflow count and the pile grew
 * off the top of the canvas. With the lid, the same bot (tapping every 200-250 ms, which is as
 * fast as the screen's tap debounce allows, and gated by `canDrop()` as the screen is) loses on
 * every seed.
 *
 * Simulated seconds to game over as this test runs them (the sim harness's `spamBot` via
 * `runGame`, #2893), all by overflow:
 *   seed      1     2     3     4     5
 *   60 Hz   68.1  62.1  39.2  57.0  67.4   (16.67 ms frames)
 *   120 Hz  48.9  51.4  67.0  47.8  61.3   (8.33 ms frames)
 * That is the 12-tier ladder (#3695, `tiers.ts`) with the harness's `spamBot`. History: the
 * 10-tier ladder read 34-46 s here, and 54-73 s with the lid test's own bot. The mean over 100
 * seeds is about 59 s (sim/baseline.json), and the bound below still leaves about 1.6x headroom
 * over the slowest of these. Headless and deterministic: the seeded RNG drives the queue, the tap
 * times and the tap x. The bot and the game loop live in `../sim/` (`runGame`, `spamBot`).
 */
import { spamBot } from "../sim/bots";
import { runGame } from "../sim/runGame";

/** Simulated time within which the spam bot must lose, on every seed. */
const SPAM_GAME_OVER_BOUND_MS = 120_000;
const SEEDS = [1, 2, 3, 4, 5];

describe("the lid: spam bot always loses (#3694)", () => {
  describe.each([
    ["60 Hz", 60 as const],
    ["120 Hz", 120 as const],
  ])("at %s", (_label, hz) => {
    it.each(SEEDS)(`seed %i reaches game over within ${SPAM_GAME_OVER_BOUND_MS} ms`, (seed) => {
      const result = runGame({ seed, hz, bot: spamBot, maxSimMs: SPAM_GAME_OVER_BOUND_MS });
      expect(result.endedBy).not.toBe("cap");
      expect(result.simMs).toBeLessThanOrEqual(SPAM_GAME_OVER_BOUND_MS);
      // It played a real game first, not an instant loss.
      expect(result.drops).toBeGreaterThan(30);
    });
  });
});

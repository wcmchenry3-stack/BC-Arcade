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
 *   60 Hz   70.1  39.9  48.6  44.4  65.4   (16.67 ms frames)
 *   120 Hz  76.2  61.3 105.2  61.2  62.9   (8.33 ms frames)
 * That is planck.js with the lively tuning and ladder (#3697). History: the 12-tier ladder on
 * Matter.js (#3695) read 39-68 s here, the 10-tier ladder 34-46 s. Lively's pieces shuffle into
 * gaps, so a mindless pile lasts longer: seed 3 at 120 Hz (105.2 s) is also the longest of the
 * 100-seed full suite (spam@60 93.8 s), so the bound below has about 14 % headroom, not the
 * 1.6x it had. Headless and deterministic: the seeded RNG drives the queue, the tap times and the
 * tap x. The bot and the game loop live in `../sim/` (`runGame`, `spamBot`).
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

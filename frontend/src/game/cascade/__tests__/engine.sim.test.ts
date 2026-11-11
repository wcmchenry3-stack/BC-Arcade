/**
 * Spam-bot regression for the lid (#3694).
 *
 * Before #3694 a bot tapping every 250 ms at a random x never lost: in 30 simulated minutes, on
 * every seed, a merge somewhere in the bin kept resetting the overflow count and the pile grew
 * off the top of the canvas. With the lid, the same bot (tapping every 200-250 ms, which is as
 * fast as the screen's tap debounce allows, and gated by `canDrop()` as the screen is) loses on
 * every seed.
 *
 * Recorded 2026-11-11 with this test's own RNG (before the bot moved to the shared sim harness,
 * #2893), simulated seconds to game over, all by overflow:
 *   seed      1     2     3     4     5
 *   60 Hz   45.6  38.7  46.0  40.3  42.1   (16.67 ms frames)
 *   120 Hz  42.9  34.2  44.2  40.0  38.7   (8.33 ms frames)
 * The harness's bot draws from separate seeded streams, so its numbers differ a little (about
 * 43 s mean over 100 seeds, see sim/baseline.json), and the bound below still leaves well over
 * 2x headroom. Headless and deterministic: the seeded RNG drives the queue, the tap times and
 * the tap x. The bot and the game loop live in `../sim/` (`runGame`, `spamBot`).
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

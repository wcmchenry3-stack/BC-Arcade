/**
 * Spam-bot regression for the lid (#3694).
 *
 * Before #3694 a bot tapping every 250 ms at a random x never lost: in 30 simulated minutes, on
 * every seed, a merge somewhere in the bin kept resetting the overflow count and the pile grew
 * off the top of the canvas. With the lid, the same bot (tapping every 200-250 ms, which is as
 * fast as the screen's tap debounce allows, and gated by `canDrop()` as the screen is) loses on
 * every seed.
 *
 * Recorded 2026-11-11 (real spawn selector), simulated seconds to game over, all by overflow:
 *   seed      1     2     3     4     5
 *   60 Hz   45.6  38.7  46.0  40.3  42.1   (16.67 ms frames)
 *   120 Hz  42.9  34.2  44.2  40.0  38.7   (8.33 ms frames)
 * The bound below leaves well over 2x headroom. Headless and deterministic: the seeded RNG drives
 * the queue, the tap times and the tap x.
 */
import { CascadeEngine, type GameOverReason } from "../engine";
import { advanceQueue, createPieceQueue } from "../pieceQueue";
import { DROUGHT_WINDOW } from "../spawnSelector";
import { DANGER_STACK_MARGIN, OVERFLOW_LINE_Y, WALL_THICKNESS, WORLD_WIDTH } from "../constants";

/** Simulated time within which the spam bot must lose, on every seed. */
const SPAM_GAME_OVER_BOUND_MS = 120_000;
const SEEDS = [1, 2, 3, 4, 5];

function seededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (Math.imul(48271, s) + (s >>> 16)) | 0;
    return (s >>> 0) / 0x100000000;
  };
}

interface SpamResult {
  gameOverMs: number | null;
  reason: GameOverReason | null;
  drops: number;
}

function spamBot(seed: number, frameMs: number): SpamResult {
  const rng = seededRng(seed);
  const engine = new CascadeEngine({});
  let queue = createPieceQueue([], rng);
  let history = [queue.current, queue.next];
  let t = 0;
  let nextTapAt = 0;
  let drops = 0;
  while (t < SPAM_GAME_OVER_BOUND_MS) {
    if (t >= nextTapAt) {
      // The screen's gate: a tap while the last piece is over the lid does nothing.
      if (engine.canDrop()) {
        const pieces = engine.getState().pieces;
        const isInDanger = pieces.some((p) => p.y < OVERFLOW_LINE_Y + DANGER_STACK_MARGIN);
        const tier = queue.current;
        queue = advanceQueue(queue, history, isInDanger, rng);
        history = [...history, queue.next].slice(-DROUGHT_WINDOW);
        engine.drop(tier, WALL_THICKNESS + rng() * (WORLD_WIDTH - 2 * WALL_THICKNESS));
        drops++;
      }
      nextTapAt = t + 200 + rng() * 50;
    }
    const { events } = engine.step(frameMs);
    t += frameMs;
    const over = events.find((e) => e.type === "gameOver");
    if (over && over.type === "gameOver") {
      return { gameOverMs: t, reason: over.reason, drops };
    }
  }
  return { gameOverMs: null, reason: null, drops };
}

describe("the lid: spam bot always loses (#3694)", () => {
  describe.each([
    ["60 Hz", 16.67],
    ["120 Hz", 8.33],
  ])("at %s", (_label, frameMs) => {
    it.each(SEEDS)(`seed %i reaches game over within ${SPAM_GAME_OVER_BOUND_MS} ms`, (seed) => {
      const result = spamBot(seed, frameMs);
      expect(result.gameOverMs).not.toBeNull();
      expect(result.gameOverMs!).toBeLessThanOrEqual(SPAM_GAME_OVER_BOUND_MS);
      expect(result.reason).not.toBeNull();
      // It played a real game first, not an instant loss.
      expect(result.drops).toBeGreaterThan(30);
    });
  });
});

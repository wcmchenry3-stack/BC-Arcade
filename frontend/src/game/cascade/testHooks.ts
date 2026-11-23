/**
 * Cascade E2E hooks (EXPO_PUBLIC_TEST_HOOKS=1 builds only, #3693).
 *
 * `__cascade_*` on `globalThis`, through the shared registry (#2975), is the seam Playwright
 * and Maestro drive. The registry is a no-op in store and ordinary dev builds. The hooks are
 * thin: the screen supplies each one as a closure over its own refs (the engine, the score,
 * the queue), so a hook runs the same path the screen does.
 *
 * Names (unchanged since the screen installed them inline): `getState`, `setSeed`, `dropAt`,
 * `fastForward`, `triggerGameOver`, `isReady`, `spawnTierAt`.
 *
 * Maestro cannot call these (its `runScript` runs on the host, not in the app), so a test build
 * also shows `CascadeTestControls`, a row of buttons that run the demo set-ups below (#3719).
 * The set-ups are data (`cascadeSetup`): the screen restores `pieces` into the real engine and
 * seeds `queue`, so the engine's rules (the lid ends the game) are what play out. Added hooks:
 * `seedQueue`, `setupChain`, `setupNearLid`, `fillBin`, `setupWin` (#3904; #3920 ladder),
 * `setupStorm` (#4082).
 */
import { registerTestHooks } from "../_shared/testHooksRegistry";
import { mergeStormPile } from "./stepBench";
import { CAPSTONE_TIER, tierRadius } from "./tiers";
import {
  FIXED_STEP_MS,
  OVERFLOW_IGNORE_MERGE_TICKS,
  WALL_THICKNESS,
  WORLD_WIDTH,
} from "./constants";

export interface CascadeHookState {
  score: number;
  gameOver: boolean;
  /** The capstone was made (#3920): play has ended in a win. */
  won: boolean;
  nextFruitTier: number;
  comboCount: number;
  fruitCount: number;
  dangerRatio: number;
  fruits: { id: number; tier: number; x: number; y: number; angle: number }[];
}

export interface CascadeHookDeps {
  getState: () => CascadeHookState;
  /** Seeds the piece queue so the next drops are reproducible. */
  setSeed: (seed: number) => void;
  /** Drops the queue's current piece at world x. */
  dropAt: (x: number) => void;
  /** Steps the physics by `ms` without waiting for frames. */
  fastForward: (ms: number) => void;
  triggerGameOver: () => void;
  isReady: () => boolean;
  /** Drops a specific tier at world x, bypassing the queue. */
  spawnTierAt: (tier: number, x: number) => void;
  /** Scripts the next pieces: the queue offers exactly these tiers, in order, then goes random. */
  seedQueue: (tiers: number[]) => void;
  /** Restores a pile that a few drops turn into a chain of 3+ merges (see `cascadeSetup`). */
  setupChain: () => void;
  /** Restores a pile over the lid with the clock ring part drained (the danger state). */
  setupNearLid: () => void;
  /** Fills the bin above the lid, so the lid ends the game on its own within seconds. */
  fillBin: () => void;
  /** Restores two tier-10 pieces about to merge into the capstone: the win follows at once. */
  setupWin: () => void;
  /** Restores the merge storm's pile (#4082): about 15 merges play out at once, a big chain. */
  setupStorm: () => void;
}

export type CascadeSetupId = "chain" | "nearLid" | "fillBin" | "win" | "storm";

export interface CascadeSetup {
  /** Restored into the engine (`CascadeEngine.restore`), replacing the board. */
  pieces: { tier: number; x: number; y: number }[];
  /** Scripted queue, if any (`seedQueue`). */
  queue?: number[];
  /** Simulated ms to run after the restore (a fast-forward), so the pile has settled. */
  settleMs: number;
}

/** The floor's top edge: the bin's pieces rest on it. */
const FLOOR_Y = 580;
const ticksMs = (ticks: number): number => ticks * FIXED_STEP_MS;
/**
 * `win`: how far right of the lower tier-10 piece the upper one falls (#3920). Two tier-10 pieces
 * (r 80.33) fit side by side on the floor, so the upper one falls onto the lower one's shoulder.
 */
const WIN_OFFSET_X = 100;

/**
 * A column of pieces of distinct tiers (so none merge), bottom first, centred at `x`, each
 * resting on the one below (1 px apart so the solver does not start them overlapped).
 */
function column(tiers: number[], x: number): CascadeSetup["pieces"] {
  const out: CascadeSetup["pieces"] = [];
  let top = FLOOR_Y;
  for (const tier of tiers) {
    const r = tierRadius(tier);
    out.push({ tier, x, y: top - r - 1 });
    top -= 2 * r + 1;
  }
  return out;
}

/**
 * A tower against one wall (#3904): pieces of distinct tiers, biggest first, each touching the
 * wall and resting on the one below, 1 px apart. Each piece sits off the centre of the one below,
 * towards the wall, so the wall holds it: a centred column of the big tiers topples.
 */
function wallTower(tiers: number[], side: "left" | "right"): CascadeSetup["pieces"] {
  const out: CascadeSetup["pieces"] = [];
  const wallX = (r: number) =>
    side === "left" ? WALL_THICKNESS + r : WORLD_WIDTH - WALL_THICKNESS - r;
  let prev: { x: number; y: number; r: number } | null = null;
  for (const tier of tiers) {
    const r = tierRadius(tier);
    const x = wallX(r);
    let y = FLOOR_Y - r - 1;
    if (prev) {
      const d = prev.r + r + 1;
      y = prev.y - Math.sqrt(d * d - (x - prev.x) ** 2);
    }
    out.push({ tier, x, y });
    prev = { x, y, r };
  }
  return out;
}

/**
 * The pile for each demo set-up. All are plain restores, so every rule is the live one.
 *
 *  - `chain`: a column of tiers 2, 1 and 0 (a cherry on top) under the middle of the board, and
 *    the queue scripted as cherries. One drop at the middle (a tap on the board) lands on the
 *    cherry and makes a 1, which drops onto the 1 and makes a 2, which drops onto the 2 and makes
 *    a 3: three merges, 14 points. It holds for a drop within 3 px of the middle (a tap lands on
 *    200 give or take 1 px), not for a wide miss: the pile is a set-up, not a rule. (#3697: on
 *    the lively physics a free cherry rolls away on the floor, so the old set-up, tiers 1, 2 and 3
 *    side by side where the first of two drops had to come to rest beside the 1, no longer held;
 *    the cherry it waited for is now part of the pile.)
 *  - `nearLid`: a tower of the capstone and tiers 10, 9 and 5 against the left wall (12-tier
 *    ladder: its top edge at about y = 49, over the lid; with a tier 7 on top it would reach
 *    over the canvas top, the hard stop), wedged by a tier 10 and 9 against the right wall,
 *    fast-forwarded past the restore grace and a sixth of the count, so the ring is draining
 *    when the screen shows it and the lid ends the game about 2.5 s later.
 *  - `fillBin`: that tower plus a tower of tiers 10 to 6 against the right wall (top edge at about
 *    y = 19); the lid ends the game (the live rule, no force) about 4 s after the restore.
 *  - `win` (#3920): two tier-10 pieces (Watermelon / Sun) about to merge into the capstone: one on
 *    the floor against the left wall, the other above it, offset by WIN_OFFSET_X towards the
 *    middle and 43 px higher than where it would first touch it. It falls onto it, and the merge
 *    that makes the capstone is the win (about 0.2 s after the restore). Nothing is forced. The
 *    result card is #3699.
 *  - `storm` (#4082): the step bench's merge-storm pile (`mergeStormPile`): a tower of distinct
 *    tiers against each wall and a block of 16 cherries in contact between them. Not settled: the
 *    cherries merge 8 at once, then 4, 2 and 1, live, in the first 36 frames (15 merges, the
 *    chain counter up to about ×15; 2 x 8 + 4 x 4 + 2 x 8 + 16 = 64 points). The big-chain case
 *    on a device.
 */
export function cascadeSetup(id: CascadeSetupId): CascadeSetup {
  const mid = WORLD_WIDTH / 2;
  const leftTower = wallTower([CAPSTONE_TIER, 10, 9, 5], "left");
  switch (id) {
    case "chain":
      return {
        pieces: column([2, 1, 0], mid),
        queue: Array<number>(6).fill(0),
        settleMs: ticksMs(60),
      };
    case "nearLid":
      return {
        // The two right-hand pieces wedge the capstone against the left wall (on its own it
        // slides out from under the tower on the lively floor).
        pieces: [...leftTower, ...wallTower([10, 9], "right")],
        settleMs: ticksMs(OVERFLOW_IGNORE_MERGE_TICKS + 30),
      };
    case "fillBin":
      // The towers repeat tiers 10 and 9, but never at the same height, so nothing merges.
      return {
        pieces: [...leftTower, ...wallTower([10, 9, 8, 7, 6], "right")],
        settleMs: 0,
      };
    case "storm":
      return { pieces: mergeStormPile(), settleMs: 0 };
    case "win": {
      const tier = CAPSTONE_TIER - 1;
      const r = tierRadius(tier);
      const left = WALL_THICKNESS + r;
      const upper = left + WIN_OFFSET_X;
      const floorY = FLOOR_Y - r;
      // Where the upper one, falling straight down, first touches the lower one, then 43 px up.
      const touchY = floorY - Math.sqrt((2 * r) ** 2 - WIN_OFFSET_X ** 2);
      return {
        pieces: [
          { tier, x: left, y: floorY },
          { tier, x: upper, y: touchY - 43 },
        ],
        settleMs: 0,
      };
    }
  }
}

/** Installs the `__cascade_*` hooks in a test build; returns its cleanup. */
export function registerCascadeTestHooks(deps: CascadeHookDeps): () => void {
  return registerTestHooks("cascade", {
    getState: deps.getState,
    setSeed: deps.setSeed,
    dropAt: deps.dropAt,
    fastForward: deps.fastForward,
    triggerGameOver: deps.triggerGameOver,
    isReady: deps.isReady,
    spawnTierAt: deps.spawnTierAt,
    seedQueue: deps.seedQueue,
    setupChain: deps.setupChain,
    setupNearLid: deps.setupNearLid,
    fillBin: deps.fillBin,
    setupWin: deps.setupWin,
    setupStorm: deps.setupStorm,
  });
}

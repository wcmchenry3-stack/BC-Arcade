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
 * `seedQueue`, `setupChain`, `setupNearLid`, `fillBin`, `setupWin` (#3904).
 */
import { registerTestHooks } from "../_shared/testHooksRegistry";
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
  /** Restores two capstones about to touch: the win follows within a fraction of a second. */
  setupWin: () => void;
}

export type CascadeSetupId = "chain" | "nearLid" | "fillBin" | "win";

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
 * towards the wall, so the wall holds it: a centred column of the #3904 sizes topples.
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
 *  - `nearLid`: a tower of a capstone and tiers 10, 9 and 8 against the left wall (#3904 ladder:
 *    its top edge at about y = 36, over the lid), wedged by a tier 10 and 9 against the right
 *    wall, fast-forwarded past the restore grace and a
 *    sixth of the count, so the ring is draining when the screen shows it and the lid ends the
 *    game about 2.5 s later.
 *  - `fillBin`: that tower plus a tower of tiers 10 to 4 against the right wall (top edge at
 *    about y = 48); the lid ends the game (the live rule, no force) about 4 s after the restore.
 *  - `win` (#3904): a capstone on the floor against the left wall and a second one against the
 *    right wall, 43 px higher than where it would touch the first. It falls into it, and the two
 *    capstones touching are the win (about 0.2 s after the restore). Nothing is forced. The
 *    result card is #3699.
 */
export function cascadeSetup(id: CascadeSetupId): CascadeSetup {
  const mid = WORLD_WIDTH / 2;
  const leftTower = wallTower([11, 10, 9, 8], "left");
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
      // The towers repeat tiers 10, 9 and 8, but never at the same height: they are at least 15 px
      // apart where they come closest (the two bottom pieces), so nothing merges.
      return {
        pieces: [...leftTower, ...wallTower([10, 9, 8, 7, 6, 5, 4], "right")],
        settleMs: 0,
      };
    case "win": {
      const r = tierRadius(CAPSTONE_TIER);
      const left = WALL_THICKNESS + r;
      const right = WORLD_WIDTH - WALL_THICKNESS - r;
      const floorY = FLOOR_Y - r;
      // Where the right one, falling down its wall, first touches the left one, then 43 px up.
      const touchY = floorY - Math.sqrt((2 * r) ** 2 - (right - left) ** 2);
      return {
        pieces: [
          { tier: CAPSTONE_TIER, x: left, y: floorY },
          { tier: CAPSTONE_TIER, x: right, y: touchY - 43 },
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
  });
}

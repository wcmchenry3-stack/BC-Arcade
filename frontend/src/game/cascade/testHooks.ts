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
 * `seedQueue`, `setupChain`, `setupNearLid`, `fillBin`.
 */
import { registerTestHooks } from "../_shared/testHooksRegistry";
import { tierRadius } from "./tiers";
import { FIXED_STEP_MS, OVERFLOW_IGNORE_MERGE_TICKS, WORLD_WIDTH } from "./constants";

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
  // TODO(#3699): `setupWin` goes here once Cascade has a win state (the capstone merge). There
  // is no control for it yet; `demo-win.yaml` is blocked on the same story.
}

export type CascadeSetupId = "chain" | "nearLid" | "fillBin";

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
 *  - `nearLid`: a tower like the lid test's fixture (a capstone and tiers 10, 9, 8 and 7; its
 *    top edge is over the lid; #3697: three pieces no longer reach it), fast-forwarded past the restore grace and a sixth of the
 *    count, so the ring is draining when the screen shows it and the lid ends the game
 *    about 2.5 s later.
 *  - `fillBin`: that tower plus a right-hand tower; the lid ends the game (the live rule, no
 *    force) about 4 s after the restore.
 */
export function cascadeSetup(id: CascadeSetupId): CascadeSetup {
  const mid = WORLD_WIDTH / 2;
  const leftTower = column([11, 10, 9, 8, 7], 121);
  switch (id) {
    case "chain":
      return {
        pieces: column([2, 1, 0], mid),
        queue: Array<number>(6).fill(0),
        settleMs: ticksMs(60),
      };
    case "nearLid":
      return {
        pieces: leftTower,
        settleMs: ticksMs(OVERFLOW_IGNORE_MERGE_TICKS + 30),
      };
    case "fillBin":
      // Right lane (x 246 to 380), tiers 10, 9, 8, 7, 6 and 4 stacked up past the lid. The tiers
      // differ within a tower, and the towers are too far apart to touch, so nothing merges.
      return { pieces: [...leftTower, ...column([10, 9, 8, 7, 6, 4], 313)], settleMs: 0 };
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
  });
}

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
 */
import { registerTestHooks } from "../_shared/testHooksRegistry";

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
  });
}

/**
 * Solitaire E2E hooks (EXPO_PUBLIC_TEST_HOOKS=1 builds only, #3532).
 *
 * Test builds deal every game from a fixed seed bank entry (`pickSeed` in
 * engine.ts), and on native they skip the draw-mode picker and deal draw-1 at
 * once (SolitaireScreen). These hooks reach the draw-3 deal without the picker:
 *
 * - `__solitaire_deal(drawMode)` on `globalThis`, through the shared registry
 *   (#2975), for drivers that can run JS (Playwright).
 * - `TestDealControl` (components/solitaire), a small button with testID
 *   `solitaire-test-deal-draw3`, for Maestro, which can only tap. It is drawn
 *   only on native test builds, outside the board's layout.
 *
 * Store and ordinary dev builds get neither: the registry is a no-op and
 * `isTestDealControlShown` is false without the env flag.
 */
import { areTestHooksEnabled } from "../_shared/envFlags";
import { registerTestHooks } from "../_shared/testHooksRegistry";
import type { DrawMode } from "./types";

/** testID of the native test-build button that deals a fresh draw-3 game. */
export const TEST_DEAL_DRAW3_TEST_ID = "solitaire-test-deal-draw3";

export interface SolitaireHookDeps {
  /** Starts a new game in this draw mode: the screen's real new-game path. */
  deal: (drawMode: DrawMode) => void;
}

/** Installs `__solitaire_deal` in a test build; returns its cleanup. */
export function registerSolitaireTestHooks({ deal }: SolitaireHookDeps): () => void {
  return registerTestHooks("solitaire", {
    // Anything but 3 deals draw-1, so a bad argument can't reach the engine.
    deal: (drawMode: number) => deal(drawMode === 3 ? 3 : 1),
  });
}

/** Whether the screen draws the test-deal button: native test builds only. */
export function isTestDealControlShown(platformOS: string): boolean {
  return areTestHooksEnabled() && platformOS !== "web";
}

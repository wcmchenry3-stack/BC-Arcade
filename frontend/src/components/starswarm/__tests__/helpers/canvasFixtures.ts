/**
 * Shared by the native and web Star Swarm canvas suites (GameCanvas.test.tsx,
 * GameCanvas.web.test.tsx): a hand-cranked requestAnimationFrame and a seeded live game.
 */
import { act } from "@testing-library/react-native";

import type { StarSwarmState } from "../../../../game/starswarm/types";

export const CANVAS_TEST_W = 360;
export const CANVAS_TEST_H = 640;

/**
 * Replaces requestAnimationFrame / cancelAnimationFrame with a one-slot queue: the canvas's loop
 * requests a frame, and `frame(dt)` runs exactly that one iteration, `dt` ms after the last,
 * inside `act`. Call `install()` in `beforeEach` and `uninstall()` in `afterAll`.
 */
export function createRafHarness({ frameMs = 16 }: { frameMs?: number } = {}) {
  let pending: ((ts: number) => void) | null = null;
  let clock = 1000;
  const realRaf = global.requestAnimationFrame;
  const realCaf = global.cancelAnimationFrame;

  async function frame(dt = frameMs) {
    clock += dt;
    const cb = pending;
    if (!cb) throw new Error("no frame requested");
    pending = null;
    await act(async () => cb(clock));
  }

  return {
    install() {
      pending = null;
      global.requestAnimationFrame = jest.fn((cb: (ts: number) => void) => {
        pending = cb;
        return 1;
      }) as unknown as typeof requestAnimationFrame;
      global.cancelAnimationFrame = jest.fn(() => {
        pending = null;
      });
    },
    uninstall() {
      global.requestAnimationFrame = realRaf;
      global.cancelAnimationFrame = realCaf;
    },
    frame,
    async frames(n: number, dt = frameMs) {
      for (let i = 0; i < n; i++) await frame(dt);
    },
    /** True while the loop has a frame requested (it is running). */
    hasPendingFrame: () => pending !== null,
    /** The timestamp of the last frame run. */
    now: () => clock,
  };
}

/**
 * A live wave-1 game, seeded so it is the same every run. Uses the real engine even in a suite
 * that wraps the engine module in jest.fn.
 */
export function seededStarSwarm(overrides: Partial<StarSwarmState> = {}): StarSwarmState {
  const { initStarSwarm } = jest.requireActual<typeof import("../../../../game/starswarm/engine")>(
    "../../../../game/starswarm/engine"
  );
  return {
    ...initStarSwarm(CANVAS_TEST_W, CANVAS_TEST_H, 1, 7, "LieutenantJG"),
    phase: "Playing",
    ...overrides,
  };
}

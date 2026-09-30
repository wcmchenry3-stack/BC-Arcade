/**
 * #2846: edge-drag regression coverage through the real chain
 * Controls -> canvas handle (setPlayerX/getPlayerX) -> engine tick -> player.x.
 *
 * GameCanvas itself needs Skia, so `FakeCanvas` reproduces its input/tick contract exactly:
 * setPlayerX writes an input slot, the real engine `tick()` copies it into player.x, and the
 * tick is skipped during the pre-wave countdown (as GameCanvas's frame loop does). Gestures are
 * driven by capturing the Pan handlers Controls registers with react-native-gesture-handler.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import Controls from "../Controls";
import type { GameCanvasHandle } from "../GameCanvas";
import { CANVAS_H, CANVAS_W, PLAYER_W, initStarSwarm, tick } from "../../../game/starswarm/engine";
import type { StarSwarmState } from "../../../game/starswarm/engine";
import { WAVE_COUNTDOWN_MS } from "../../../game/starswarm/constants";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handlers = Partial<Record<"onBegin" | "onChange" | "onEnd" | "onFinalize", (e: any) => void>>;
const mockPan: { current: Handlers } = { current: {} };

jest.mock("react-native-gesture-handler", () => ({
  GestureDetector: ({ gesture, children }: any) => {
    mockPan.current = gesture ? gesture.__handlers : {};
    return children;
  },
  GestureHandlerRootView: ({ children }: any) => children,
  Gesture: {
    Pan: () => {
      const handlers: Handlers = {};
      const b: any = new Proxy(
        {},
        {
          get: (_t, prop: string) => {
            if (prop === "__handlers") return handlers;
            return (arg?: unknown) => {
              if (prop.startsWith("on")) (handlers as any)[prop] = arg;
              return b;
            };
          },
        }
      );
      return b;
    },
  },
}));
/* eslint-enable @typescript-eslint/no-explicit-any */

const HW = PLAYER_W / 2;
const MIN_X = HW;
const MAX_X = CANVAS_W - HW;
const FRAME_MS = 16;
const DRAG_Y = CANVAS_H; // well inside the bottom drag zone at any scale

class FakeCanvas {
  state: StarSwarmState = initStarSwarm(CANVAS_W, CANVAS_H, 1, 7, "LieutenantJG");
  input = { playerX: CANVAS_W / 2, fire: false };
  countdownMs: number | null = null;

  handle: GameCanvasHandle = {
    setPlayerX: (x: number) => {
      this.input.playerX = x;
    },
    getPlayerX: () => Math.max(MIN_X, Math.min(MAX_X, this.input.playerX)),
    getState: () => this.state,
  } as unknown as GameCanvasHandle;

  /** One frame of GameCanvas's loop. */
  frame(dtMs = FRAME_MS) {
    if (this.countdownMs !== null) {
      this.countdownMs = Math.max(0, this.countdownMs - dtMs);
      if (this.countdownMs === 0) this.countdownMs = null;
      return;
    }
    this.state = tick(this.state, dtMs, { playerX: this.input.playerX, fire: false });
  }

  get x() {
    return this.state.player.x;
  }
}

async function setup(scale = 1) {
  const canvas = new FakeCanvas();
  const ref = { current: canvas.handle } as React.RefObject<GameCanvasHandle | null>;
  await render(
    <Controls
      canvasRef={ref}
      scale={scale}
      isLiveRun
      isPaused={false}
      onPause={jest.fn()}
      onResume={jest.fn()}
      onNewGame={jest.fn()}
    />
  );
  const pan = () => mockPan.current;
  return {
    canvas,
    begin: () => pan().onBegin?.({ y: DRAG_Y * scale, translationX: 0 }),
    /** Move the finger to `translationX` screen px from touch-down, then run an engine frame. */
    moveTo: (translationX: number) => {
      pan().onChange?.({ y: DRAG_Y * scale, translationX });
      canvas.frame();
    },
    release: (translationX: number) => {
      pan().onEnd?.({ y: DRAG_Y * scale, translationX });
      pan().onFinalize?.({});
    },
  };
}

describe.each([1, 1.5])("Controls edge drag through canvas + engine (scale %s)", (scale) => {
  it("drag hard past the right edge, then reverse left moves the ship immediately", async () => {
    const t = await setup(scale);
    t.canvas.input.playerX = 330;
    t.canvas.frame();
    t.begin();
    for (const tx of [10, 40, 120, 300]) t.moveTo(tx * scale);
    expect(t.canvas.x).toBe(MAX_X);
    // finger still down; first reversal frame already moves the ship
    t.moveTo(299 * scale);
    expect(t.canvas.x).toBeCloseTo(MAX_X - 1, 5);
    t.moveTo(250 * scale);
    expect(t.canvas.x).toBeCloseTo(MAX_X - 50, 5);
  });

  it("drag hard past the left edge, then reverse right moves immediately", async () => {
    const t = await setup(scale);
    t.canvas.input.playerX = 30;
    t.canvas.frame();
    t.begin();
    for (const tx of [-10, -60, -400]) t.moveTo(tx * scale);
    expect(t.canvas.x).toBe(MIN_X);
    t.moveTo(-398 * scale);
    expect(t.canvas.x).toBeCloseTo(MIN_X + 2, 5);
    t.moveTo(-300 * scale);
    expect(t.canvas.x).toBeCloseTo(MIN_X + 100, 5);
  });

  it("release at the right edge, then a new drag left moves immediately", async () => {
    const t = await setup(scale);
    t.begin();
    t.moveTo(500 * scale);
    t.release(500 * scale);
    expect(t.canvas.x).toBe(MAX_X);
    t.begin();
    t.moveTo(-1 * scale);
    expect(t.canvas.x).toBeCloseTo(MAX_X - 1, 5);
    t.moveTo(-80 * scale);
    expect(t.canvas.x).toBeCloseTo(MAX_X - 80, 5);
  });

  it("release at the left edge, then a new drag right moves immediately", async () => {
    const t = await setup(scale);
    t.begin();
    t.moveTo(-500 * scale);
    t.release(-500 * scale);
    expect(t.canvas.x).toBe(MIN_X);
    t.begin();
    t.moveTo(1 * scale);
    expect(t.canvas.x).toBeCloseTo(MIN_X + 1, 5);
    t.moveTo(90 * scale);
    expect(t.canvas.x).toBeCloseTo(MIN_X + 90, 5);
  });

  it("rapid repeated boundary hits and reversals never stall the ship", async () => {
    const t = await setup(scale);
    t.begin();
    let tx = 0;
    for (let i = 0; i < 20; i++) {
      // slam the right wall, come back 30 px, slam the left wall, come back 30 px
      tx += 400;
      t.moveTo(tx * scale);
      expect(t.canvas.x).toBe(MAX_X);
      tx -= 30;
      t.moveTo(tx * scale);
      expect(t.canvas.x).toBeCloseTo(MAX_X - 30, 5);
      tx -= 800;
      t.moveTo(tx * scale);
      expect(t.canvas.x).toBe(MIN_X);
      tx += 30;
      t.moveTo(tx * scale);
      expect(t.canvas.x).toBeCloseTo(MIN_X + 30, 5);
    }
  });

  it("a wave-transition countdown at the edge leaves no stale anchor", async () => {
    const t = await setup(scale);
    t.begin();
    t.moveTo(500 * scale);
    t.release(500 * scale);
    expect(t.canvas.x).toBe(MAX_X);

    // Wave clears: engine freezes for the countdown. The player drags across the field to the
    // left wall during it: engine player.x does NOT update (no ticks), the commanded X does.
    t.canvas.countdownMs = WAVE_COUNTDOWN_MS;
    t.begin();
    t.moveTo(-600 * scale);
    t.release(-600 * scale);
    expect(t.canvas.x).toBe(MAX_X); // engine still frozen at the old X
    expect(t.canvas.handle.getPlayerX()).toBe(MIN_X);

    // A new touch mid-countdown must anchor at the left wall, not the stale engine X.
    t.begin();
    t.moveTo(1 * scale);
    expect(t.canvas.handle.getPlayerX()).toBeCloseTo(MIN_X + 1, 5);
    t.release(1 * scale);

    // Countdown ends; the ship resumes where it was left, and a new drag re-anchors on it.
    while (t.canvas.countdownMs !== null) t.canvas.frame();
    t.canvas.frame();
    expect(t.canvas.x).toBeCloseTo(MIN_X + 1, 5);
    t.begin();
    t.moveTo(40 * scale);
    expect(t.canvas.x).toBeCloseTo(MIN_X + 41, 5);
  });

  it("every new gesture re-anchors from the current ship X, wherever it was moved", async () => {
    const t = await setup(scale);
    t.begin();
    t.moveTo(30 * scale);
    t.release(30 * scale);
    // Something else moves the ship (new game reset, resume, dev tools) between gestures.
    t.canvas.input.playerX = 100;
    t.canvas.frame();
    expect(t.canvas.x).toBe(100);
    t.begin();
    t.moveTo(25 * scale);
    expect(t.canvas.x).toBeCloseTo(125, 5);
    t.release(25 * scale);
    t.canvas.input.playerX = MAX_X;
    t.canvas.frame();
    t.begin();
    t.moveTo(-10 * scale);
    expect(t.canvas.x).toBeCloseTo(MAX_X - 10, 5);
  });

  it("touches above the drag zone do not move the ship", async () => {
    const t = await setup(scale);
    mockPan.current.onBegin?.({ y: 1, translationX: 0 });
    mockPan.current.onChange?.({ y: 1, translationX: 100 * scale });
    t.canvas.frame();
    expect(t.canvas.x).toBe(CANVAS_W / 2);
  });
});

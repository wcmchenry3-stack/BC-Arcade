/**
 * @jest-environment jsdom
 *
 * #2956: the Star Swarm web canvas (GameCanvas.web.tsx, Expo Web — a secondary
 * platform). Cheap coverage only: the real engine plays a seeded game against a recording 2D
 * context, so the draw path runs end to end, and the loop's callbacks, pause and tab-hide
 * behaviour are pinned. The native renderer (GameCanvas.tsx) is the one tested in depth.
 *
 * The test renderer hands refs a TestInstance, which has no getContext; it is given one for the
 * duration of the suite that returns the recording context for the <canvas> element.
 */
import React from "react";
import { act, render, screen } from "@testing-library/react-native";

import GameCanvas from "../GameCanvas.web";
import type { GameCanvasHandle } from "../GameCanvas.web";
import * as engine from "../../../game/starswarm/engine";
import { closeWave, initStarSwarm, toWirePayload } from "../../../game/starswarm/engine";
import {
  CANVAS_TEST_H as H,
  CANVAS_TEST_W as W,
  createRafHarness,
  seededStarSwarm as seeded,
} from "./helpers/canvasFixtures";

// The real engine; `tick` is wrapped so the #3251 test can force one GameOver tick.
jest.mock("../../../game/starswarm/engine", () => {
  const actual = jest.requireActual("../../../game/starswarm/engine");
  return { ...actual, tick: jest.fn(actual.tick) };
});
jest.mock("expo-asset", () => ({
  Asset: {
    fromModule: () => ({
      downloadAsync: async () => {},
      localUri: "file:///sprite.png",
      uri: null,
    }),
  },
}));

// --- a recording CanvasRenderingContext2D -----------------------------------------------------

const calls: Record<string, number> = {};
const fillTexts: string[] = [];
function recordingContext(): CanvasRenderingContext2D {
  const props: Record<string | symbol, unknown> = {};
  const gradient = { addColorStop: () => {} };
  return new Proxy(props, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        const name = String(prop);
        calls[name] = (calls[name] ?? 0) + 1;
        if (name === "fillText") fillTexts.push(String(args[0]));
        if (name === "measureText") return { width: 10 };
        if (name.startsWith("create")) return gradient;
        return undefined;
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

let proto: Record<string, unknown> | null = null;
const ctx = recordingContext();

// --- hand-cranked RAF (helpers/canvasFixtures.ts) and loadable images ---------------------------

const raf = createRafHarness({ frameMs: 33 });
const { frames } = raf;

class LoadingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = "";
  set src(_v: string) {
    queueMicrotask(() => (mockImagesLoad ? this.onload?.() : this.onerror?.()));
  }
}
let mockImagesLoad = true;
const realImage = window.Image;

beforeAll(() => {
  window.Image = LoadingImage as unknown as typeof window.Image;
});
beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  fillTexts.length = 0;
  mockImagesLoad = true;
  raf.install();
});
afterEach(() => {
  // A test that hides the tab shadows Document.prototype.hidden with an own property.
  delete (document as unknown as { hidden?: boolean }).hidden;
});
afterAll(() => {
  if (proto) delete proto.getContext;
  window.Image = realImage;
  raf.uninstall();
});

async function mount(props: Partial<React.ComponentProps<typeof GameCanvas>> = {}) {
  const ref = React.createRef<GameCanvasHandle>();
  const utils = await render(<GameCanvas ref={ref} width={W} height={H} scale={1} {...props} />);
  if (!proto) {
    proto = Object.getPrototypeOf(screen.root!) as Record<string, unknown>;
    proto.getContext = function (this: { type: string }) {
      return this.type === "canvas" ? ctx : null;
    };
  }
  // Let the sprite loader settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { ...utils, ref };
}

describe("Star Swarm GameCanvas (web)", () => {
  it("renders a labelled canvas element", async () => {
    await mount({ initialState: seeded() });
    expect(screen.getByLabelText(/Star Swarm game/).props.accessibilityRole).toBe("image");
    expect(screen.root!.queryAll((n) => n.type === "canvas")).toHaveLength(1);
  });

  it("plays a seeded game with sprites, drawing every frame and the HUD", async () => {
    const onScoreChange = jest.fn();
    const onExplosion = jest.fn();
    const { ref } = await mount({ initialState: seeded(), onScoreChange, onExplosion });
    await frames(400);
    // The web canvas has no publish gating: exactly one clear-and-redraw per frame (a second
    // draw per frame would be a regression).
    expect(calls.clearRect).toBe(400);
    expect(calls.drawImage).toBeGreaterThan(0);
    expect(fillTexts.some((t) => t.startsWith("SCORE"))).toBe(true);
    expect(fillTexts.some((t) => t.startsWith("WAVE"))).toBe(true);
    expect(ref.current!.getState().score).toBeGreaterThan(0);
    expect(onScoreChange).toHaveBeenCalled();
    expect(onExplosion).toHaveBeenCalled();
  });

  it("draws a boss wave with a Buddy and power-ups in play", async () => {
    const onBossWave = jest.fn();
    const { ref } = await mount({
      initialState: { ...initStarSwarm(W, H, 5, 11, "Captain"), phase: "Playing" },
      onBossWave,
    });
    ref.current!.triggerPowerUp("buddy");
    await frames(2);
    ref.current!.triggerPowerUp("lightning");
    await frames(2);
    ref.current!.triggerPowerUp("bomb");
    await frames(300);
    expect(ref.current!.getState().wave).toBeGreaterThanOrEqual(5);
    expect(calls.clearRect).toBe(304); // one per frame: 2 + 2 + 300
    expect(fillTexts.some((t) => t.includes("Captain"))).toBe(true);
  });

  it("draws fallback shapes when no sprite loads", async () => {
    mockImagesLoad = false;
    await mount({ initialState: seeded() });
    await frames(200);
    expect(calls.drawImage ?? 0).toBe(0);
    expect(calls.fillRect).toBeGreaterThan(0);
    expect(calls.arc).toBeGreaterThan(0);
  });

  it("a new game counts down before the engine moves", async () => {
    const { ref } = await mount();
    const start = ref.current!.getState();
    await frames(30);
    expect(ref.current!.getState()).toBe(start);
    expect(fillTexts).toContain("3");
    await frames(80);
    expect(ref.current!.getState()).not.toBe(start);
  });

  it("paused, the engine does not tick but the frozen frame is still redrawn", async () => {
    const { ref } = await mount({ initialState: seeded(), isPaused: true });
    const start = ref.current!.getState();
    await frames(20);
    expect(ref.current!.getState()).toBe(start);
    // Unlike the native canvas (#2563), the web loop redraws once per frame, paused or not.
    expect(calls.clearRect).toBe(20);
  });

  it("dev-panel injections and the imperative handle reach the engine", async () => {
    const onPowerUpCollect = jest.fn();
    const { ref } = await mount({ initialState: seeded(), onPowerUpCollect });
    ref.current!.triggerPowerUp("shield");
    ref.current!.throwAsteroid();
    ref.current!.killEscorts();
    ref.current!.setFire(false);
    ref.current!.setPlayerX(-100);
    expect(ref.current!.getPlayerX()).toBeGreaterThan(0);
    await frames(5);
    expect(ref.current!.getState().activePowerUp?.type).toBe("shield");
    expect(fillTexts).toContain("SHIELD");
  });

  it("game over calls onGameOver once with the score and wave", async () => {
    const onGameOver = jest.fn();
    const state = seeded();
    await mount({
      initialState: { ...state, player: { ...state.player, lives: 1 } },
      onGameOver,
    });
    for (let i = 0; i < 60 && onGameOver.mock.calls.length === 0; i++) await frames(50);
    expect(onGameOver).toHaveBeenCalledTimes(1);
    const [, wave] = onGameOver.mock.calls[0]!;
    expect(wave).toBe(1);
  });

  it("hiding the tab mid-play pauses the game", async () => {
    const onPause = jest.fn();
    await mount({ initialState: seeded(), onPause });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onPause).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("resetTick starts over from the dev options", async () => {
    const onBossWave = jest.fn();
    const { ref, rerender } = await mount({ initialState: seeded({ score: 500 }), onBossWave });
    await rerender(
      <GameCanvas
        ref={ref}
        width={W}
        height={H}
        scale={1}
        resetTick={1}
        onBossWave={onBossWave}
        devOptions={{ wave: 5, difficulty: "Captain", infiniteLives: true }}
      />
    );
    expect(ref.current!.getState()).toMatchObject({ wave: 5, score: 0, difficulty: "Captain" });
    expect(onBossWave).toHaveBeenCalledTimes(1);
  });

  it("#3251: infinite lives flags the died close it reverts, and the rest of the wave, dev", async () => {
    const onGameOver = jest.fn();
    const { ref, rerender } = await mount({ initialState: seeded(), onGameOver });
    await rerender(
      <GameCanvas
        ref={ref}
        width={W}
        height={H}
        scale={1}
        resetTick={1}
        onGameOver={onGameOver}
        devOptions={{ infiniteLives: true }}
      />
    );
    await frames(100); // run out the countdown
    // the engine's GameOver tick: lives gone, the wave closed as died
    const realTick = jest.requireActual<typeof engine>("../../../game/starswarm/engine").tick;
    (engine.tick as jest.MockedFunction<typeof engine.tick>).mockImplementationOnce(
      (s, dt, input) => {
        const over = { ...realTick(s, dt, input), phase: "GameOver" as const };
        const lost = { ...over, player: { ...over.player, lives: 0 } };
        return {
          ...lost,
          closedWaves: [...s.closedWaves, toWirePayload(closeWave(lost, "died"))],
        };
      }
    );
    await frames(1);
    const state = ref.current!.getState();
    expect(onGameOver).not.toHaveBeenCalled();
    expect(state.closedWaves).toEqual([expect.objectContaining({ outcome: "died", dev: true })]);
    expect(state.waveStats.dev).toBe(true);
    expect(closeWave(state, "cleared").dev).toBe(true);
  });
});

describe("Star Swarm GameCanvas (web) — the wave-timeline flag (#3393)", () => {
  it("asks timelineEnabled once when it creates a run, never per frame or render", async () => {
    const timelineEnabled = jest.fn(() => true);
    const { ref, rerender } = await mount({ timelineEnabled });
    expect(timelineEnabled).toHaveBeenCalledTimes(1);
    expect(ref.current!.getState()).toMatchObject({ timelineOn: true, timelineLost: false });
    expect(ref.current!.getState().waveTimeline).not.toBeNull();
    const ui = (p: Partial<React.ComponentProps<typeof GameCanvas>>) => (
      <GameCanvas
        ref={ref}
        width={W}
        height={H}
        scale={1}
        timelineEnabled={timelineEnabled}
        {...p}
      />
    );
    // frames and re-renders (a new prop) don't ask again
    await frames(30);
    await rerender(ui({ highScore: 99 }));
    await frames(5);
    expect(timelineEnabled).toHaveBeenCalledTimes(1);
    // a new run asks again, and its answer is the new run's flag for good
    timelineEnabled.mockReturnValue(false);
    await rerender(ui({ highScore: 99, resetTick: 1 }));
    expect(timelineEnabled).toHaveBeenCalledTimes(2);
    expect(ref.current!.getState()).toMatchObject({ timelineOn: false, waveTimeline: null });
    await frames(5);
    await rerender(ui({ highScore: 100, resetTick: 1 }));
    expect(timelineEnabled).toHaveBeenCalledTimes(2);
  });

  it("without the prop, a run records no timelines", async () => {
    const { ref } = await mount();
    expect(ref.current!.getState()).toMatchObject({ timelineOn: false, waveTimeline: null });
  });

  it("a restored run keeps its own flag and doesn't ask", async () => {
    const timelineEnabled = jest.fn(() => true);
    const { ref } = await mount({ initialState: seeded(), timelineEnabled });
    expect(timelineEnabled).not.toHaveBeenCalled();
    expect(ref.current!.getState().timelineOn).toBe(false);
  });
});

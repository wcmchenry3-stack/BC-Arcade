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
import { AccessibilityInfo } from "react-native";
import { act, render, screen } from "@testing-library/react-native";

import type { StarSwarmState } from "../../../game/starswarm/types";
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
  // `initStarSwarm` is wrapped too so the #3416 test can count how many runs are built.
  return { ...actual, tick: jest.fn(actual.tick), initStarSwarm: jest.fn(actual.initStarSwarm) };
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

describe("Star Swarm GameCanvas (web) — one run per mount and per reset (#3416)", () => {
  it("builds the run once on mount and once per reset, never once per render", async () => {
    const initSpy = engine.initStarSwarm as jest.MockedFunction<typeof engine.initStarSwarm>;
    initSpy.mockClear();
    const ref = React.createRef<GameCanvasHandle>();
    const ui = (p: Partial<React.ComponentProps<typeof GameCanvas>>) => (
      <GameCanvas ref={ref} width={W} height={H} scale={1} {...p} />
    );
    const { rerender } = await render(ui({}));
    expect(initSpy).toHaveBeenCalledTimes(1);
    await rerender(ui({ highScore: 1 }));
    await rerender(ui({ highScore: 2 }));
    await rerender(ui({ highScore: 3 }));
    expect(initSpy).toHaveBeenCalledTimes(1);
    await rerender(ui({ highScore: 3, resetTick: 1 }));
    expect(initSpy).toHaveBeenCalledTimes(2);
    await rerender(ui({ highScore: 4, resetTick: 1 }));
    await rerender(ui({ highScore: 5, resetTick: 1 }));
    expect(initSpy).toHaveBeenCalledTimes(2);
  });
});

describe("Star Swarm GameCanvas (web) — banked power-ups (#3512)", () => {
  const mockTick = engine.tick as jest.MockedFunction<typeof engine.tick>;
  const realTick = jest.requireActual<typeof engine>("../../../game/starswarm/engine").tick;
  afterEach(() => mockTick.mockImplementation(realTick));

  it("draws the new pickup-wait cue while pickups hold the cleared wave", async () => {
    const pickup = {
      id: 9001,
      type: "shield" as const,
      x: 100,
      y: 200,
      vy: 0,
      width: 20,
      height: 20,
      despawnTimer: 5000,
    };
    mockTick.mockImplementation((st) => st); // hold the wait still
    await mount({
      initialState: seeded({ enemies: [], phase: "ClearAwaitingPickups", powerUps: [pickup] }),
    });
    await frames(2);
    expect(fillTexts).toContain("QUICK, GRAB 'EM — THEY CARRY OVER!");
  });

  it("draws NEXT WAVE when one is banked and UP! when it applies, each announced once", async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    announce.mockClear();
    mockTick.mockImplementation((st) => st);
    try {
      await mount({ initialState: seeded({ enemies: [], phase: "ClearAwaitingPickups" }) });
      await frames(1);
      mockTick.mockImplementationOnce((st) => ({ ...st, bankedPowerUp: "bomb" }));
      await frames(3);
      expect(fillTexts).toContain("BOMB → NEXT WAVE");
      mockTick.mockImplementationOnce((st) => ({ ...st, phase: "SwoopIn" }));
      await frames(1);
      mockTick.mockImplementationOnce((st) => ({ ...st, phase: "Playing", bankedPowerUp: null }));
      await frames(3);
      expect(fillTexts).toContain("BOMBS AWAY!");
      const spoken = announce.mock.calls.map(([m]) => String(m));
      expect(spoken.filter((m) => m === "Smart Bomb saved for the next wave.")).toHaveLength(1);
      expect(spoken.filter((m) => m === "Smart Bomb away.")).toHaveLength(1);
    } finally {
      announce.mockRestore();
    }
  });
});

describe("Star Swarm GameCanvas (web) — sound events (#3526)", () => {
  const step = () => frames(1);
  const steps = frames;
  const mockTick = engine.tick as jest.MockedFunction<typeof engine.tick>;
  const realTick = jest.requireActual<typeof engine>("../../../game/starswarm/engine").tick;
  const nextTick = (change: (s: StarSwarmState) => StarSwarmState) =>
    mockTick.mockImplementationOnce((s) => change(s));
  beforeEach(() => mockTick.mockImplementation((s) => s));
  afterEach(() => mockTick.mockImplementation(realTick));

  const shielded = { type: "shield" as const, remainingMs: 5000, shieldAbsorbed: 0 };
  const explosion = { id: 1 } as unknown as StarSwarmState["explosions"][number];
  /** The wave's collected tally, one higher for `type` (what the engine does on a collection). */
  const collected = (
    s: StarSwarmState,
    type: "bomb" | "shield" | "salvage" | "hull"
  ): StarSwarmState => ({
    ...s,
    waveStats: {
      ...s.waveStats,
      powerUps: {
        ...s.waveStats.powerUps,
        collected: {
          ...s.waveStats.powerUps.collected,
          [type]: s.waveStats.powerUps.collected[type] + 1,
        },
      },
    },
  });

  it("#3561: raises the reinforce Carrier event on the bay-open edge only", async () => {
    const onCarrierEvent = jest.fn();
    await mount({ initialState: seeded(), onCarrierEvent });
    await step();
    nextTick((s) => ({ ...s, carrierBayOpen: 400 }));
    await step();
    expect(onCarrierEvent.mock.calls.map((c) => c[0])).toEqual(["reinforce"]);
    // the bay running down is not an edge, and neither is the launch 400 ms later
    nextTick((s) => ({ ...s, carrierBayOpen: 200 }));
    await step();
    nextTick((s) => ({ ...s, carrierBayOpen: 0, reinforcedThisWave: s.reinforcedThisWave + 3 }));
    await step();
    expect(onCarrierEvent).toHaveBeenCalledTimes(1);
  });

  it("a Smart Bomb detonation reports onBombBlast and skips the generic explosion that tick", async () => {
    const cb = { onBombBlast: jest.fn(), onExplosion: jest.fn() };
    await mount({ initialState: seeded(), ...cb });
    await step();
    nextTick((s) => ({ ...s, bombFlashTimer: 300, explosions: [...s.explosions, explosion] }));
    await step();
    expect(cb.onBombBlast).toHaveBeenCalledTimes(1);
    expect(cb.onExplosion).not.toHaveBeenCalled();
    // the flash only counts down on the following ticks: no second blast
    nextTick((s) => ({ ...s, bombFlashTimer: 284 }));
    await step();
    expect(cb.onBombBlast).toHaveBeenCalledTimes(1);
  });

  it("a dev-panel Smart Bomb reports onBombBlast once, outside the tick", async () => {
    const cb = { onBombBlast: jest.fn(), onExplosion: jest.fn() };
    const { ref } = await mount({ initialState: seeded(), ...cb });
    await step();
    ref.current!.triggerPowerUp("bomb");
    await step();
    await step();
    expect(cb.onBombBlast).toHaveBeenCalledTimes(1);
    // another injection is not a bomb
    ref.current!.triggerPowerUp("shield");
    await step();
    expect(cb.onBombBlast).toHaveBeenCalledTimes(1);
  });

  it("a collected crate or plating reports onPowerUpCollect from the tally, even at max level", async () => {
    const onPowerUpCollect = jest.fn();
    await mount({ initialState: seeded(), onPowerUpCollect });
    await step();
    nextTick((s) => collected(s, "salvage"));
    await step();
    nextTick((s) => collected(s, "hull"));
    await step();
    expect(onPowerUpCollect.mock.calls).toEqual([["salvage"], ["hull"]]);
  });

  it("an ordinary explosion still reports onExplosion", async () => {
    const cb = { onBombBlast: jest.fn(), onExplosion: jest.fn() };
    await mount({ initialState: seeded(), ...cb });
    await step();
    nextTick((s) => ({ ...s, explosions: [...s.explosions, explosion] }));
    await step();
    expect(cb.onExplosion).toHaveBeenCalledTimes(1);
    expect(cb.onBombBlast).not.toHaveBeenCalled();
  });

  /** A rock of `kind` mid-field (cast: the sound check reads only id, kind, position, velocity). */
  const rock = (id: number, kind: "large" | "small") =>
    ({ id, kind, x: 100, y: 100, vx: 0, vy: 0.1, radius: 10, hp: 1 }) as never;
  /** One rock broke this tick: it leaves the list, a `player` break is counted and it explodes. */
  const rockBroke = (s: StarSwarmState, id: number, extraExplosions = 0): StarSwarmState => ({
    ...s,
    asteroids: s.asteroids.filter((a) => a.id !== id),
    explosions: [...s.explosions, ...Array(1 + extraExplosions).fill(explosion)],
    waveStats: {
      ...s.waveStats,
      rocks: {
        ...s.waveStats.rocks,
        broken: { ...s.waveStats.rocks.broken, player: s.waveStats.rocks.broken.player + 1 },
      },
    },
  });

  it("a rock break reports onRockBreak by size and skips the generic explosion (#3560)", async () => {
    const cb = { onRockBreak: jest.fn(), onExplosion: jest.fn() };
    await mount({ initialState: seeded(), ...cb });
    await step();
    nextTick((s) => ({ ...s, asteroids: [rock(901, "large"), rock(902, "small")] }));
    await step();
    nextTick((s) => rockBroke(s, 902));
    await step();
    expect(cb.onRockBreak.mock.calls).toEqual([["small"]]);
    nextTick((s) => rockBroke(s, 901));
    await step();
    expect(cb.onRockBreak.mock.calls).toEqual([["small"], ["large"]]);
    expect(cb.onExplosion).not.toHaveBeenCalled();
  });

  it("a rock break and an enemy kill on one tick sound both (#3560)", async () => {
    const cb = { onRockBreak: jest.fn(), onExplosion: jest.fn() };
    await mount({ initialState: seeded(), ...cb });
    await step();
    nextTick((s) => ({ ...s, asteroids: [rock(901, "large")] }));
    await step();
    nextTick((s) => rockBroke(s, 901, 1));
    await step();
    expect(cb.onRockBreak.mock.calls).toEqual([["large"]]);
    expect(cb.onExplosion).toHaveBeenCalledTimes(1);
  });

  it("a Smart Bomb tick that clears rocks plays the bomb blast only (#3560)", async () => {
    const cb = { onBombBlast: jest.fn(), onRockBreak: jest.fn(), onExplosion: jest.fn() };
    await mount({ initialState: seeded(), ...cb });
    await step();
    nextTick((s) => ({ ...s, asteroids: [rock(901, "large")] }));
    await step();
    nextTick((s) => ({ ...rockBroke(s, 901), bombFlashTimer: 300 }));
    await step();
    expect(cb.onBombBlast).toHaveBeenCalledTimes(1);
    expect(cb.onRockBreak).not.toHaveBeenCalled();
    expect(cb.onExplosion).not.toHaveBeenCalled();
  });

  it("a collected power-up (banked or not) reports onPowerUpCollect once, even if its buff rises on that tick", async () => {
    const onPowerUpCollect = jest.fn();
    await mount({ initialState: seeded(), onPowerUpCollect });
    await step();
    nextTick((s) => collected(s, "bomb"));
    await step();
    expect(onPowerUpCollect.mock.calls).toEqual([["bomb"]]);
    nextTick((s) => ({ ...collected(s, "shield"), activePowerUp: shielded }));
    await step();
    expect(onPowerUpCollect.mock.calls).toEqual([["bomb"], ["shield"]]);
  });

  it("a banked power-up taking effect on the next wave is not announced a second time", async () => {
    const onPowerUpCollect = jest.fn();
    await mount({ initialState: seeded({ bankedPowerUp: "shield" }), onPowerUpCollect });
    await step();
    nextTick((s) => ({ ...s, bankedPowerUp: null, activePowerUp: shielded }));
    await step();
    expect(onPowerUpCollect).not.toHaveBeenCalled();
  });

  it("reports each loop only when its condition changes", async () => {
    const onLoopChange = jest.fn();
    await mount({ initialState: seeded(), onLoopChange });
    await step();
    await steps(3);
    expect(onLoopChange).not.toHaveBeenCalled();

    nextTick((s) => ({ ...s, activePowerUp: shielded }));
    await step();
    nextTick((s) => ({ ...s, activePowerUp: shielded }));
    await step();
    expect(onLoopChange.mock.calls).toEqual([["shield", true]]);

    nextTick((s) => ({
      ...s,
      activePowerUp: null,
      buddyShips: [{ id: 1, phase: "OnStation" } as never],
    }));
    await step();
    expect(onLoopChange.mock.calls.slice(1)).toEqual([
      ["shield", false],
      ["buddy", true],
    ]);

    nextTick((s) => ({
      ...s,
      buddyShips: [],
      enemies: s.enemies.map((e, i) => (i === 0 ? { ...e, isAlive: true, phase: "Fleeing" } : e)),
    }));
    await step();
    expect(onLoopChange.mock.calls.slice(3)).toEqual([
      ["buddy", false],
      ["rout", true],
    ]);
  });
});

describe("Star Swarm GameCanvas (web) — Shield, Buddy and Lightning sounds (#3560)", () => {
  const step = () => frames(1);
  const mockTick = engine.tick as jest.MockedFunction<typeof engine.tick>;
  const realTick = jest.requireActual<typeof engine>("../../../game/starswarm/engine").tick;
  const nextTick = (change: (s: StarSwarmState) => StarSwarmState) =>
    mockTick.mockImplementationOnce((s) => change(s));
  beforeEach(() => mockTick.mockImplementation((s) => s));
  afterEach(() => mockTick.mockImplementation(realTick));

  const buff = (type: "shield" | "lightning", remainingMs: number) => ({
    type,
    remainingMs,
    shieldAbsorbed: 0,
  });
  const explosion = { id: 1 } as unknown as StarSwarmState["explosions"][number];
  const launched = (s: StarSwarmState): StarSwarmState => ({
    ...s,
    runStats: { ...s.runStats, buddyLaunched: s.runStats.buddyLaunched + 1 },
    buddyShips: [...s.buddyShips, { id: 7, phase: "Entering" } as never],
  });
  const phased = (s: StarSwarmState, phase: "OnStation" | "Leaving"): StarSwarmState => ({
    ...s,
    buddyShips: s.buddyShips.map((b) => ({ ...b, phase })),
  });

  it("reports a bonus life once per award (web had no bonus-life callback before #3560)", async () => {
    const onBonusLife = jest.fn();
    await mount({ initialState: seeded(), onBonusLife });
    await step();
    nextTick((s) => ({ ...s, bonusLivesAwarded: s.bonusLivesAwarded + 1 }));
    await step();
    expect(onBonusLife).toHaveBeenCalledTimes(1);
    await step(); // no new award, no new call
    expect(onBonusLife).toHaveBeenCalledTimes(1);
    nextTick((s) => ({ ...s, bonusLivesAwarded: s.bonusLivesAwarded + 1 }));
    await step();
    expect(onBonusLife).toHaveBeenCalledTimes(2);
  });

  it("a Shield cues on once, warns once at 1 s left, and cues off once when it ends", async () => {
    const onSoundCue = jest.fn();
    await mount({ initialState: seeded(), onSoundCue });
    await step();
    nextTick((s) => ({ ...s, activePowerUp: buff("shield", 5000) }));
    await step();
    nextTick((s) => ({ ...s, activePowerUp: buff("shield", 1016) }));
    await step();
    nextTick((s) => ({ ...s, activePowerUp: buff("shield", 1000) }));
    await step();
    nextTick((s) => ({ ...s, activePowerUp: buff("shield", 984) }));
    await step();
    nextTick((s) => ({ ...s, activePowerUp: null }));
    await step();
    await step();
    expect(onSoundCue.mock.calls).toEqual([["shieldOn"], ["shieldWarn"], ["shieldOff"]]);
  });

  it("Lightning replacing a Shield cues the Shield off and starts the Lightning loop", async () => {
    const onSoundCue = jest.fn();
    const onLoopChange = jest.fn();
    await mount({ initialState: seeded(), onSoundCue, onLoopChange });
    await step();
    nextTick((s) => ({ ...s, activePowerUp: buff("shield", 3000) }));
    await step();
    nextTick((s) => ({ ...s, activePowerUp: buff("lightning", 5000) }));
    await step();
    expect(onSoundCue.mock.calls).toEqual([["shieldOn"], ["shieldOff"]]);
    expect(onLoopChange.mock.calls).toEqual([
      ["shield", true],
      ["shield", false],
      ["lightning", true],
    ]);
    nextTick((s) => ({ ...s, activePowerUp: null }));
    await step();
    expect(onLoopChange).toHaveBeenLastCalledWith("lightning", false);
  });

  it("a Buddy cues in when launched, out when it peels off; its loop runs only on station", async () => {
    const onSoundCue = jest.fn();
    const onLoopChange = jest.fn();
    await mount({ initialState: seeded(), onSoundCue, onLoopChange });
    await step();
    nextTick(launched);
    await step();
    expect(onSoundCue.mock.calls).toEqual([["buddyIn"]]);
    expect(onLoopChange).not.toHaveBeenCalled(); // Entering: the thrusters cover it
    nextTick((s) => phased(s, "OnStation"));
    await step();
    expect(onLoopChange.mock.calls).toEqual([["buddy", true]]);
    nextTick((s) => phased(s, "Leaving"));
    await step();
    expect(onSoundCue.mock.calls).toEqual([["buddyIn"], ["buddyOut"]]);
    expect(onLoopChange.mock.calls).toEqual([
      ["buddy", true],
      ["buddy", false],
    ]);
    // a second launch cues in again
    nextTick((s) => launched({ ...s, buddyShips: [] }));
    await step();
    expect(onSoundCue.mock.calls.at(-1)).toEqual(["buddyIn"]);
  });

  it("a Buddy shot down reports onBuddyLost, no out cue, and skips the generic explosion", async () => {
    const cb = { onBuddyLost: jest.fn(), onExplosion: jest.fn(), onSoundCue: jest.fn() };
    await mount({ initialState: seeded(), ...cb });
    await step();
    nextTick(launched);
    await step();
    nextTick((s) => phased(s, "OnStation"));
    await step();
    cb.onSoundCue.mockClear();
    nextTick((s) => ({
      ...s,
      buddyShips: [],
      runStats: { ...s.runStats, buddyLost: s.runStats.buddyLost + 1 },
      explosions: [...s.explosions, explosion],
    }));
    await step();
    expect(cb.onBuddyLost).toHaveBeenCalledTimes(1);
    expect(cb.onExplosion).not.toHaveBeenCalled();
    expect(cb.onSoundCue).not.toHaveBeenCalled();
    // an ordinary explosion on a later tick still sounds
    nextTick((s) => ({ ...s, explosions: [...s.explosions, { ...explosion, id: 2 }] })); // a new explosion (new id)
    await step();
    expect(cb.onExplosion).toHaveBeenCalledTimes(1);
  });

  it("dev-panel injections sound too: Shield cues on, Lightning starts its loop, Buddy cues in", async () => {
    const onSoundCue = jest.fn();
    const onLoopChange = jest.fn();
    const { ref } = await mount({ initialState: seeded(), onSoundCue, onLoopChange });
    await step();
    ref.current!.triggerPowerUp("shield");
    await step();
    await step();
    expect(onSoundCue.mock.calls).toEqual([["shieldOn"]]);
    expect(onLoopChange.mock.calls).toEqual([["shield", true]]);
    ref.current!.triggerPowerUp("lightning");
    await step();
    await step();
    expect(onSoundCue.mock.calls).toEqual([["shieldOn"], ["shieldOff"]]);
    expect(onLoopChange.mock.calls.slice(1)).toEqual([
      ["shield", false],
      ["lightning", true],
    ]);
    ref.current!.triggerPowerUp("buddy");
    await step();
    expect(onSoundCue.mock.calls.at(-1)).toEqual(["buddyIn"]);
  });
});

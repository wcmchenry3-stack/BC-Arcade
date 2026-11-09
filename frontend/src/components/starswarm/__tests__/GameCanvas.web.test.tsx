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

import type { Asteroid, StarSwarmState } from "../../../game/starswarm/types";
import GameCanvas from "../GameCanvas.web";
import type { GameCanvasHandle } from "../GameCanvas.web";
import * as engine from "../../../game/starswarm/engine";
import { lightningBeamOps } from "../../../game/starswarm/render/lightningBeam";
import { drawEnemyOps, ENEMY_SPRITES, enemyOps } from "../../../game/starswarm/render/enemies";
import { SHOT_SPRITES, shotOps } from "../../../game/starswarm/render/shots";
import { PICKUP_FACE, PICKUP_SPRITES, pickupOps } from "../../../game/starswarm/render/pickups";
import { buildFrame, type LoadedSprites } from "../../../game/starswarm/render/frame";
import { effectOps } from "../../../game/starswarm/render/explosions";
import { buildWebBackdrop } from "../../../game/starswarm/render/nebula";
import { cssColor, opaque } from "../../../game/starswarm/render/color";
import { setDebugOpKeys } from "../../../game/starswarm/render/opKeys";
import {
  ASTEROID_EDGE_RGB,
  BOMB_TINT_RGB,
  PICKUP_BEVEL,
} from "../../../game/starswarm/render/palette";
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
// #3562: wrapped so the beam test can see the shared ops the web canvas replays.
jest.mock("../../../game/starswarm/render/lightningBeam", () => {
  const actual = jest.requireActual("../../../game/starswarm/render/lightningBeam");
  return { ...actual, lightningBeamOps: jest.fn(actual.lightningBeamOps) };
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

// #3597: wrapped so the background test can count how often the nebula is painted.
jest.mock("../../../game/starswarm/render/nebula", () => {
  const actual = jest.requireActual("../../../game/starswarm/render/nebula");
  return { ...actual, buildWebBackdrop: jest.fn(actual.buildWebBackdrop) };
});
// #3597: wrapped so the effects test can see the shared ops the web canvas replays.
jest.mock("../../../game/starswarm/render/explosions", () => {
  const actual = jest.requireActual("../../../game/starswarm/render/explosions");
  return { ...actual, effectOps: jest.fn(actual.effectOps) };
});

// #3593: wrapped so the enemy test can see the shared ops the web canvas replays.
jest.mock("../../../game/starswarm/render/enemies", () => {
  const actual = jest.requireActual("../../../game/starswarm/render/enemies");
  return {
    ...actual,
    enemyOps: jest.fn(actual.enemyOps),
    drawEnemyOps: jest.fn(actual.drawEnemyOps),
  };
});

// --- a recording CanvasRenderingContext2D -----------------------------------------------------

const calls: Record<string, number> = {};
const fillTexts: string[] = [];
/** Every `drawImage` call's rect (x, y, w, h) on the main context, in order (#3592). */
const imageRects: number[][] = [];
/** The image each `drawImage` call on the main context drew, in order (#3600). */
const drawnImages: unknown[] = [];
/** Every `fillRect` call's rect on the main context (#3593: no HP pips). */
const filledRects: number[][] = [];
/** #3597: every fill and stroke on the main context, in order, with the style it painted in. */
const paints: string[] = [];
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
        if (name === "fillRect") filledRects.push(args as number[]);
        if (name === "fill" || name === "fillRect")
          paints.push(`${name} ${String(target.fillStyle)}`);
        if (name === "stroke") paints.push(`stroke ${String(target.strokeStyle)}`);
        if (name === "drawImage") {
          imageRects.push(args.slice(1) as number[]);
          drawnImages.push(args[0]);
        }
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

/** Images are made in the loader's order: 5 layers each for P1, P2, P3, then the rest (#3600). */
let imageCount = 0;
class LoadingImage {
  readonly id = imageCount++;
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
  imageRects.length = 0;
  drawnImages.length = 0;
  filledRects.length = 0;
  paints.length = 0;
  imageCount = 0;
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

  describe("the rocks (#3596)", () => {
    /** An offscreen context that records the bakes (one per rock body and palette). */
    const offscreen = { drawImage: jest.fn(), fillRect: jest.fn() } as Record<string, unknown>;
    let spy: jest.SpyInstance;
    beforeEach(() => {
      offscreen.drawImage = jest.fn();
      offscreen.fillRect = jest.fn();
      spy = jest
        .spyOn(HTMLCanvasElement.prototype, "getContext")
        .mockReturnValue(offscreen as unknown as RenderingContext);
    });
    afterEach(() => spy.mockRestore());
    // A decoded rock image has a size (the bake is made at it); the shared stand-in has none
    beforeAll(() => {
      for (const k of ["width", "height"])
        Object.defineProperty(LoadingImage.prototype, k, { value: 144, configurable: true });
    });
    afterAll(() => {
      for (const k of ["width", "height"])
        delete (LoadingImage.prototype as unknown as Record<string, unknown>)[k];
    });

    const large: Asteroid = {
      id: 777,
      kind: "large",
      x: 120,
      y: 300,
      vx: 0,
      vy: 0,
      radius: 22,
      hp: 6,
      rotation: 0.6,
      spin: 0,
      hitFlashTimer: 0,
      hitEnemyIds: [],
    };

    it("draws the shared rock ops from the prebuilt palette bakes: tinted body then veins, rotated, no outline", async () => {
      await mount({ initialState: { ...seeded(), asteroids: [large] }, isPaused: true });
      const baked = (offscreen.drawImage as jest.Mock).mock.calls.length;
      // every body (2 large, 2 small) baked into all 3 palettes up front: 2 drawImage calls each
      expect(baked).toBeGreaterThanOrEqual(4 * 3 * 2);
      imageRects.length = 0;
      drawnImages.length = 0;
      paints.length = 0;
      await frames(2);
      // the rock's two images (48 px: the 44 px box plus the 2 px margin), about its centre
      const rockDraws = imageRects
        .map((r, i) => ({ r, img: drawnImages[i] }))
        .filter(({ r }) => r[2] === 48 && r[3] === 48);
      expect(rockDraws.length).toBe(4); // body + veins, two frames
      expect(rockDraws[0]!.r).toEqual([-24, -24, 48, 48]);
      expect(rockDraws[0]!.img).toBeInstanceOf(HTMLCanvasElement); // the tinted bake
      expect(rockDraws[1]!.img).not.toBeInstanceOf(HTMLCanvasElement); // the veins image
      expect(calls.rotate).toBeGreaterThanOrEqual(2);
      // no fallback outline once the art is there, and no bake rebuilt by a frame
      expect(paints).not.toContain(`stroke ${cssColor(opaque(ASTEROID_EDGE_RGB))}`);
      expect((offscreen.drawImage as jest.Mock).mock.calls.length).toBe(baked);
    });

    it("paints a split's crack over its dust and under the bomb flash (native's order)", async () => {
      // a large rock broken by one shot, as the engine does it, then the bomb flash on top
      const s0 = seeded();
      const big: Asteroid = { ...large, id: 88_000, hp: 1, vx: 0.1, vy: 0.1 };
      const shot = {
        id: 88_500,
        x: big.x,
        y: big.y,
        vx: 0,
        vy: 0,
        owner: "player" as const,
        width: 5,
        height: 14,
        damage: 1,
      };
      let split = engine.tick(
        { ...s0, phase: "Playing", asteroids: [big], playerBullets: [shot], explosions: [] },
        16,
        { playerX: s0.player.x, fire: false }
      );
      split = { ...split, bombFlashTimer: 200 };
      const replayed = effectOps as jest.MockedFunction<typeof effectOps>;
      await mount({ initialState: split, isPaused: true });
      replayed.mockClear();
      paints.length = 0;
      setDebugOpKeys(true); // to find the ops by key
      try {
        await frames(1);
      } finally {
        setDebugOpKeys(false);
      }
      const ops = replayed.mock.results[0]!.value as ReturnType<typeof effectOps>;
      const dust = ops.find((o) => o.key?.endsWith("-ring") && o.key.startsWith("ex-"));
      const crack = ops.find((o) => o.key?.startsWith("crack-") && o.k === "line");
      const tint = ops.find((o) => o.key === "bomb-flash");
      expect(dust && crack && tint).toBeTruthy();
      const at = (o: (typeof ops)[number], how: string) =>
        paints.indexOf(`${how} ${cssColor((o as { color: number }).color)}`);
      expect(at(crack!, "stroke")).toBeGreaterThan(at(dust!, "stroke"));
      expect(at(tint!, "fillRect")).toBeGreaterThan(at(crack!, "stroke"));
    });

    it("draws the outline while the rock images have not loaded", async () => {
      mockImagesLoad = false;
      await mount({ initialState: { ...seeded(), asteroids: [large] }, isPaused: true });
      paints.length = 0;
      await frames(1);
      expect(paints).toContain(`stroke ${cssColor(opaque(ASTEROID_EDGE_RGB))}`);
    });
  });

  describe("the player ship's layers and armour glow (#3592)", () => {
    /** An offscreen canvas context that just counts what is drawn into it. */
    const offscreen = { drawImage: jest.fn(), fillRect: jest.fn() } as Record<string, unknown>;
    const withShip = (guns: 1 | 2 | 3, hull: 0 | 1 | 2) => {
      const s = seeded();
      return { ...s, player: { ...s.player, guns, hull, invincibleTimer: 0 } };
    };
    /** The sprite-sized draws (box 34 + 2 x 4 px margin) of one frame. */
    const shipDraws = () => imageRects.filter(([, , w, h]) => w === 42 && h === 42);
    let spy: jest.SpyInstance;
    beforeEach(() => {
      offscreen.drawImage = jest.fn();
      offscreen.fillRect = jest.fn();
      spy = jest
        .spyOn(HTMLCanvasElement.prototype, "getContext")
        .mockReturnValue(offscreen as unknown as RenderingContext);
    });
    afterEach(() => spy.mockRestore());

    /** What building the six P1 glows (guns 1-3 x hull 1-2) draws: each one's layers, 25 dilate copies and 1 shadow. */
    const SIX_GLOWS = 2 + 3 + 3 + 4 + 4 + 5 + 6 * (25 + 1);

    it("draws only the base layer at gun 1 and hull 0, and builds no glow in the frame", async () => {
      await mount({ initialState: withShip(1, 0) });
      const prebuilt = (offscreen.drawImage as jest.Mock).mock.calls.length;
      imageRects.length = 0;
      await frames(1);
      expect(shipDraws()).toHaveLength(1);
      expect((offscreen.drawImage as jest.Mock).mock.calls.length).toBe(prebuilt);
    });

    it("draws the glow and all five layers at gun 3 and hull 2, centred on the ship", async () => {
      const state = withShip(3, 2);
      await mount({ initialState: state });
      imageRects.length = 0;
      await frames(1);
      const draws = shipDraws();
      expect(draws).toHaveLength(6); // the glow, then base, guns2, guns3, plating1, plating2
      // all six share one rect: the 34 px box plus the margin, so the layers register
      expect(new Set(draws.map((d) => d.join(","))).size).toBe(1);
      const [x, y] = draws[0]!;
      expect(x! + 21).toBeCloseTo(state.player.x, 0);
      expect(y! + 21).toBeCloseTo(state.player.y, 0);
    });

    // The loader makes the layers P1 0-4, P2 5-9, P3 10-14 (base, guns2, guns3, plating1, plating2).

    it("#3600: draws the chosen ship's layers, whichever of the three it is", async () => {
      for (const [ship, first] of [
        ["p1", 0],
        ["p2", 5],
        ["p3", 10],
      ] as const) {
        imageCount = 0; // a fresh mount makes its layers P1 0-4, P2 5-9, P3 10-14
        const { unmount } = await mount({ initialState: withShip(3, 0), ship });
        drawnImages.length = 0;
        imageRects.length = 0;
        await frames(1);
        const ids = drawnImages
          .map((i, n) => ({ id: (i as { id: number }).id, rect: imageRects[n]! }))
          .filter(({ rect }) => rect[2] === 42 && rect[3] === 42)
          .map(({ id }) => id);
        expect(ids).toEqual([first, first + 1, first + 2]); // base, guns2, guns3
        await unmount();
      }
    });

    it("#3600: defaults to the P1 ship when no ship is given", async () => {
      await mount({ initialState: withShip(1, 0) });
      drawnImages.length = 0;
      imageRects.length = 0;
      await frames(1);
      const ids = drawnImages
        .filter((_, n) => imageRects[n]![2] === 42)
        .map((i) => (i as { id: number }).id);
      expect(ids).toEqual([0]);
    });

    it("#3600: builds the armour glows from the chosen ship's layers only", async () => {
      imageCount = 0;
      await mount({ initialState: withShip(2, 1), ship: "p3" });
      const drawn = (offscreen.drawImage as jest.Mock).mock.calls as unknown[][];
      expect(drawn.length).toBe(SIX_GLOWS);
      // layer images are the ones with an id; the glow's own canvases are not
      const layerIds = drawn
        .map((c) => (c[0] as { id?: number }).id)
        .filter((i) => typeof i === "number");
      expect(layerIds.length).toBeGreaterThan(0);
      expect(layerIds.every((i) => i! >= 10 && i! <= 14)).toBe(true);
    });

    it("#3600: builds the new ship's glows when the pick changes after the images loaded", async () => {
      imageCount = 0;
      const { ref, rerender } = await mount({ initialState: withShip(2, 1), ship: "p1" });
      const drawn = () => (offscreen.drawImage as jest.Mock).mock.calls as unknown[][];
      const before = drawn().length;
      expect(before).toBe(SIX_GLOWS); // P1's, built on load
      await rerender(
        <GameCanvas
          ref={ref}
          width={W}
          height={H}
          scale={1}
          initialState={withShip(2, 1)}
          ship="p3"
        />
      );
      const added = drawn().slice(before);
      expect(added.length).toBe(SIX_GLOWS);
      const ids = added
        .map((c) => (c[0] as { id?: number }).id)
        .filter((i): i is number => typeof i === "number");
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every((i) => i >= 10 && i <= 14)).toBe(true);
    });

    it("builds all six glows when the images load, and no frame builds one", async () => {
      await mount({ initialState: withShip(2, 1) });
      const drawn = () => (offscreen.drawImage as jest.Mock).mock.calls.length;
      expect(drawn()).toBe(SIX_GLOWS);
      await frames(40);
      expect(drawn()).toBe(SIX_GLOWS);
    });
  });

  it("#3562: replays the shared Lightning beam ops while the beam is on, and none after", async () => {
    const beamOps = lightningBeamOps as jest.MockedFunction<typeof lightningBeamOps>;
    beamOps.mockClear();
    const state = seeded();
    await mount({
      initialState: {
        ...state,
        activePowerUp: { type: "lightning", remainingMs: 300, shieldAbsorbed: 0 },
      },
    });
    await frames(10);
    // drawn every frame, from the state the frame shows: five ops per beam (#3594) (L1: one beam)
    expect(beamOps).toHaveBeenCalled();
    const drawn = beamOps.mock.results.filter((r) => (r.value as unknown[]).length === 5);
    expect(drawn.length).toBeGreaterThan(0);
    const lines = calls.lineTo ?? 0;
    expect(lines).toBeGreaterThan(0); // the polys reached the 2D context
    // let Lightning run out, then nothing more is drawn
    for (let i = 0; i < 20; i++) await frames(10);
    beamOps.mockClear();
    await frames(5);
    expect(beamOps.mock.results.every((r) => (r.value as unknown[]).length === 0)).toBe(true);
  });

  it("#3593: replays the shared enemy ops with the loaded enemy sprites, and draws no HP pips", async () => {
    const built = enemyOps as jest.MockedFunction<typeof enemyOps>;
    const replay = drawEnemyOps as jest.MockedFunction<typeof drawEnemyOps>;
    built.mockClear();
    replay.mockClear();
    const state = seeded();
    // damage every Elite and Guardian, so the old pips (4 x 4 rects) would have drawn
    const hurt = {
      ...state,
      enemies: state.enemies.map((e) => (e.tier === "Grunt" ? e : { ...e, hp: 1 })),
    };
    await mount({ initialState: hurt });
    filledRects.length = 0;
    await frames(1);
    expect(built).toHaveBeenCalled();
    // #3595: the enemies' replay is the one handed enemyOps' list (the pickups replay after it)
    const last = built.mock.results[built.mock.results.length - 1]!.value;
    const call = replay.mock.calls.filter((c) => c[1] === last).pop()!;
    expect(call[1]).toBe(last);
    // the loader handed every enemy sprite over, under the keys the ops name
    const imgs = call[2] as Record<string, unknown>;
    expect(Object.keys(imgs).sort()).toEqual([...ENEMY_SPRITES].sort());
    expect(Object.values(imgs).every((i) => i !== null)).toBe(true);
    // the ops chose damage sprites, and they reached drawImage
    const sprites = call[1].flatMap((o) => (o.k === "image" ? [o.sprite] : []));
    expect(sprites).toEqual(expect.arrayContaining(["enemyEliteHurt", "enemyGuardianPlate2"]));
    expect(drawnImages).toEqual(expect.arrayContaining([imgs.enemyEliteHurt]));
    expect(filledRects.some(([, , w, h]) => w === 4 && h === 4)).toBe(false);
  });

  it("#3594: replays the shared shot ops (the ops native draws) with the loaded shot sprites", async () => {
    const replay = drawEnemyOps as jest.MockedFunction<typeof drawEnemyOps>;
    const state = seeded();
    const shot = { vx: 0, vy: 0.35, width: 5, height: 10, damage: 1 };
    const frozen: StarSwarmState = {
      ...state,
      enemyBullets: [
        { ...shot, id: 801, x: 60, y: 300, owner: "enemy" },
        { ...shot, id: 802, x: 80, y: 300, owner: "enemy", source: "carrier" },
        { ...shot, id: 803, x: 100, y: 300, owner: "enemy", flak: true, vx: 0.2 },
      ],
      playerBullets: [
        { ...shot, id: 804, x: 120, y: 400, owner: "player", height: 14, vy: -0.56, vx: 0.14 },
        { ...shot, id: 805, x: 140, y: 400, owner: "player", source: "buddy", vx: 0.5, vy: 0 },
      ],
    };
    await mount({ initialState: frozen, isPaused: true });
    replay.mockClear();
    imageRects.length = 0;
    await frames(1);
    // the first replay of the frame is the shots: the same ops native's buildFrame starts with
    const [, ops, imgs] = replay.mock.calls[0]!;
    const all = new Proxy({}, { get: () => true }) as LoadedSprites;
    const native = buildFrame(frozen, { loaded: all, width: W, height: H }).slice(0, 5);
    expect(ops).toEqual(native);
    expect(ops).toEqual(shotOps(frozen.enemyBullets, frozen.playerBullets, all));
    expect(ops.map((o) => (o.k === "image" ? o.sprite : o.k))).toEqual([
      "shotEnemy",
      "shotCarrier",
      "shotFlak",
      "shotPlayer",
      "shotBuddy",
    ]);
    // the loader handed every shot sprite over, under the keys the ops name
    expect(Object.keys(imgs as object).sort()).toEqual([...SHOT_SPRITES].sort());
    // and each shot reached drawImage once, at its op's size (turned ones about their centre)
    const first = imageRects.slice(0, 5);
    expect(first.map((r) => [r[2], r[3]])).toEqual(
      ops.map((o) => (o.k === "image" ? [o.w, o.h] : []))
    );
  });

  describe("#3595: pickups", () => {
    const types = ["shield", "lightning", "buddy", "bomb", "salvage", "hull"] as const;
    const withPickups = (): StarSwarmState => ({
      ...seeded(),
      powerUps: types.map((type, i) => ({
        id: 900 + i,
        type,
        x: 40 + 40 * i,
        y: 250,
        vy: 0.08,
        width: 24,
        height: 24,
        despawnTimer: 3000,
      })),
    });
    const pickupReplay = () =>
      (drawEnemyOps as jest.MockedFunction<typeof drawEnemyOps>).mock.calls.find(
        ([, , imgs]) =>
          Object.keys(imgs as object)
            .sort()
            .join() === [...PICKUP_SPRITES].sort().join()
      );

    it("replays the shared pickup ops (the ops native draws) with the loaded pickup sprites", async () => {
      const frozen = withPickups();
      await mount({ initialState: frozen, isPaused: true });
      (drawEnemyOps as jest.Mock).mockClear();
      imageRects.length = 0;
      await frames(1);
      const call = pickupReplay();
      expect(call).toBeDefined();
      const [, ops] = call!;
      const all = new Proxy({}, { get: () => true }) as LoadedSprites;
      const mine = pickupOps(frozen.powerUps, all);
      expect(ops).toEqual(mine);
      // the same ops, in one run, inside native's frame
      const native = JSON.stringify(buildFrame(frozen, { loaded: all, width: W, height: H }));
      expect(native).toContain(JSON.stringify(mine).slice(1, -1));
      expect(ops.flatMap((o) => (o.k === "image" ? [o.sprite] : []))).toEqual([
        "puShield",
        "puLightning",
        "puBuddy",
        "puBomb",
        "puSalvage",
        "puHull",
      ]);
      // each pickup reached drawImage once, at its op's rect (plus 2 px a side: the tokens' 30 px
      // draw box, the crate's and plate's 24 px box)
      const rects = ops.flatMap((o) => (o.k === "image" ? [[o.x, o.y, o.w, o.h]] : []));
      for (const r of rects) expect(imageRects).toContainEqual(r);
      expect(imageRects.filter(([, , w, h]) => w === 34 && h === 34)).toHaveLength(4);
      expect(imageRects.filter(([, , w, h]) => w === 28 && h === 28)).toHaveLength(2);
    });

    it("while the art has not loaded: the same fallback shapes as native", async () => {
      mockImagesLoad = false;
      const frozen = withPickups();
      await mount({ initialState: frozen, isPaused: true });
      (drawEnemyOps as jest.Mock).mockClear();
      paints.length = 0;
      await frames(1);
      const [, ops] = pickupReplay()!;
      const none = new Proxy({}, { get: () => false }) as LoadedSprites;
      expect(ops).toEqual(pickupOps(frozen.powerUps, none));
      expect(ops.some((o) => o.k === "image")).toBe(false);
      // the face-coloured hexagons and their silver rims reached the 2D context
      expect(paints).toContain(`fill ${cssColor(PICKUP_FACE.bomb)}`);
      expect(paints).toContain(`stroke ${cssColor(PICKUP_BEVEL)}`);
    });
  });

  it("#3597: replays the shared explosion and bomb flash ops over the rocks, in native's order", async () => {
    const replayed = effectOps as jest.MockedFunction<typeof effectOps>;
    const state = seeded();
    const rock: Asteroid = {
      id: 900,
      kind: "large",
      x: 80,
      y: 300,
      vx: 0,
      vy: 0,
      radius: 22,
      hp: 6,
      rotation: 0,
      spin: 0,
      hitFlashTimer: 0,
      hitEnemyIds: [],
    };
    const frozen: StarSwarmState = {
      ...state,
      asteroids: [rock],
      explosions: [{ id: 901, x: 120, y: 300, frame: 4, frameTimer: 10, kind: "burst" }],
      bombFlashTimer: 200,
    };
    await mount({ initialState: frozen, isPaused: true });
    replayed.mockClear();
    paints.length = 0;
    await frames(1);
    // the very ops native appends last in buildFrame, built from the frame's state and size
    expect(replayed).toHaveBeenCalledTimes(1);
    expect(replayed.mock.calls[0]![0]).toBe(frozen);
    expect(replayed.mock.calls[0]!.slice(1, 3)).toEqual([W, H]);
    const ops = replayed.mock.results[0]!.value as ReturnType<typeof effectOps>;
    const tint = ops.find((o) => o.k === "rect")!;
    const ring = ops.find((o) => o.k === "circle" && o.stroke !== undefined)!;
    expect(tint.color & 0xffffff).toBe(BOMB_TINT_RGB);
    // painted in the order native draws: the rock, then the explosion, then the flash on top
    // #3596: the rock is the shared ops' fallback outline here (no 2D context to bake its art)
    const rockAt = paints.indexOf(`stroke ${cssColor(opaque(ASTEROID_EDGE_RGB))}`);
    const ringAt = paints.indexOf(`stroke ${cssColor(ring.color)}`);
    const tintAt = paints.indexOf(`fillRect ${cssColor(tint.color)}`);
    expect(rockAt).toBeGreaterThanOrEqual(0);
    expect(ringAt).toBeGreaterThan(rockAt);
    expect(tintAt).toBeGreaterThan(ringAt);
  });

  it("#3597: paints the background and nebula once per size, then blits it every frame", async () => {
    const built = buildWebBackdrop as jest.MockedFunction<typeof buildWebBackdrop>;
    const backdrop = { tag: "backdrop" } as unknown as HTMLCanvasElement;
    built.mockReset();
    built.mockReturnValue(backdrop);
    try {
      await mount({ initialState: seeded() });
      await frames(30);
      expect(built).toHaveBeenCalledTimes(1);
      expect(built.mock.calls[0]!.slice(0, 3)).toEqual([W, H, 1]);
      // one blit of the baked canvas per frame, at the canvas size, under everything else
      const blits = drawnImages.filter((i) => i === backdrop);
      expect(blits.length).toBeGreaterThanOrEqual(30);
      expect(imageRects[drawnImages.indexOf(backdrop)]).toEqual([0, 0, W, H]);
    } finally {
      built.mockImplementation(
        jest.requireActual("../../../game/starswarm/render/nebula").buildWebBackdrop
      );
    }
  });

  it("#3597: repaints the backdrop once when the size or scale changes, never for the same size", async () => {
    const built = buildWebBackdrop as jest.MockedFunction<typeof buildWebBackdrop>;
    built.mockReset();
    built.mockReturnValue({ tag: "backdrop" } as unknown as HTMLCanvasElement);
    try {
      const { ref, rerender } = await mount({ initialState: seeded() });
      await frames(5);
      expect(built).toHaveBeenCalledTimes(1);
      const at = async (width: number, height: number, scale: number) => {
        await rerender(
          <GameCanvas
            ref={ref}
            width={width}
            height={height}
            scale={scale}
            initialState={seeded()}
          />
        );
        await frames(5);
      };
      await at(W, H, 1); // same size and scale: nothing new
      expect(built).toHaveBeenCalledTimes(1);
      await at(W, H, 2); // a new scale: one repaint
      expect(built).toHaveBeenCalledTimes(2);
      expect(built.mock.calls[1]!.slice(0, 3)).toEqual([W, H, 2]);
      await at(W + 40, H, 2); // a new size: one more
      expect(built).toHaveBeenCalledTimes(3);
      expect(built.mock.calls[2]!.slice(0, 3)).toEqual([W + 40, H, 2]);
      await at(W + 40, H, 2);
      expect(built).toHaveBeenCalledTimes(3);
    } finally {
      built.mockImplementation(
        jest.requireActual("../../../game/starswarm/render/nebula").buildWebBackdrop
      );
    }
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

  it("#3568: draws the crack-it cue when only a rock holds the wave, and the pickup cue wins over it", async () => {
    const rock = {
      id: 9100,
      kind: "large" as const,
      x: 60,
      y: 120,
      vx: 0,
      vy: 0,
      radius: 22,
      hp: 6,
      rotation: 0,
      spin: 0,
      hitFlashTimer: 0,
      hitEnemyIds: [],
    };
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
    mockTick.mockImplementation((st) => st);
    const first = await mount({
      initialState: seeded({ enemies: [], phase: "ClearAwaitingPickups", asteroids: [rock] }),
    });
    await frames(2);
    expect(fillTexts).toContain("CRACK IT FOR SALVAGE!");
    expect(fillTexts).not.toContain("QUICK, GRAB 'EM — THEY CARRY OVER!");
    await first.unmount();
    fillTexts.length = 0;
    await mount({
      initialState: seeded({
        enemies: [],
        phase: "ClearAwaitingPickups",
        asteroids: [rock],
        powerUps: [pickup],
      }),
    });
    await frames(2);
    expect(fillTexts).toContain("QUICK, GRAB 'EM — THEY CARRY OVER!");
    expect(fillTexts).not.toContain("CRACK IT FOR SALVAGE!");
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

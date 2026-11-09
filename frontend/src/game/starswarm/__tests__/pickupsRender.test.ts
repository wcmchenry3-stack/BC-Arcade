/**
 * #3595: the pickups as shared display-list ops (`render/pickups.ts`): one sprite op per pickup
 * (the upgrades over their code-drawn halo and ring), the sprite picked from the pickup's type,
 * and plain shapes in the sprite's colours while a sprite loads. The native replay is pinned in
 * drawFrame.test.ts and the web replay in GameCanvas.web.test.tsx; this file pins the ops both
 * replay.
 */
import { CANVAS_H, CANVAS_W, initStarSwarm } from "../engine";
import { POWERUP_TYPES } from "../engine/registries";
import { POWERUP_H, POWERUP_W } from "../engine/tuning";
import { buildFrame, type DrawOp, type LoadedSprites } from "../render/frame";
import { setDebugOpKeys } from "../render/opKeys";
import { PICKUP_BEVEL, SHOT_ENEMY_RGB } from "../render/palette";
import {
  PICKUP_FACE,
  PICKUP_PAD,
  PICKUP_SPRITE,
  PICKUP_SPRITES,
  pickupOps,
  type PickupSpriteKey,
} from "../render/pickups";
import type { PowerUp, PowerUpType, StarSwarmState } from "../types";

const ON = Object.fromEntries(PICKUP_SPRITES.map((k) => [k, true])) as Record<
  PickupSpriteKey,
  boolean
>;
const OFF = Object.fromEntries(PICKUP_SPRITES.map((k) => [k, false])) as Record<
  PickupSpriteKey,
  boolean
>;

function pu(id: number, type: PowerUpType, over: Partial<PowerUp> = {}): PowerUp {
  return {
    id,
    type,
    x: 100,
    y: 200,
    vy: 0.08,
    width: POWERUP_W,
    height: POWERUP_H,
    despawnTimer: 5000,
    ...over,
  };
}

const TIMED = ["shield", "lightning", "buddy", "bomb"] as const;

beforeAll(() => setDebugOpKeys(true));
afterAll(() => setDebugOpKeys(false));

describe("PICKUP_SPRITE (#3595)", () => {
  it("every pickup type has its own sprite, and the list is exactly those sprites", () => {
    const sprites = POWERUP_TYPES.map((t) => PICKUP_SPRITE[t]);
    expect(new Set(sprites).size).toBe(POWERUP_TYPES.length);
    expect([...sprites].sort()).toEqual([...PICKUP_SPRITES].sort());
  });

  it("the margin is the generator's PICKUP_PAD (6 px at 3x) and the box is the pickup's", () => {
    expect(PICKUP_PAD).toBe(2);
    expect([POWERUP_W, POWERUP_H]).toEqual([24, 24]); // the generator's PICKUP_BOX
  });
});

describe("pickupOps (#3595)", () => {
  it("a timed power-up is ONE image op: its sprite, the box plus its margin, centred", () => {
    for (const type of TIMED) {
      const ops = pickupOps([pu(1, type)], ON);
      expect(ops).toEqual([
        {
          k: "image",
          key: "pu-1",
          sprite: PICKUP_SPRITE[type],
          x: 100 - 12 - PICKUP_PAD,
          y: 200 - 12 - PICKUP_PAD,
          w: 24 + 2 * PICKUP_PAD,
          h: 24 + 2 * PICKUP_PAD,
          fit: "fill",
        },
      ]);
    }
  });

  it("an upgrade is its halo and ring (as before) plus ONE image op of its sprite", () => {
    for (const type of ["salvage", "hull"] as const) {
      const ops = pickupOps([pu(2, type)], ON);
      expect(ops.map((o) => o.key)).toEqual(["pu-2-halo", "pu-2-halo-ring", "pu-2"]);
      expect(ops.map((o) => o.k)).toEqual(["circle", "circle", "image"]);
      expect(ops[2]).toMatchObject({ sprite: PICKUP_SPRITE[type], w: 28, h: 28, fit: "fill" });
    }
  });

  it("the sprite follows the pickup; the hitbox (width, height) is the engine's, untouched", () => {
    const p = pu(3, "bomb", { x: 37, y: 512 });
    const [op] = pickupOps([p], ON) as Extract<DrawOp, { k: "image" }>[];
    expect(op!.x + op!.w / 2).toBe(37);
    expect(op!.y + op!.h / 2).toBe(512);
    expect(p.width).toBe(POWERUP_W);
    expect(p.height).toBe(POWERUP_H);
  });

  it("while a power-up's sprite loads: a face-coloured hexagon with a silver rim", () => {
    for (const type of TIMED) {
      const ops = pickupOps([pu(4, type)], OFF);
      expect(ops).toHaveLength(2);
      const [face, rim] = ops as Extract<DrawOp, { k: "poly" }>[];
      expect(face).toMatchObject({ k: "poly", key: "pu-4", color: PICKUP_FACE[type] });
      expect(face!.stroke).toBeUndefined();
      expect(rim).toMatchObject({ k: "poly", key: "pu-4-rim", color: PICKUP_BEVEL, stroke: 1.5 });
      expect(rim!.points).toBe(face!.points); // one point list for both
      expect(face!.points).toHaveLength(12);
      // points left and right: as wide as the token, not as tall
      const xs = face!.points.filter((_, i) => i % 2 === 0);
      const ys = face!.points.filter((_, i) => i % 2 === 1);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...ys) - Math.min(...ys));
    }
  });

  it("the Bomb's fallback is not the enemy orb's red-orange circle", () => {
    const [face] = pickupOps([pu(5, "bomb")], OFF);
    expect(face!.k).toBe("poly");
    expect((face as { color: number }).color & 0xffffff).not.toBe(SHOT_ENEMY_RGB);
  });

  it("while an upgrade's sprite loads: the halo over the code-drawn crate / plate", () => {
    const crate = pickupOps([pu(6, "salvage")], OFF).map((o) => o.key);
    expect(crate).toEqual([
      "pu-6-halo",
      "pu-6-halo-ring",
      "pu-6",
      "pu-6-band",
      "pu-6-edge",
      "pu-6-glyph",
    ]);
    const plate = pickupOps([pu(7, "hull")], OFF).map((o) => o.key);
    expect(plate).toEqual([
      "pu-7-halo",
      "pu-7-halo-ring",
      "pu-7",
      "pu-7-edge",
      "pu-7-glyph-h",
      "pu-7-glyph-v",
    ]);
  });

  it("each sprite falls back on its own: a loaded one still draws", () => {
    const ops = pickupOps([pu(1, "shield"), pu(2, "bomb")], { ...OFF, puBomb: true });
    expect(ops.map((o) => o.k)).toEqual(["poly", "poly", "image"]);
  });

  it("appends to the list it is given and builds no keys with debug keys off", () => {
    const list: DrawOp[] = [];
    expect(pickupOps([pu(1, "hull")], ON, list)).toBe(list);
    setDebugOpKeys(false);
    try {
      const all = POWERUP_TYPES.map((t, i) => pu(i, t));
      expect(pickupOps(all, ON).every((o) => o.key === undefined)).toBe(true);
      expect(pickupOps(all, OFF).every((o) => o.key === undefined)).toBe(true);
    } finally {
      setDebugOpKeys(true);
    }
  });

  it("buildFrame draws exactly these ops, in the pickups' place", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42);
    const powerUps = POWERUP_TYPES.map((t, i) => pu(i + 1, t, { x: 40 + 30 * i }));
    const state: StarSwarmState = {
      ...s,
      enemies: [],
      enemyBullets: [],
      playerBullets: [],
      buddyShips: [],
      asteroids: [],
      explosions: [],
      phase: "GameOver", // no ship or its effects either: the list is the pickups alone
      powerUps,
    };
    const all = new Proxy({}, { get: () => true }) as LoadedSprites;
    const ops = buildFrame(state, { loaded: all, width: CANVAS_W, height: CANVAS_H });
    expect(ops).toEqual(pickupOps(powerUps, ON));
    // four power-ups at one op each, two upgrades at three
    expect(ops).toHaveLength(4 + 2 * 3);
    expect(ops.filter((o) => o.k === "image")).toHaveLength(6);
  });
});

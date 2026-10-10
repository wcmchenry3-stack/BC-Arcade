/**
 * #2847: upgrade-pickup visuals (salvage crate, hull plating) and the collection cue lifecycle.
 */
import { initStarSwarm, CANVAS_W, CANVAS_H } from "../engine";
import { buildFrame, type DrawOp, type LoadedSprites } from "../render/frame";
import {
  upgradePickupOps,
  pickupPulse,
  PICKUP_ACCENT,
  PICKUP_PULSE_MS,
  isUpgradePickup,
  drawPickupOps,
} from "../render/pickups";
import { setDebugOpKeys } from "../render/opKeys";
import {
  pickupCues,
  pickupCueFrame,
  pickupCueLabelKey,
  pickupCueColor,
  PICKUP_CUE_MS,
} from "../render/pickupCue";
import type { PowerUp, PowerUpType, StarSwarmState } from "../types";

const NONE: LoadedSprites = {
  playerShip: false,
  buddyShip: false,
  enemyGrunt: false,
  enemyElite: false,
  enemyGuardian: false,
  enemyCarrier: false,
  bulletPlayer: false,
  puShield: true,
  puBomb: true,
  puBuddy: true,
  puLightning: true,
  asteroid1: false,
  asteroid2: false,
  asteroid3: false,
  asteroid4: false,
  explosion: [],
};

function pu(id: number, type: PowerUpType, over: Partial<PowerUp> = {}): PowerUp {
  return { id, type, x: 100, y: 200, vy: 0.08, width: 24, height: 24, despawnTimer: 5000, ...over };
}

function blank(over: Partial<StarSwarmState> = {}): StarSwarmState {
  const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42);
  return { ...s, phase: "Playing", enemies: [], powerUps: [], asteroids: [], ...over };
}

function withPlayer(s: StarSwarmState, over: Partial<StarSwarmState["player"]>): StarSwarmState {
  return { ...s, player: { ...s.player, ...over } };
}

// #2963: op keys are debug-only — these tests find ops by key, so they turn them on
beforeAll(() => setDebugOpKeys(true));
afterAll(() => setDebugOpKeys(false));

const byKey = (ops: DrawOp[], key: string) => ops.find((o) => o.key === key);

describe("upgrade pickup visuals", () => {
  it("only salvage and hull are upgrade pickups", () => {
    expect(isUpgradePickup("salvage")).toBe(true);
    expect(isUpgradePickup("hull")).toBe(true);
    for (const t of ["shield", "bomb", "buddy", "lightning"] as const) {
      expect(isUpgradePickup(t)).toBe(false);
    }
  });

  it("salvage: pulsing amber halo behind a crate with an up-chevron", () => {
    const ops = upgradePickupOps(pu(1, "salvage") as PowerUp & { type: "salvage" });
    const keys = ops.map((o) => o.key);
    expect(keys.indexOf("pu-1-halo")).toBeLessThan(keys.indexOf("pu-1"));
    expect(byKey(ops, "pu-1-halo-ring")).toMatchObject({ k: "circle", stroke: 1.5 });
    expect(byKey(ops, "pu-1")).toMatchObject({ k: "rect", color: PICKUP_ACCENT.salvage.color });
    expect(byKey(ops, "pu-1-glyph")).toMatchObject({ k: "poly", color: 0xffffffff });
  });

  it("hull: cyan hexagon with a plus glyph, distinct from the crate", () => {
    const ops = upgradePickupOps(pu(2, "hull") as PowerUp & { type: "hull" });
    const hex = byKey(ops, "pu-2");
    expect(hex).toMatchObject({ k: "poly", color: PICKUP_ACCENT.hull.color });
    expect(hex && hex.k === "poly" && hex.points.length).toBe(12);
    expect(byKey(ops, "pu-2-glyph-h")).toBeDefined();
    expect(byKey(ops, "pu-2-glyph-v")).toBeDefined();
    expect(PICKUP_ACCENT.hull.hex).not.toBe(PICKUP_ACCENT.salvage.hex);
  });

  it("the halo pulses over PICKUP_PULSE_MS and stays within 0–1", () => {
    const seen = new Set<number>();
    for (let t = 0; t < PICKUP_PULSE_MS; t += 50) {
      const p = pickupPulse(t);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      seen.add(Math.round(p * 100));
    }
    expect(seen.size).toBeGreaterThan(5);
    expect(pickupPulse(123)).toBeCloseTo(pickupPulse(123 + PICKUP_PULSE_MS));
  });

  it("buildFrame draws them with the shared geometry (timed power-ups keep sprites)", () => {
    const s = blank({ powerUps: [pu(3, "salvage"), pu(4, "hull"), pu(5, "shield")] });
    const ops = buildFrame(s, {
      loaded: NONE,
      width: CANVAS_W,
      height: CANVAS_H,
    });
    expect(byKey(ops, "pu-3-halo")).toBeDefined();
    expect(byKey(ops, "pu-4-halo")).toBeDefined();
    // timed power-ups keep their sprite and get no halo
    expect(byKey(ops, "pu-5")).toMatchObject({ k: "image", sprite: "puShield" });
    expect(byKey(ops, "pu-5-halo")).toBeUndefined();
  });

  it("web replay draws every op kind onto a 2D context", () => {
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, prop: string) => (): void => {
          calls.push(prop);
        },
        set: () => true,
      }
    ) as unknown as CanvasRenderingContext2D;
    drawPickupOps(ctx, upgradePickupOps(pu(6, "hull") as PowerUp & { type: "hull" }));
    drawPickupOps(ctx, upgradePickupOps(pu(7, "salvage") as PowerUp & { type: "salvage" }));
    expect(calls).toEqual(expect.arrayContaining(["arc", "fillRect", "lineTo", "stroke", "fill"]));
  });

  it("web replay turns packed colours into CSS for the 2D context (#2963)", () => {
    const styles: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: () => (): void => {},
        set: (_t, prop: string, v: unknown) => {
          if (prop === "fillStyle" || prop === "strokeStyle") styles.push(String(v));
          return true;
        },
      }
    ) as unknown as CanvasRenderingContext2D;
    drawPickupOps(ctx, upgradePickupOps(pu(8, "salvage") as PowerUp & { type: "salvage" }));
    expect(styles).toContain("rgba(255,176,32,1)"); // the crate, PICKUP_ACCENT.salvage
    expect(styles).toContain("rgba(255,255,255,1)"); // the glyph
    expect(styles.every((c) => /^rgba\(\d+,\d+,\d+,[\d.]+\)$/.test(c))).toBe(true);
  });
});

describe("pickup cue lifecycle", () => {
  it("guns rising fires GUNS +1 with the new level", () => {
    const a = blank();
    const b = withPlayer(a, { guns: 2 });
    const cues = pickupCues(a, b);
    expect(cues).toEqual([{ kind: "guns", max: false, level: 2 }]);
    expect(pickupCueLabelKey(cues[0]!)).toBe("hud.cueGuns");
  });

  it("hull rising fires HULL +1", () => {
    const a = blank();
    const cues = pickupCues(a, withPlayer(a, { hull: 1 }));
    expect(cues).toEqual([{ kind: "hull", max: false, level: 1 }]);
    expect(pickupCueLabelKey(cues[0]!)).toBe("hud.cueHull");
  });

  it("collecting at the top of a ladder fires the MAX variant", () => {
    const a = blank();
    const full = withPlayer(a, { guns: 3, hull: 2 });
    const px = full.player.x;
    const py = full.player.y;
    const prev = {
      ...full,
      powerUps: [pu(1, "salvage", { x: px, y: py }), pu(2, "hull", { x: px, y: py })],
    };
    const next = { ...full, powerUps: [] };
    const cues = pickupCues(prev, next);
    expect(cues.map(pickupCueLabelKey)).toEqual(["hud.cueGunsMax", "hud.cueHullMax"]);
  });

  it("a pickup that merely despawned far from the ship, or a timed power-up, fires nothing", () => {
    const a = blank();
    const full = withPlayer(a, { guns: 3, hull: 2 });
    const far = { ...full, powerUps: [pu(1, "salvage", { x: 10, y: 20 })] };
    expect(pickupCues(far, { ...full, powerUps: [] })).toEqual([]);
    const timed = { ...full, powerUps: [pu(2, "shield", { x: full.player.x, y: full.player.y })] };
    expect(pickupCues(timed, { ...full, powerUps: [] })).toEqual([]);
  });

  it("a losing tick (guns down, hull hit) fires no cue", () => {
    const a = withPlayer(blank(), { guns: 3, hull: 2 });
    expect(pickupCues(a, withPlayer(a, { guns: 2, hull: 1 }))).toEqual([]);
  });

  it("cue colours match the pickup accents", () => {
    expect(pickupCueColor("guns")).toBe(PICKUP_ACCENT.salvage.hex);
    expect(pickupCueColor("hull")).toBe(PICKUP_ACCENT.hull.hex);
  });

  it("animation: pops in, holds, fades out, then expires", () => {
    const start = pickupCueFrame(0)!;
    expect(start.opacity).toBe(0);
    expect(start.scale).toBeGreaterThan(1);
    const mid = pickupCueFrame(PICKUP_CUE_MS * 0.4)!;
    expect(mid.opacity).toBe(1);
    expect(mid.offsetY).toBeLessThan(0);
    const late = pickupCueFrame(PICKUP_CUE_MS * 0.95)!;
    expect(late.opacity).toBeGreaterThan(0);
    expect(late.opacity).toBeLessThan(0.3);
    expect(pickupCueFrame(PICKUP_CUE_MS)).toBeNull();
    expect(pickupCueFrame(-1)).toBeNull();
  });
});

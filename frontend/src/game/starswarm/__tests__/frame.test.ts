/**
 * #2564: the native canvas's drawing rules, tested without a Skia canvas. `buildFrame` returns a
 * flat display list; these tests pin what is drawn, with what, and in which order.
 */
import {
  initStarSwarm,
  CANVAS_W,
  CANVAS_H,
  HIT_FLASH_DURATION,
  BEAM_CHARGE_MS,
  BEAM_FIRE_MS,
  BEAM_HALF_WIDTH,
  BULLET_C_W,
} from "../engine";
import { HARMLESS_BULLET_OPACITY } from "../constants";
import { initStarfield } from "../starfield";
import {
  buildFrame,
  playerVisible,
  hitFlash,
  polyPath,
  mirrorAxisX,
  EXPLOSION_DRAW_SIZE,
  INVINCIBLE_BLINK_INTERVAL,
  BUDDY_SIZE,
  type DrawOp,
  type LoadedSprites,
} from "../render/frame";
import type { Bullet, Enemy, PowerUpType, StarSwarmState } from "../types";

const ALL: LoadedSprites = {
  playerShip: true,
  buddyShip: true,
  enemyGrunt: true,
  enemyElite: true,
  enemyBoss: true,
  enemyCarrier: true,
  bulletPlayer: true,
  puShield: true,
  puBomb: true,
  puBuddy: true,
  puLightning: true,
  explosion: Array.from({ length: 20 }, () => true),
};
const NONE: LoadedSprites = {
  playerShip: false,
  buddyShip: false,
  enemyGrunt: false,
  enemyElite: false,
  enemyBoss: false,
  enemyCarrier: false,
  bulletPlayer: false,
  puShield: false,
  puBomb: false,
  puBuddy: false,
  puLightning: false,
  explosion: Array.from({ length: 20 }, () => false),
};
/** An empty starfield keeps these lists short and readable. */
const NO_STARS = { ...initStarfield(CANVAS_W, CANVAS_H), stars: [] };
const OPTS = { loaded: ALL, width: CANVAS_W, height: CANVAS_H };

/** A settled-looking state with nothing on screen but what each test adds. */
function blank(over: Partial<StarSwarmState> = {}): StarSwarmState {
  const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42);
  return {
    ...s,
    phase: "Playing",
    enemies: [],
    enemyBullets: [],
    playerBullets: [],
    powerUps: [],
    buddyShips: [],
    asteroids: [],
    explosions: [],
    bombFlashTimer: 0,
    activePowerUp: null,
    ...over,
  };
}
function enemyOf(tier: Enemy["tier"], over: Partial<Enemy> = {}): Enemy {
  const e = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42).enemies.find((x) => x.tier === tier)!;
  return { ...e, x: 200, y: 150, isAlive: true, hitFlashTimer: 0, ...over };
}
function bullet(over: Partial<Bullet> = {}): Bullet {
  return {
    id: 1,
    x: 100,
    y: 300,
    vx: 0,
    vy: 0,
    owner: "enemy",
    width: 5,
    height: 10,
    damage: 1,
    ...over,
  };
}
const byKey = (ops: DrawOp[], key: string) => ops.find((o) => o.key === key);
const keys = (ops: DrawOp[]) => ops.map((o) => o.key);

describe("buildFrame — scene order and background", () => {
  it("starts with the background fill, then stars, and draws every layer back to front", () => {
    const sf = initStarfield(CANVAS_W, CANVAS_H);
    const path = { p0: { x: 0, y: 0 }, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, p3: { x: 0, y: 0 } };
    const s = blank({
      enemyBullets: [bullet({ id: 1 })],
      playerBullets: [bullet({ id: 2, owner: "player" })],
      // escorted Carrier mid-flash and firing its beam
      enemies: [
        enemyOf("Carrier", { id: 3, hitFlashTimer: 100, beamPhase: "fire", beamTimer: 500 }),
        enemyOf("Boss", { id: 11 }),
      ],
      activePowerUp: { type: "shield", remainingMs: 5000, shieldAbsorbed: 0 },
      player: { ...blank().player, hullFlashTimer: 100 },
      buddyShips: [
        {
          id: 5,
          x: 50,
          y: 50,
          path,
          pathT: 0,
          pathDuration: 1,
          hasFired: false,
          targetX: 0,
          targetY: 0,
          fromLeft: true,
        },
      ],
      powerUps: [
        { id: 6, type: "bomb", x: 50, y: 50, vy: 0, width: 24, height: 24, despawnTimer: 1 },
      ],
      asteroids: [
        {
          id: 7,
          kind: "large",
          x: 80,
          y: 80,
          vx: 0,
          vy: 0,
          radius: 22,
          hp: 6,
          rotation: 0,
          spin: 0,
          hitFlashTimer: 0,
          hitEnemyIds: [],
        },
      ],
      explosions: [{ id: 4, x: 10, y: 10, frame: 0, frameTimer: 0 }],
      bombFlashTimer: 100,
    });
    const ops = buildFrame(s, sf, OPTS);
    expect(ops[0]).toEqual({ k: "fill", key: "bg", color: "#000010" });
    expect(ops.slice(1, 1 + sf.stars.length).every((o) => o.key.startsWith("star-"))).toBe(true);
    expect(keys(ops).filter((k) => !k.startsWith("star-") && k !== "bg")).toEqual([
      "eb-1",
      "pb-2",
      "en-3",
      "en-3-ring",
      "en-3-flash",
      "en-3-flash-ring",
      "en-11",
      "beam-glow",
      "beam-core",
      "player",
      "shield",
      "shield-ring",
      "hull-flash",
      "buddy-5",
      "pu-6",
      "rock-7",
      "rock-7-edge",
      "ex-4",
      "bomb-flash",
    ]);
    // the lightning tint sits between the hull flash and the buddies
    const lit = buildFrame(
      { ...s, activePowerUp: { type: "lightning", remainingMs: 5000, shieldAbsorbed: 0 } },
      sf,
      OPTS
    );
    const k = keys(lit);
    expect(k.indexOf("hull-flash")).toBeLessThan(k.indexOf("lightning"));
    expect(k.indexOf("lightning")).toBeLessThan(k.indexOf("buddy-5"));
  });

  it("every key is unique within a frame", () => {
    const s = blank({
      enemies: [enemyOf("Carrier", { id: 7, hitFlashTimer: 100 }), enemyOf("Boss", { id: 8 })],
      powerUps: [
        { id: 9, type: "salvage", x: 50, y: 50, vy: 0, width: 24, height: 24, despawnTimer: 1 },
      ],
      asteroids: [
        {
          id: 10,
          kind: "large",
          x: 80,
          y: 80,
          vx: 0,
          vy: 0,
          radius: 22,
          hp: 6,
          rotation: 0,
          spin: 0,
          hitFlashTimer: 0,
          hitEnemyIds: [],
        },
      ],
    });
    const k = keys(buildFrame(s, initStarfield(CANVAS_W, CANVAS_H), OPTS));
    expect(new Set(k).size).toBe(k.length);
  });
});

describe("buildFrame — bullets", () => {
  it("harmless enemy bullets are dimmed, live ones are opaque, flak is amber", () => {
    const s = blank({
      enemyBullets: [
        bullet({ id: 1 }),
        bullet({ id: 2, harmless: true }),
        bullet({ id: 3, flak: true }),
      ],
    });
    const ops = buildFrame(s, NO_STARS, OPTS);
    expect(byKey(ops, "eb-1")).toMatchObject({ k: "rect", color: "#ff4422", opacity: 1 });
    expect(byKey(ops, "eb-2")).toMatchObject({ opacity: HARMLESS_BULLET_OPACITY });
    expect(byKey(ops, "eb-3")).toMatchObject({ color: "#ffd27a" });
    // centred on the bullet
    expect(byKey(ops, "eb-1")).toMatchObject({ x: 100 - 2.5, y: 300 - 5, w: 5, h: 10 });
  });

  it("player bullets: charge shots are a cyan rect, others the sprite or its fallback", () => {
    const s = blank({
      playerBullets: [
        bullet({ id: 1, owner: "player" }),
        bullet({ id: 2, owner: "player", width: BULLET_C_W }),
      ],
    });
    const loaded = buildFrame(s, NO_STARS, OPTS);
    expect(byKey(loaded, "pb-1")).toMatchObject({
      k: "image",
      sprite: "bulletPlayer",
      fit: "fill",
    });
    expect(byKey(loaded, "pb-2")).toMatchObject({ k: "rect", color: "#00f0ff" });
    const bare = buildFrame(s, NO_STARS, { ...OPTS, loaded: NONE });
    expect(byKey(bare, "pb-1")).toMatchObject({ k: "rect", color: "#00ffcc" });
  });
});

describe("buildFrame — enemies", () => {
  it("dead enemies are omitted; every live phase draws, fleeing and diving included", () => {
    const phases: Enemy["phase"][] = [
      "SwoopIn",
      "Formation",
      "Wiggling",
      "Diving",
      "Circling",
      "Returning",
      "Fleeing",
    ];
    const enemies = phases.map((phase, i) => enemyOf("Grunt", { id: 100 + i, phase }));
    const s = blank({ enemies: [...enemies, enemyOf("Grunt", { id: 99, isAlive: false })] });
    const ops = buildFrame(s, NO_STARS, OPTS);
    for (const e of enemies) expect(byKey(ops, `en-${e.id}`)).toBeDefined();
    expect(byKey(ops, "en-99")).toBeUndefined();
  });

  it("each tier uses its sprite, or its fallback colour when the sprite hasn't loaded", () => {
    const s = blank({
      enemies: [
        enemyOf("Grunt", { id: 1 }),
        enemyOf("Elite", { id: 2 }),
        enemyOf("Boss", { id: 3 }),
        enemyOf("Carrier", { id: 4 }),
      ],
    });
    const ops = buildFrame(s, NO_STARS, OPTS);
    expect(byKey(ops, "en-1")).toMatchObject({ k: "image", sprite: "enemyGrunt" });
    expect(byKey(ops, "en-2")).toMatchObject({ k: "image", sprite: "enemyElite" });
    expect(byKey(ops, "en-3")).toMatchObject({ k: "image", sprite: "enemyBoss" });
    expect(byKey(ops, "en-4")).toMatchObject({ k: "image", sprite: "enemyCarrier" });
    const bare = buildFrame(s, NO_STARS, { ...OPTS, loaded: NONE });
    expect(byKey(bare, "en-1")).toMatchObject({ k: "rect", color: "#8888ff" });
    expect(byKey(bare, "en-2")).toMatchObject({ k: "rect", color: "#ff88ff" });
    expect(byKey(bare, "en-3")).toMatchObject({ k: "rect", color: "#ffff44" });
    expect(byKey(bare, "en-4")).toMatchObject({ k: "rect", color: "#b06cff" });
  });

  it("the Carrier wears its force-field ring only while a Boss escort lives", () => {
    const carrier = enemyOf("Carrier", { id: 1 });
    const escorted = blank({ enemies: [carrier, enemyOf("Boss", { id: 2 })] });
    const ring = byKey(buildFrame(escorted, NO_STARS, OPTS), "en-1-ring");
    expect(ring).toMatchObject({
      k: "circle",
      cx: carrier.x,
      cy: carrier.y,
      r: Math.max(carrier.width, carrier.height) * 0.62,
      color: "rgba(0,170,255,0.45)",
      stroke: 2,
    });
    const exposed = blank({ enemies: [carrier] });
    expect(byKey(buildFrame(exposed, NO_STARS, OPTS), "en-1-ring")).toBeUndefined();
    // a Boss never wears one
    expect(byKey(buildFrame(escorted, NO_STARS, OPTS), "en-2-ring")).toBeUndefined();
  });

  it("the hit flash grows and fades over HIT_FLASH_DURATION: fill then ring", () => {
    const start = hitFlash(40, 30, HIT_FLASH_DURATION);
    expect(start.r).toBeCloseTo(40 * 1.2 * 0.6);
    expect(start.fillAlpha).toBeCloseTo(0.25);
    expect(start.strokeAlpha).toBeCloseTo(0.75);
    const mid = hitFlash(40, 30, HIT_FLASH_DURATION / 2);
    expect(mid.r).toBeCloseTo(40 * 1.2 * 0.85);
    expect(mid.strokeAlpha).toBeCloseTo(0.375);
    const end = hitFlash(40, 30, 0);
    expect(end.r).toBeCloseTo(40 * 1.2 * 1.1);
    expect(end.fillAlpha).toBe(0);

    const e = enemyOf("Elite", { id: 5, hitFlashTimer: HIT_FLASH_DURATION / 2 });
    const ops = buildFrame(blank({ enemies: [e] }), NO_STARS, OPTS);
    const f = hitFlash(e.width, e.height, e.hitFlashTimer);
    expect(byKey(ops, "en-5-flash")).toMatchObject({
      k: "circle",
      r: f.r,
      color: `rgba(0,170,255,${f.fillAlpha.toFixed(3)})`,
    });
    expect(byKey(ops, "en-5-flash")).not.toHaveProperty("stroke");
    expect(byKey(ops, "en-5-flash-ring")).toMatchObject({
      color: `rgba(0,170,255,${f.strokeAlpha.toFixed(3)})`,
      stroke: 3,
    });
    expect(keys(ops).indexOf("en-5-flash")).toBeLessThan(keys(ops).indexOf("en-5-flash-ring"));
    // no timer, no flash
    const calm = buildFrame(blank({ enemies: [{ ...e, hitFlashTimer: 0 }] }), NO_STARS, OPTS);
    expect(byKey(calm, "en-5-flash")).toBeUndefined();
  });
});

describe("buildFrame — Carrier beam", () => {
  const withBeam = (beamPhase: "idle" | "charge" | "fire", beamTimer: number) =>
    blank({ enemies: [enemyOf("Carrier", { id: 1, beamPhase, beamTimer })] });

  it("no beam while idle", () => {
    const ops = buildFrame(withBeam("idle", 5000), NO_STARS, OPTS);
    expect(ops.some((o) => o.key.startsWith("beam-"))).toBe(false);
  });

  it("charge: a thin telegraph line and a growing orb, brightening with progress", () => {
    const s = withBeam("charge", BEAM_CHARGE_MS / 2); // progress 0.5
    const c = s.enemies[0]!;
    const ops = buildFrame(s, NO_STARS, OPTS);
    expect(byKey(ops, "beam-telegraph")).toEqual({
      k: "rect",
      key: "beam-telegraph",
      x: c.x - 2,
      y: c.y + c.height / 2,
      w: 4,
      h: s.canvasH,
      color: "rgba(176,108,255,0.275)",
    });
    expect(byKey(ops, "beam-charge")).toMatchObject({
      cx: c.x,
      cy: c.y + c.height / 2 + 6,
      r: 8,
      color: "rgba(176,108,255,0.650)",
    });
    expect(byKey(ops, "beam-glow")).toBeUndefined();
  });

  it("fire: a wide glow and a bright core the full canvas height", () => {
    const s = withBeam("fire", BEAM_FIRE_MS);
    const c = s.enemies[0]!;
    const ops = buildFrame(s, NO_STARS, OPTS);
    expect(byKey(ops, "beam-glow")).toMatchObject({
      x: c.x - BEAM_HALF_WIDTH - 4,
      w: BEAM_HALF_WIDTH * 2 + 8,
      h: s.canvasH,
      color: "rgba(176,108,255,0.35)",
    });
    expect(byKey(ops, "beam-core")).toMatchObject({
      x: c.x - BEAM_HALF_WIDTH * 0.5,
      w: BEAM_HALF_WIDTH,
      color: "rgba(230,205,255,0.9)",
    });
    expect(byKey(ops, "beam-telegraph")).toBeUndefined();
  });
});

describe("buildFrame — player", () => {
  it("blinks on INVINCIBLE_BLINK_INTERVAL while invincible", () => {
    const at = (invincibleTimer: number) =>
      blank({ player: { ...blank().player, invincibleTimer } });
    expect(playerVisible(at(0))).toBe(true);
    expect(playerVisible(at(INVINCIBLE_BLINK_INTERVAL - 1))).toBe(true); // floor 0 → shown
    expect(playerVisible(at(INVINCIBLE_BLINK_INTERVAL))).toBe(false); // floor 1 → hidden
    expect(playerVisible(at(INVINCIBLE_BLINK_INTERVAL * 2))).toBe(true); // floor 2 → shown
  });

  it("is hidden above the top edge and at game over — overlays included (#2334)", () => {
    const shielded = blank({
      activePowerUp: { type: "shield", remainingMs: 5000, shieldAbsorbed: 0 },
      player: { ...blank().player, hullFlashTimer: 100 },
    });
    const live = buildFrame(shielded, NO_STARS, OPTS);
    expect(keys(live)).toEqual(
      expect.arrayContaining(["player", "shield", "shield-ring", "hull-flash"])
    );
    const over = buildFrame({ ...shielded, phase: "GameOver" }, NO_STARS, OPTS);
    for (const k of ["player", "shield", "shield-ring", "hull-flash"]) {
      expect(byKey(over, k)).toBeUndefined();
    }
    const lit = {
      ...shielded,
      activePowerUp: { type: "lightning" as const, remainingMs: 1, shieldAbsorbed: 0 },
    };
    expect(byKey(buildFrame(lit, NO_STARS, OPTS), "lightning")).toBeDefined();
    expect(
      byKey(buildFrame({ ...lit, phase: "GameOver" }, NO_STARS, OPTS), "lightning")
    ).toBeUndefined();
    const offTop = { ...shielded, player: { ...shielded.player, y: -shielded.player.height - 1 } };
    expect(byKey(buildFrame(offTop, NO_STARS, OPTS), "player")).toBeUndefined();
  });

  it("sprite or fallback; shield aura fill then ring; hull flash ring; lightning tint", () => {
    const p = blank().player;
    const s = blank({
      activePowerUp: { type: "lightning", remainingMs: 5000, shieldAbsorbed: 0 },
      player: { ...p, hullFlashTimer: HIT_FLASH_DURATION / 2 },
    });
    const ops = buildFrame(s, NO_STARS, OPTS);
    expect(byKey(ops, "player")).toMatchObject({
      k: "image",
      sprite: "playerShip",
      x: p.x - p.width / 2,
      y: p.y - p.height / 2,
      fit: "fill",
    });
    expect(byKey(ops, "lightning")).toMatchObject({ k: "rect", color: "rgba(255,238,0,0.45)" });
    expect(byKey(ops, "hull-flash")).toMatchObject({
      r: p.width * 0.8,
      color: "rgba(0,170,255,0.375)",
      stroke: 3,
    });
    expect(byKey(ops, "shield")).toBeUndefined();
    const shield = buildFrame(
      blank({ activePowerUp: { type: "shield", remainingMs: 1, shieldAbsorbed: 0 } }),
      NO_STARS,
      OPTS
    );
    expect(byKey(shield, "shield")).toMatchObject({
      r: p.width * 0.8,
      color: "rgba(0,170,255,0.25)",
    });
    expect(byKey(shield, "shield")).not.toHaveProperty("stroke");
    expect(byKey(shield, "shield-ring")).toMatchObject({ stroke: 2 });
    expect(byKey(buildFrame(blank(), NO_STARS, { ...OPTS, loaded: NONE }), "player")).toMatchObject(
      {
        k: "rect",
        color: "#00ffcc",
      }
    );
  });
});

describe("renderer helpers", () => {
  it("polyPath closes the polygon: M first, L each other vertex, Z", () => {
    expect(polyPath([1, 2, 3, 4, 5.5, 6])).toBe("M1,2 L3,4 L5.5,6 Z");
    expect(polyPath([0, 0])).toBe("M0,0 Z");
  });

  it("a flipped image mirrors about its own centre — the buddy's x", () => {
    expect(mirrorAxisX({ x: 300 - BUDDY_SIZE / 2, w: BUDDY_SIZE })).toBe(300);
  });
});

describe("buildFrame — buddies, power-ups, rocks, explosions, bomb flash", () => {
  it("buddy ships face their direction of travel", () => {
    const base = {
      path: { p0: { x: 0, y: 0 }, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, p3: { x: 0, y: 0 } },
      pathT: 0,
      pathDuration: 1,
      hasFired: false,
      targetX: 0,
      targetY: 0,
    };
    const s = blank({
      buddyShips: [
        { ...base, id: 1, x: 100, y: 200, fromLeft: true },
        { ...base, id: 2, x: 300, y: 200, fromLeft: false },
      ],
    });
    const ops = buildFrame(s, NO_STARS, OPTS);
    expect(byKey(ops, "buddy-1")).toMatchObject({
      k: "image",
      sprite: "buddyShip",
      x: 100 - BUDDY_SIZE / 2,
      w: BUDDY_SIZE,
      flipX: false,
    });
    expect(byKey(ops, "buddy-2")).toMatchObject({ flipX: true });
    expect(byKey(buildFrame(s, NO_STARS, { ...OPTS, loaded: NONE }), "buddy-1")).toMatchObject({
      k: "rect",
      color: "rgba(0,120,255,0.8)",
    });
  });

  it("power-ups: sprites keep their aspect; salvage and hull are always procedural", () => {
    const pu = (id: number, type: PowerUpType) => ({
      id,
      type,
      x: 100,
      y: 100,
      vy: 0,
      width: 24,
      height: 24,
      despawnTimer: 1,
    });
    const s = blank({
      powerUps: [
        pu(1, "shield"),
        pu(2, "bomb"),
        pu(3, "buddy"),
        pu(4, "lightning"),
        pu(5, "salvage"),
        pu(6, "hull"),
      ],
    });
    const ops = buildFrame(s, NO_STARS, OPTS);
    expect(byKey(ops, "pu-1")).toMatchObject({
      k: "image",
      sprite: "puShield",
      fit: "contain",
      x: 88,
      y: 88,
    });
    expect(byKey(ops, "pu-4")).toMatchObject({ k: "image", sprite: "puLightning" });
    expect(byKey(ops, "pu-5")).toMatchObject({ k: "rect", color: "#ffb020" });
    expect(byKey(ops, "pu-5-band")).toMatchObject({ k: "rect", color: "#7a4d08" });
    const hull = byKey(ops, "pu-6");
    expect(hull).toMatchObject({ k: "poly", color: "#00aaff" });
    expect(hull && hull.k === "poly" && hull.points.length).toBe(12);
    const bare = buildFrame(s, NO_STARS, { ...OPTS, loaded: NONE });
    expect(byKey(bare, "pu-1")).toMatchObject({
      k: "circle",
      color: "rgba(0,170,255,0.9)",
      r: 24 * 0.4,
    });
    expect(byKey(bare, "pu-2")).toMatchObject({ k: "circle", color: "rgba(255,80,0,0.9)" });
    expect(byKey(bare, "pu-3")).toMatchObject({ k: "rect", color: "rgba(0,255,200,0.9)" });
    const bolt = byKey(bare, "pu-4");
    expect(bolt).toMatchObject({ k: "poly", color: "#ffee00" });
    expect(bolt && bolt.k === "poly" && bolt.points.length).toBe(12);
  });

  it("asteroids: filled outline (lighter while flashing) then a stroked edge", () => {
    const rock = {
      id: 10,
      kind: "large" as const,
      x: 80,
      y: 80,
      vx: 0,
      vy: 0,
      radius: 22,
      hp: 6,
      rotation: 0,
      spin: 0,
      hitFlashTimer: 0,
      hitEnemyIds: [],
    };
    const ops = buildFrame(blank({ asteroids: [rock] }), NO_STARS, OPTS);
    const body = byKey(ops, "rock-10");
    expect(body).toMatchObject({ k: "poly", color: "#8b6a47" });
    expect(body && body.k === "poly" && body.points.length).toBe(18); // 9 vertices
    expect(byKey(ops, "rock-10-edge")).toMatchObject({ color: "#c9a27a", stroke: 1.5 });
    const flashing = buildFrame(
      blank({ asteroids: [{ ...rock, hitFlashTimer: 50 }] }),
      NO_STARS,
      OPTS
    );
    expect(byKey(flashing, "rock-10")).toMatchObject({ color: "#e8d3b8" });
    // outline vertices are rounded to 0.1 px, as the path always was
    const pts = body && body.k === "poly" ? body.points : [];
    expect(pts.length).toBe(18);
    expect(pts.every((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9)).toBe(true);
  });

  it("explosions use the frame sprite, or a fading procedural burst while frames load", () => {
    const s = blank({ explosions: [{ id: 1, x: 100, y: 100, frame: 10, frameTimer: 0 }] });
    expect(byKey(buildFrame(s, NO_STARS, OPTS), "ex-1")).toMatchObject({
      k: "image",
      sprite: "explosion",
      frame: 10,
      x: 100 - EXPLOSION_DRAW_SIZE / 2,
      w: EXPLOSION_DRAW_SIZE,
    });
    const burst = byKey(buildFrame(s, NO_STARS, { ...OPTS, loaded: NONE }), "ex-1");
    expect(burst).toMatchObject({ k: "circle", r: 6 + 0.5 * 18, color: "#ff4400", opacity: 0.5 });
    const early = blank({ explosions: [{ id: 2, x: 0, y: 0, frame: 2, frameTimer: 0 }] });
    expect(byKey(buildFrame(early, NO_STARS, { ...OPTS, loaded: NONE }), "ex-2")).toMatchObject({
      color: "#ffcc00",
    });
    // a frame index past the loaded strip falls back rather than drawing nothing
    const past = blank({ explosions: [{ id: 3, x: 0, y: 0, frame: 25, frameTimer: 0 }] });
    expect(byKey(buildFrame(past, NO_STARS, OPTS), "ex-3")).toMatchObject({ k: "circle" });
  });

  it("the bomb flash covers the canvas and fades with its timer", () => {
    const ops = buildFrame(blank({ bombFlashTimer: 150 }), NO_STARS, {
      ...OPTS,
      width: 300,
      height: 500,
    });
    expect(byKey(ops, "bomb-flash")).toEqual({
      k: "rect",
      key: "bomb-flash",
      x: 0,
      y: 0,
      w: 300,
      h: 500,
      color: "rgba(255,255,255,0.375)",
    });
    expect(byKey(buildFrame(blank(), NO_STARS, OPTS), "bomb-flash")).toBeUndefined();
  });
});

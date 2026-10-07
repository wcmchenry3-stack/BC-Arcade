/**
 * #2564: the native canvas's drawing rules, tested without a Skia canvas. `buildFrame` returns a
 * flat display list; these tests pin what is drawn, with what, and in which order.
 */
import {
  initStarSwarm,
  CANVAS_W,
  CANVAS_H,
  HIT_FLASH_DURATION,
  ASTEROID_HIT_FLASH_MS,
  BEAM_CHARGE_MS,
  BEAM_HALF_WIDTH,
  BEAM_LENGTH,
  BEAM_SPEED,
  ATTACK_RUN_BRACE_MS,
  BULLET_C_W,
  BUDDY_HP,
} from "../engine";
import { carrierOps, carrierBeamOps, BRACE_RGB } from "../render/carrier";
import { withAlpha } from "../render/color";
import { initStarfield } from "../starfield";
import { setDebugOpKeys } from "../render/opKeys";
import {
  buildFrame,
  playerVisible,
  hitFlash,
  EXPLOSION_DRAW_SIZE,
  INVINCIBLE_BLINK_INTERVAL,
  BUDDY_SIZE,
  ASTEROID_SPRITES,
  type DrawOp,
  type LoadedSprites,
} from "../render/frame";
import type { BuddyShip, Bullet, CarrierBeam, Enemy, PowerUpType, StarSwarmState } from "../types";

const ALL: LoadedSprites = {
  playerShip: true,
  buddyShip: true,
  enemyGrunt: true,
  enemyElite: true,
  enemyGuardian: true,
  enemyCarrier: true,
  bulletPlayer: true,
  puShield: true,
  puBomb: true,
  puBuddy: true,
  puLightning: true,
  asteroid1: true,
  asteroid2: true,
  asteroid3: true,
  asteroid4: true,
  explosion: Array.from({ length: 20 }, () => true),
};
const NONE: LoadedSprites = {
  playerShip: false,
  buddyShip: false,
  enemyGrunt: false,
  enemyElite: false,
  enemyGuardian: false,
  enemyCarrier: false,
  bulletPlayer: false,
  puShield: false,
  puBomb: false,
  puBuddy: false,
  puLightning: false,
  asteroid1: false,
  asteroid2: false,
  asteroid3: false,
  asteroid4: false,
  explosion: Array.from({ length: 20 }, () => false),
};
const OPTS = { loaded: ALL, width: CANVAS_W, height: CANVAS_H };
/** Every sprite loaded except the meteor designs — isolates the pre-#2573 procedural rock path. */
const NO_ASTEROID_SPRITES: LoadedSprites = {
  ...ALL,
  asteroid1: false,
  asteroid2: false,
  asteroid3: false,
  asteroid4: false,
};
const OPTS_NO_ASTEROID_SPRITES = {
  loaded: NO_ASTEROID_SPRITES,
  width: CANVAS_W,
  height: CANVAS_H,
};

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
function releasedBeam(over: Partial<CarrierBeam> = {}): CarrierBeam {
  return {
    id: 1,
    x: 180,
    y: 400,
    vy: BEAM_SPEED,
    length: BEAM_LENGTH,
    halfWidth: BEAM_HALF_WIDTH,
    ...over,
  };
}
// #2963: op keys are debug-only — these tests find ops by key, so they turn them on
beforeAll(() => setDebugOpKeys(true));
afterAll(() => setDebugOpKeys(false));

const byKey = (ops: DrawOp[], key: string) => ops.find((o) => o.key === key);
const keys = (ops: DrawOp[]) => ops.map((o) => o.key);

/** #2845: a Buddy ship on station with the given overrides. */
function buddyOf(over: Partial<BuddyShip> = {}): BuddyShip {
  return {
    id: 1,
    x: 100,
    y: 300,
    vx: 0,
    vy: 0,
    phase: "OnStation",
    hp: BUDDY_HP,
    hitFlashTimer: 0,
    ageMs: 0,
    stationMs: 5000,
    burstsLeft: 1,
    burstTimer: 1000,
    planMs: 0,
    goalX: 100,
    goalY: 300,
    facingRight: true,
    hitRockIds: [],
    ...over,
  };
}

describe("buildFrame — scene order", () => {
  it("draws every layer back to front — no background or stars (#2963: their own Pictures)", () => {
    const s = blank({
      enemyBullets: [bullet({ id: 1 })],
      playerBullets: [bullet({ id: 2, owner: "player" })],
      // escorted Carrier mid-flash and charging its beam, with an earlier beam still in flight
      enemies: [
        enemyOf("Carrier", { id: 3, hitFlashTimer: 100, beamPhase: "charge", beamTimer: 300 }),
        enemyOf("Guardian", { id: 11 }),
      ],
      carrierBeams: [releasedBeam({ id: 8 })],
      activePowerUp: { type: "shield", remainingMs: 5000, shieldAbsorbed: 0 },
      player: { ...blank().player, hullFlashTimer: 100 },
      buddyShips: [buddyOf({ id: 5, x: 50, y: 50, hp: 2 })],
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
    const ops = buildFrame(s, OPTS_NO_ASTEROID_SPRITES);
    expect(ops.some((o) => o.k === "fill")).toBe(false);
    expect(keys(ops)).toEqual([
      "eb-1",
      "pb-2",
      "en-3",
      "en-3-ring",
      "en-3-flash",
      "en-3-flash-ring",
      "en-11",
      "beam-telegraph",
      "beam-charge",
      "cbeam-8-glow",
      "cbeam-8-core",
      "cbeam-8-head",
      "player",
      "shield",
      "shield-ring",
      "hull-flash",
      "buddy-5",
      "buddy-5-hp-track",
      "buddy-5-hp-0",
      "buddy-5-hp-1",
      "pu-6",
      "rock-7",
      "rock-7-edge",
      "ex-4",
      "bomb-flash",
    ]);
    // the lightning tint sits between the hull flash and the buddies
    const lit = buildFrame(
      { ...s, activePowerUp: { type: "lightning", remainingMs: 5000, shieldAbsorbed: 0 } },
      OPTS_NO_ASTEROID_SPRITES
    );
    const k = keys(lit);
    expect(k.indexOf("hull-flash")).toBeLessThan(k.indexOf("lightning"));
    expect(k.indexOf("lightning")).toBeLessThan(k.indexOf("buddy-5"));
  });

  it("#2963: a wave-1 frame no longer carries the 95 star circles (nor the background fill)", () => {
    // Before #2963 this frame was [bg fill, 95 star circles, …scene] = 135 ops (all sprites
    // loaded, 37 swooping ships, the player and its overlays); the stars and background are now
    // recorded once into their own Pictures under the scene.
    const WAVE1_OPS_BEFORE_2963 = 135;
    const all: LoadedSprites = {
      ...ALL,
      bulletPlayer: true,
      puShield: true,
      puBomb: true,
      puBuddy: true,
      puLightning: true,
      asteroid1: true,
      asteroid2: true,
      asteroid3: true,
      asteroid4: true,
      explosion: Array.from({ length: 20 }, () => true),
    };
    const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42);
    const ops = buildFrame(s, { ...OPTS, loaded: all });
    expect(initStarfield(CANVAS_W, CANVAS_H).stars).toHaveLength(95);
    expect(WAVE1_OPS_BEFORE_2963 - ops.length).toBe(95 + 1);
    expect(ops.some((o) => o.k === "fill" || o.key?.startsWith("star-"))).toBe(false);
  });

  it("op keys are built only while debug keys are on (#2963)", () => {
    const s = blank({ enemyBullets: [bullet({ id: 1 })], buddyShips: [buddyOf({ id: 5 })] });
    setDebugOpKeys(false);
    try {
      const ops = buildFrame(s, OPTS);
      expect(ops.length).toBeGreaterThan(3);
      expect(ops.every((o) => o.key === undefined)).toBe(true);
    } finally {
      setDebugOpKeys(true);
    }
    expect(buildFrame(s, OPTS).every((o) => typeof o.key === "string")).toBe(true);
  });

  it("every key is unique within a frame", () => {
    const s = blank({
      enemies: [enemyOf("Carrier", { id: 7, hitFlashTimer: 100 }), enemyOf("Guardian", { id: 8 })],
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
    const k = keys(buildFrame(s, OPTS));
    expect(new Set(k).size).toBe(k.length);
  });
});

describe("buildFrame — bullets", () => {
  it("every enemy bullet in flight is drawn at full strength (#2842); flak is amber", () => {
    const s = blank({
      enemyBullets: [bullet({ id: 1 }), bullet({ id: 3, flak: true })],
    });
    const ops = buildFrame(s, OPTS);
    expect(byKey(ops, "eb-1")).toMatchObject({ k: "rect", color: 0xffff4422 });
    expect(byKey(ops, "eb-1")).not.toHaveProperty("opacity");
    expect(byKey(ops, "eb-3")).toMatchObject({ color: 0xffffd27a });
    expect(byKey(ops, "eb-3")).not.toHaveProperty("opacity");
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
    const loaded = buildFrame(s, OPTS);
    expect(byKey(loaded, "pb-1")).toMatchObject({
      k: "image",
      sprite: "bulletPlayer",
      fit: "fill",
    });
    expect(byKey(loaded, "pb-2")).toMatchObject({ k: "rect", color: 0xff00f0ff });
    const bare = buildFrame(s, { ...OPTS, loaded: NONE });
    expect(byKey(bare, "pb-1")).toMatchObject({ k: "rect", color: 0xff00ffcc });
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
    const ops = buildFrame(s, OPTS);
    for (const e of enemies) expect(byKey(ops, `en-${e.id}`)).toBeDefined();
    expect(byKey(ops, "en-99")).toBeUndefined();
  });

  it("each tier uses its sprite, or its fallback colour when the sprite hasn't loaded", () => {
    const s = blank({
      enemies: [
        enemyOf("Grunt", { id: 1 }),
        enemyOf("Elite", { id: 2 }),
        enemyOf("Guardian", { id: 3 }),
        enemyOf("Carrier", { id: 4 }),
      ],
    });
    const ops = buildFrame(s, OPTS);
    expect(byKey(ops, "en-1")).toMatchObject({ k: "image", sprite: "enemyGrunt" });
    expect(byKey(ops, "en-2")).toMatchObject({ k: "image", sprite: "enemyElite" });
    expect(byKey(ops, "en-3")).toMatchObject({ k: "image", sprite: "enemyGuardian" });
    expect(byKey(ops, "en-4")).toMatchObject({ k: "image", sprite: "enemyCarrier" });
    const bare = buildFrame(s, { ...OPTS, loaded: NONE });
    expect(byKey(bare, "en-1")).toMatchObject({ k: "rect", color: 0xff8888ff });
    expect(byKey(bare, "en-2")).toMatchObject({ k: "rect", color: 0xffff88ff });
    expect(byKey(bare, "en-3")).toMatchObject({ k: "rect", color: 0xffffff44 });
    expect(byKey(bare, "en-4")).toMatchObject({ k: "rect", color: 0xffb06cff });
  });

  it("the Carrier wears its force-field ring only while a Guardian escort lives", () => {
    const carrier = enemyOf("Carrier", { id: 1 });
    const escorted = blank({ enemies: [carrier, enemyOf("Guardian", { id: 2 })] });
    const ring = byKey(buildFrame(escorted, OPTS), "en-1-ring");
    expect(ring).toMatchObject({
      k: "circle",
      cx: carrier.x,
      cy: carrier.y,
      r: Math.max(carrier.width, carrier.height) * 0.62,
      color: withAlpha(0x00aaff, 0.45),
      stroke: 2,
    });
    const exposed = blank({ enemies: [carrier] });
    expect(byKey(buildFrame(exposed, OPTS), "en-1-ring")).toBeUndefined();
    // a Guardian never wears one
    expect(byKey(buildFrame(escorted, OPTS), "en-2-ring")).toBeUndefined();
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
    const ops = buildFrame(blank({ enemies: [e] }), OPTS);
    const f = hitFlash(e.width, e.height, e.hitFlashTimer);
    expect(byKey(ops, "en-5-flash")).toMatchObject({
      k: "circle",
      r: f.r,
      color: withAlpha(0x00aaff, f.fillAlpha),
    });
    expect(byKey(ops, "en-5-flash")).not.toHaveProperty("stroke");
    expect(byKey(ops, "en-5-flash-ring")).toMatchObject({
      color: withAlpha(0x00aaff, f.strokeAlpha),
      stroke: 3,
    });
    expect(keys(ops).indexOf("en-5-flash")).toBeLessThan(keys(ops).indexOf("en-5-flash-ring"));
    // no timer, no flash
    const calm = buildFrame(blank({ enemies: [{ ...e, hitFlashTimer: 0 }] }), OPTS);
    expect(byKey(calm, "en-5-flash")).toBeUndefined();
  });
});

describe("buildFrame — Carrier beam (#2485, #2843)", () => {
  const withBeam = (beamPhase: "idle" | "charge", beamTimer: number) =>
    blank({ enemies: [enemyOf("Carrier", { id: 1, beamPhase, beamTimer })] });

  it("no beam while idle and nothing released", () => {
    const ops = buildFrame(withBeam("idle", 5000), OPTS);
    expect(ops.some((o) => o.key?.startsWith("beam-") || o.key?.startsWith("cbeam-"))).toBe(false);
  });

  it("charge: a thin telegraph line and a growing orb, brightening with progress", () => {
    const s = withBeam("charge", BEAM_CHARGE_MS / 2); // progress 0.5
    const c = s.enemies[0]!;
    const ops = buildFrame(s, OPTS);
    expect(byKey(ops, "beam-telegraph")).toEqual({
      k: "rect",
      key: "beam-telegraph",
      x: c.x - 2,
      y: c.y + c.height / 2,
      w: 4,
      h: s.canvasH,
      color: withAlpha(0xb06cff, 0.275),
    });
    expect(byKey(ops, "beam-charge")).toMatchObject({
      cx: c.x,
      cy: c.y + c.height / 2 + 6,
      r: 8,
      color: withAlpha(0xb06cff, 0.65),
    });
  });

  it("a released beam is a traveling bolt: glow, core and head over its own length, not full height", () => {
    const b = releasedBeam({ id: 9, x: 120, y: 300 });
    const ops = buildFrame(blank({ carrierBeams: [b] }), OPTS);
    expect(byKey(ops, "cbeam-9-glow")).toEqual({
      k: "rect",
      key: "cbeam-9-glow",
      x: 120 - BEAM_HALF_WIDTH - 4,
      y: 300 - BEAM_LENGTH,
      w: BEAM_HALF_WIDTH * 2 + 8,
      h: BEAM_LENGTH,
      color: withAlpha(0xb06cff, 0.35),
    });
    expect(byKey(ops, "cbeam-9-core")).toMatchObject({
      x: 120 - BEAM_HALF_WIDTH * 0.5,
      w: BEAM_HALF_WIDTH,
      h: BEAM_LENGTH,
    });
    expect(byKey(ops, "cbeam-9-head")).toMatchObject({ k: "circle", cx: 120, cy: 300 });
    expect(BEAM_LENGTH).toBeLessThan(CANVAS_H / 2);
  });

  it("a released beam still draws with no Carrier alive — it is its own entity", () => {
    const ops = buildFrame(blank({ enemies: [], carrierBeams: [releasedBeam()] }), OPTS);
    expect(byKey(ops, "cbeam-1-core")).toBeDefined();
    expect(byKey(ops, "beam-telegraph")).toBeUndefined();
  });

  it("attack-run brace: an amber ring tightening around the Carrier and a chevron below it", () => {
    const at = (runTimer: number) =>
      blank({ enemies: [enemyOf("Carrier", { id: 1, runPhase: "brace", runTimer })] });
    const early = buildFrame(at(ATTACK_RUN_BRACE_MS), OPTS);
    const late = buildFrame(at(0), OPTS);
    const ring0 = byKey(early, "carrier-brace-ring") as Extract<DrawOp, { k: "circle" }>;
    const ring1 = byKey(late, "carrier-brace-ring") as Extract<DrawOp, { k: "circle" }>;
    expect(ring0.color & 0xffffff).toBe(BRACE_RGB);
    expect(ring1.r).toBeLessThan(ring0.r);
    expect(byKey(late, "carrier-brace-chevron")).toMatchObject({ k: "poly" });
    // not bracing: no telegraph
    const idle = buildFrame(withBeam("idle", 5000), OPTS);
    expect(byKey(idle, "carrier-brace-ring")).toBeUndefined();
  });

  it("native and web share one geometry: buildFrame embeds carrierOps verbatim", () => {
    const s = blank({
      enemies: [
        enemyOf("Carrier", { id: 1, beamPhase: "charge", beamTimer: 200, runPhase: "idle" }),
      ],
      carrierBeams: [releasedBeam({ id: 4 }), releasedBeam({ id: 5, y: 520 })],
    });
    const shared = carrierOps(s);
    const ops = buildFrame(s, OPTS);
    const start = ops.findIndex((o) => o.key === shared[0]!.key);
    expect(ops.slice(start, start + shared.length)).toEqual(shared);
    expect(shared.filter((o) => o.key?.startsWith("cbeam-"))).toEqual([
      ...carrierBeamOps(s.carrierBeams[0]!),
      ...carrierBeamOps(s.carrierBeams[1]!),
    ]);
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

  it("stays drawn while the extraction climbs it out, and vanishes off the top (#2842)", () => {
    const at = (y: number) =>
      blank({
        phase: "Extraction",
        extraction: { elapsedMs: 900, climbMs: 400 },
        player: { ...blank().player, y },
      });
    expect(byKey(buildFrame(at(300), OPTS), "player")).toBeDefined();
    expect(playerVisible(at(-10))).toBe(true); // still partly on screen
    expect(playerVisible(at(-40))).toBe(false);
    expect(byKey(buildFrame(at(-40), OPTS), "player")).toBeUndefined();
  });

  it("is hidden above the top edge and at game over — overlays included (#2334)", () => {
    const shielded = blank({
      activePowerUp: { type: "shield", remainingMs: 5000, shieldAbsorbed: 0 },
      player: { ...blank().player, hullFlashTimer: 100 },
    });
    const live = buildFrame(shielded, OPTS);
    expect(keys(live)).toEqual(
      expect.arrayContaining(["player", "shield", "shield-ring", "hull-flash"])
    );
    const over = buildFrame({ ...shielded, phase: "GameOver" }, OPTS);
    for (const k of ["player", "shield", "shield-ring", "hull-flash"]) {
      expect(byKey(over, k)).toBeUndefined();
    }
    const lit = {
      ...shielded,
      activePowerUp: { type: "lightning" as const, remainingMs: 1, shieldAbsorbed: 0 },
    };
    expect(byKey(buildFrame(lit, OPTS), "lightning")).toBeDefined();
    expect(byKey(buildFrame({ ...lit, phase: "GameOver" }, OPTS), "lightning")).toBeUndefined();
    const offTop = { ...shielded, player: { ...shielded.player, y: -shielded.player.height - 1 } };
    expect(byKey(buildFrame(offTop, OPTS), "player")).toBeUndefined();
  });

  it("sprite or fallback; shield aura fill then ring; hull flash ring; lightning tint", () => {
    const p = blank().player;
    const s = blank({
      activePowerUp: { type: "lightning", remainingMs: 5000, shieldAbsorbed: 0 },
      player: { ...p, hullFlashTimer: HIT_FLASH_DURATION / 2 },
    });
    const ops = buildFrame(s, OPTS);
    expect(byKey(ops, "player")).toMatchObject({
      k: "image",
      sprite: "playerShip",
      x: p.x - p.width / 2,
      y: p.y - p.height / 2,
      fit: "fill",
    });
    expect(byKey(ops, "lightning")).toMatchObject({ k: "rect", color: withAlpha(0xffee00, 0.45) });
    expect(byKey(ops, "hull-flash")).toMatchObject({
      r: p.width * 0.8,
      color: withAlpha(0x00aaff, 0.375),
      stroke: 3,
    });
    expect(byKey(ops, "shield")).toBeUndefined();
    const shield = buildFrame(
      blank({ activePowerUp: { type: "shield", remainingMs: 1, shieldAbsorbed: 0 } }),
      OPTS
    );
    expect(byKey(shield, "shield")).toMatchObject({
      r: p.width * 0.8,
      color: withAlpha(0x00aaff, 0.25),
    });
    expect(byKey(shield, "shield")).not.toHaveProperty("stroke");
    expect(byKey(shield, "shield-ring")).toMatchObject({ stroke: 2 });
    expect(byKey(buildFrame(blank(), { ...OPTS, loaded: NONE }), "player")).toMatchObject({
      k: "rect",
      color: 0xff00ffcc,
    });
  });
});

describe("buildFrame — buddies, power-ups, rocks, explosions, bomb flash", () => {
  it("buddy ships face their direction of travel", () => {
    const s = blank({
      buddyShips: [
        buddyOf({ id: 1, x: 100, y: 200, facingRight: true }),
        buddyOf({ id: 2, x: 300, y: 200, facingRight: false }),
      ],
    });
    const ops = buildFrame(s, OPTS);
    expect(byKey(ops, "buddy-1")).toMatchObject({
      k: "image",
      sprite: "buddyShip",
      x: 100 - BUDDY_SIZE / 2,
      w: BUDDY_SIZE,
      flipX: false,
    });
    expect(byKey(ops, "buddy-2")).toMatchObject({ flipX: true });
    expect(byKey(buildFrame(s, { ...OPTS, loaded: NONE }), "buddy-1")).toMatchObject({
      k: "rect",
      color: withAlpha(0x0078ff, 0.8),
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
    const ops = buildFrame(s, OPTS);
    expect(byKey(ops, "pu-1")).toMatchObject({
      k: "image",
      sprite: "puShield",
      fit: "contain",
      x: 88,
      y: 88,
    });
    expect(byKey(ops, "pu-4")).toMatchObject({ k: "image", sprite: "puLightning" });
    expect(byKey(ops, "pu-5")).toMatchObject({ k: "rect", color: 0xffffb020 });
    expect(byKey(ops, "pu-5-band")).toMatchObject({ k: "rect", color: 0xff7a4d08 });
    const hull = byKey(ops, "pu-6");
    expect(hull).toMatchObject({ k: "poly", color: 0xff00aaff });
    expect(hull && hull.k === "poly" && hull.points.length).toBe(12);
    const bare = buildFrame(s, { ...OPTS, loaded: NONE });
    expect(byKey(bare, "pu-1")).toMatchObject({
      k: "circle",
      color: withAlpha(0x00aaff, 0.9),
      r: 24 * 0.4,
    });
    expect(byKey(bare, "pu-2")).toMatchObject({ k: "circle", color: withAlpha(0xff5000, 0.9) });
    expect(byKey(bare, "pu-3")).toMatchObject({ k: "rect", color: withAlpha(0x00ffc8, 0.9) });
    const bolt = byKey(bare, "pu-4");
    expect(bolt).toMatchObject({ k: "poly", color: 0xffffee00 });
    expect(bolt && bolt.k === "poly" && bolt.points.length).toBe(12);
  });

  it("asteroids: fallback while sprites load — filled outline (lighter while flashing), then a stroked edge", () => {
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
    const ops = buildFrame(blank({ asteroids: [rock] }), OPTS_NO_ASTEROID_SPRITES);
    const body = byKey(ops, "rock-10");
    expect(body).toMatchObject({ k: "poly", color: 0xff8b6a47 });
    expect(body && body.k === "poly" && body.points.length).toBe(18); // 9 vertices
    expect(byKey(ops, "rock-10-edge")).toMatchObject({ color: 0xffc9a27a, stroke: 1.5 });
    const flashing = buildFrame(
      blank({ asteroids: [{ ...rock, hitFlashTimer: 50 }] }),
      OPTS_NO_ASTEROID_SPRITES
    );
    expect(byKey(flashing, "rock-10")).toMatchObject({ color: 0xffe8d3b8 });
    // outline vertices are rounded to 0.1 px, as the path always was
    const pts = body && body.k === "poly" ? body.points : [];
    expect(pts.length).toBe(18);
    expect(pts.every((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9)).toBe(true);
  });

  it("asteroids: a random meteor sprite, sized to 2×radius, centred, rotated by `rotation`, when loaded (#2573)", () => {
    const rock = {
      id: 10,
      kind: "large" as const,
      x: 80,
      y: 80,
      vx: 0,
      vy: 0,
      radius: 22,
      hp: 6,
      rotation: 0.75,
      spin: 0,
      hitFlashTimer: 0,
      hitEnemyIds: [],
    };
    const ops = buildFrame(blank({ asteroids: [rock] }), OPTS);
    const body = byKey(ops, "rock-10");
    expect(body).toMatchObject({
      k: "image",
      x: 80 - 22,
      y: 80 - 22,
      w: 44,
      h: 44,
      fit: "fill",
      rotate: 0.75,
    });
    expect(body && body.k === "image" && ASTEROID_SPRITES).toContain(
      body && body.k === "image" ? body.sprite : undefined
    );
    expect(byKey(ops, "rock-10-edge")).toBeUndefined();
    // a small rock gets the same treatment at its own size — same design reused, not a second file
    const small = { ...rock, id: 10, kind: "small" as const, radius: 12 };
    const smallOps = buildFrame(blank({ asteroids: [small] }), OPTS);
    expect(byKey(smallOps, "rock-10")).toMatchObject({ w: 24, h: 24 });
  });

  it("asteroids: hit flash is a white ring while using a sprite, not the procedural tint", () => {
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
      hitFlashTimer: 50,
      hitEnemyIds: [],
    };
    const ops = buildFrame(blank({ asteroids: [rock] }), OPTS);
    expect(byKey(ops, "rock-10")).toMatchObject({ k: "image" });
    const flash = byKey(ops, "rock-10-flash");
    expect(flash).toMatchObject({ k: "circle", cx: 80, cy: 80, stroke: 2 });
    // normalized against ASTEROID_HIT_FLASH_MS (120), not the ships' HIT_FLASH_DURATION (250) —
    // a rock's flash timer never reaches 250, so the wrong constant would under-scale every value
    expect(flash).toMatchObject({ r: expect.closeTo(47.08, 2) });
    expect(flash && flash.k === "circle" && flash.color).toBe(withAlpha(0xffffff, 0.313));
    // fresh off a hit (timer === ASTEROID_HIT_FLASH_MS) the ring starts at full intensity, exactly
    // like a ship's fresh flash does at HIT_FLASH_DURATION
    const fresh = byKey(
      buildFrame(blank({ asteroids: [{ ...rock, hitFlashTimer: ASTEROID_HIT_FLASH_MS }] }), OPTS),
      "rock-10-flash"
    );
    expect(fresh && fresh.k === "circle" && fresh.color).toBe(withAlpha(0xffffff, 0.75));
    const calm = buildFrame(blank({ asteroids: [{ ...rock, hitFlashTimer: 0 }] }), OPTS);
    expect(byKey(calm, "rock-10-flash")).toBeUndefined();
  });

  it("asteroids: the sprite pick is stable per id and draws from all 4 designs", () => {
    const rockAt = (id: number) => ({
      id,
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
    });
    const spriteFor = (id: number) => {
      const op = byKey(buildFrame(blank({ asteroids: [rockAt(id)] }), OPTS), `rock-${id}`);
      return op && op.k === "image" ? op.sprite : undefined;
    };
    // deterministic: the same rock id always picks the same design
    expect(spriteFor(10)).toBe(spriteFor(10));
    // varied: enough distinct ids exercise more than one of the 4 designs
    const picks = new Set(Array.from({ length: 40 }, (_, i) => spriteFor(i + 1)));
    expect(picks.size).toBeGreaterThan(1);
    for (const s of picks) expect(ASTEROID_SPRITES).toContain(s);
  });

  it("explosions use the frame sprite, or a fading procedural burst while frames load", () => {
    const s = blank({ explosions: [{ id: 1, x: 100, y: 100, frame: 10, frameTimer: 0 }] });
    expect(byKey(buildFrame(s, OPTS), "ex-1")).toMatchObject({
      k: "image",
      sprite: "explosion",
      frame: 10,
      x: 100 - EXPLOSION_DRAW_SIZE / 2,
      w: EXPLOSION_DRAW_SIZE,
    });
    const burst = byKey(buildFrame(s, { ...OPTS, loaded: NONE }), "ex-1");
    expect(burst).toMatchObject({ k: "circle", r: 6 + 0.5 * 18, color: 0xffff4400, opacity: 0.5 });
    const early = blank({ explosions: [{ id: 2, x: 0, y: 0, frame: 2, frameTimer: 0 }] });
    expect(byKey(buildFrame(early, { ...OPTS, loaded: NONE }), "ex-2")).toMatchObject({
      color: 0xffffcc00,
    });
    // a frame index past the loaded strip falls back rather than drawing nothing
    const past = blank({ explosions: [{ id: 3, x: 0, y: 0, frame: 25, frameTimer: 0 }] });
    expect(byKey(buildFrame(past, OPTS), "ex-3")).toMatchObject({ k: "circle" });
  });

  it("the bomb flash covers the canvas and fades with its timer", () => {
    const ops = buildFrame(blank({ bombFlashTimer: 150 }), {
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
      color: withAlpha(0xffffff, 0.375),
    });
    expect(byKey(buildFrame(blank(), OPTS), "bomb-flash")).toBeUndefined();
  });
});

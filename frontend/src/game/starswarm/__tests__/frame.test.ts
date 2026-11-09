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
  REINFORCE_BAY_OPEN_MS,
  BULLET_C_W,
  BUDDY_HP,
  EXPLOSION_FRAME_MS,
} from "../engine";
import { carrierOps, carrierBeamOps } from "../render/carrier";
import { SHIP_SPRITE_PAD } from "../render/ship";
import {
  ARMOR_BLUE_RGB,
  ARMOR_PALE_RGB,
  ASTEROID_EDGE_RGB,
  ASTEROID_RGB,
  HIT_CORE_RGB,
  HIT_RING_RGB,
  LIGHTNING_AURA_RGB,
  SHIELD_BUBBLE_RGB,
  SHIELD_RIM_RGB,
} from "../render/palette";
import { opaque, withAlpha } from "../render/color";
import { ROCK_BODIES, ROCK_SPRITE_PAD, ROCK_VEINS } from "../render/asteroids";
import { initStarfield } from "../starfield";
import { setDebugOpKeys } from "../render/opKeys";
import { hitFlash } from "../render/enemies";
import { bombFlashOps, explosionOps } from "../render/explosions";
import {
  buildFrame,
  playerVisible,
  INVINCIBLE_BLINK_INTERVAL,
  BUDDY_SIZE,
  type DrawOp,
  type LoadedSprites,
} from "../render/frame";
import type { ShipId } from "../render/ship";
import type {
  BuddyShip,
  Bullet,
  CarrierBeam,
  Enemy,
  ExplosionKind,
  PowerUpType,
  StarSwarmState,
} from "../types";

/** #3625: the CB2 "searing plasma" colours (0xRRGGBB): body, core, glow. */
const PLASMA_RGB = 0xff3a1a;
const PLASMA_CORE_RGB = 0xfff2b0;
const PLASMA_GLOW_RGB = 0xff8a3c;
const BRACE_RGB = PLASMA_GLOW_RGB;
const HIVE_SHIELD_RGB = 0xe08cff;

const ALL: LoadedSprites = {
  p1Base: true,
  p1Guns2: true,
  p1Guns3: true,
  p1Plating1: true,
  p1Plating2: true,
  p2Base: true,
  p2Guns2: true,
  p2Guns3: true,
  p2Plating1: true,
  p2Plating2: true,
  p3Base: true,
  p3Guns2: true,
  p3Guns3: true,
  p3Plating1: true,
  p3Plating2: true,
  buddyShip: true,
  enemyGrunt: true,
  enemyElite: true,
  enemyGuardian: true,
  enemyCarrier: true,
  enemyEliteAttack: true,
  enemyEliteHurt: true,
  enemyGuardianPlate: true,
  enemyGuardianCracks: true,
  enemyGuardianPlate2: true,
  enemyCarrierCracks: true,
  shotPlayer: true,
  shotBuddy: true,
  shotEnemy: true,
  shotFlak: true,
  shotCarrier: true,
  puShield: true,
  puBomb: true,
  puBuddy: true,
  puLightning: true,
  rockLarge1: true,
  rockLarge1Veins: true,
  rockLarge2: true,
  rockLarge2Veins: true,
  rockSmall1: true,
  rockSmall2: true,
};
const NONE: LoadedSprites = {
  p1Base: false,
  p1Guns2: false,
  p1Guns3: false,
  p1Plating1: false,
  p1Plating2: false,
  p2Base: false,
  p2Guns2: false,
  p2Guns3: false,
  p2Plating1: false,
  p2Plating2: false,
  p3Base: false,
  p3Guns2: false,
  p3Guns3: false,
  p3Plating1: false,
  p3Plating2: false,
  buddyShip: false,
  enemyGrunt: false,
  enemyElite: false,
  enemyGuardian: false,
  enemyCarrier: false,
  enemyEliteAttack: false,
  enemyEliteHurt: false,
  enemyGuardianPlate: false,
  enemyGuardianCracks: false,
  enemyGuardianPlate2: false,
  enemyCarrierCracks: false,
  shotPlayer: false,
  shotBuddy: false,
  shotEnemy: false,
  shotFlak: false,
  shotCarrier: false,
  puShield: false,
  puBomb: false,
  puBuddy: false,
  puLightning: false,
  rockLarge1: false,
  rockLarge1Veins: false,
  rockLarge2: false,
  rockLarge2Veins: false,
  rockSmall1: false,
  rockSmall2: false,
};
const OPTS = { loaded: ALL, width: CANVAS_W, height: CANVAS_H };
/** Every sprite loaded except the rock art — isolates the procedural rock fallback. */
const NO_ASTEROID_SPRITES: LoadedSprites = {
  ...ALL,
  rockLarge1: false,
  rockLarge1Veins: false,
  rockLarge2: false,
  rockLarge2Veins: false,
  rockSmall1: false,
  rockSmall2: false,
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
      "en-3-bubble",
      "en-3-bubble-rim",
      "en-3-bubble-hex-0",
      "en-3-bubble-hex-1",
      "en-3-bubble-hex-2",
      "en-3-bubble-hex-3",
      "en-3-bubble-hex-4",
      "en-3-bubble-hex-5",
      "en-3-flash",
      "en-3-flash-ring",
      "en-3-flash-spark-0",
      "en-3-flash-spark-1",
      "en-3-flash-spark-2",
      "en-3-flash-spark-3",
      "en-11",
      "beam-telegraph",
      "beam-charge",
      "beam-charge-core",
      "cbeam-8-glow",
      "cbeam-8-core",
      "cbeam-8-hot",
      "cbeam-8-head",
      "player",
      "shield",
      "shield-edge",
      "shield-hex",
      "shield-ring",
      "hull-flash",
      "hull-flash-core",
      "buddy-5",
      "buddy-5-hp-track",
      "buddy-5-hp-0",
      "buddy-5-hp-1",
      "pu-6",
      "rock-7",
      "rock-7-edge",
      // #3597: the code-drawn explosion (a pop early in its life: core, ring), then the bomb
      // flash over it (tint, then the shockwave; its white-hot core is over by now)
      "ex-4-core",
      "ex-4-core-hot",
      "ex-4-ring-glow",
      "ex-4-ring",
      "bomb-flash",
      "bomb-wave-glow",
      "bomb-wave",
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
    // recorded once into their own Pictures under the scene. #3625 added the armoured Carrier's
    // bubble (links only show in formation), counted on their own so the star arithmetic stays
    // visible.
    const CARRIER_FX_OPS_3625 = 7; // the 8-op bubble replacing the 1-op ring (net +7); no links yet
    const WAVE1_OPS_BEFORE_2963 = 135 + CARRIER_FX_OPS_3625;
    const all: LoadedSprites = {
      ...ALL,
      shotPlayer: true,
      shotBuddy: true,
      shotEnemy: true,
      shotFlak: true,
      shotCarrier: true,
      puShield: true,
      puBomb: true,
      puBuddy: true,
      puLightning: true,
      rockLarge1: true,
      rockLarge1Veins: true,
      rockLarge2: true,
      rockLarge2Veins: true,
      rockSmall1: true,
      rockSmall2: true,
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
  it("every enemy bullet in flight is drawn at full strength (#2842); flak is the amber shard (#3594)", () => {
    const s = blank({
      enemyBullets: [bullet({ id: 1, vy: 0.35 }), bullet({ id: 3, flak: true, vy: 0.35 })],
    });
    const ops = buildFrame(s, OPTS);
    expect(byKey(ops, "eb-1")).toMatchObject({ k: "image", sprite: "shotEnemy" });
    expect(byKey(ops, "eb-1")).not.toHaveProperty("opacity");
    expect(byKey(ops, "eb-3")).toMatchObject({ k: "image", sprite: "shotFlak" });
    expect(byKey(ops, "eb-3")).not.toHaveProperty("opacity");
    // centred on the bullet: the 7 px orb plus its 2 px glow margin
    expect(byKey(ops, "eb-1")).toMatchObject({ x: 100 - 5.5, y: 300 - 5.5, w: 11, h: 11 });
  });

  it("player bullets: every bolt is the sprite (a charged one at its own width) or its fallback (#3594)", () => {
    const s = blank({
      playerBullets: [
        bullet({ id: 1, owner: "player", width: 5, height: 14, vy: -0.56 }),
        bullet({ id: 2, owner: "player", width: BULLET_C_W, height: 14, vy: -0.56 }),
      ],
    });
    const loaded = buildFrame(s, OPTS);
    expect(byKey(loaded, "pb-1")).toMatchObject({
      k: "image",
      sprite: "shotPlayer",
      fit: "fill",
      x: 100 - 4.5,
      w: 9,
      h: 18,
    });
    expect(byKey(loaded, "pb-2")).toMatchObject({ k: "image", sprite: "shotPlayer", w: 16 });
    const bare = buildFrame(s, { ...OPTS, loaded: NONE });
    expect(byKey(bare, "pb-1")).toMatchObject({ k: "rect", color: 0xff00e8d0, w: 5, h: 14 });
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

  it("each tier uses its sprite, or its fallback shape when the sprite hasn't loaded", () => {
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
    // #3593: one shape per tier, in the shell's light violet (enemiesRender.test.ts has the shapes)
    for (const k of ["en-1", "en-2", "en-3", "en-4"]) {
      expect(byKey(bare, k)).toMatchObject({ k: "poly", color: 0xffb07ae0 });
    }
  });

  it("the Carrier wears its hive-shield bubble only while a Guardian escort lives, never a ring (#3625)", () => {
    const carrier = enemyOf("Carrier", { id: 1 });
    const escorted = blank({ enemies: [carrier, enemyOf("Guardian", { id: 2 })] });
    const list = buildFrame(escorted, OPTS);
    expect(byKey(list, "en-1-bubble")).toMatchObject({
      k: "circle",
      cx: carrier.x,
      cy: carrier.y,
      r: Math.max(carrier.width, carrier.height) * 0.68,
    });
    expect(byKey(list, "en-1-ring")).toBeUndefined();
    const exposed = blank({ enemies: [carrier, enemyOf("Grunt", { id: 3 })] });
    expect(keys(buildFrame(exposed, OPTS)).some((k) => /bubble|link/.test(k ?? ""))).toBe(false);
    // a Guardian never wears one
    expect(byKey(list, "en-2-bubble")).toBeUndefined();
  });

  it("the hit flash grows and fades over HIT_FLASH_DURATION: core then ring (#3593 style B)", () => {
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
      r: f.r * 0.6,
      color: withAlpha(0xffe6c8, f.fillAlpha * 1.6),
    });
    expect(byKey(ops, "en-5-flash")).not.toHaveProperty("stroke");
    expect(byKey(ops, "en-5-flash-ring")).toMatchObject({
      r: f.r,
      color: withAlpha(0xff7a2e, f.strokeAlpha),
      stroke: 2,
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
      color: withAlpha(PLASMA_GLOW_RGB, 0.275),
    });
    expect(byKey(ops, "beam-charge")).toMatchObject({
      cx: c.x,
      cy: c.y + c.height / 2 + 6,
      r: 8,
      color: withAlpha(PLASMA_RGB, 0.65),
    });
    expect(byKey(ops, "beam-charge-core")).toMatchObject({
      cx: c.x,
      cy: c.y + c.height / 2 + 6,
      r: 8 * 0.45,
      color: withAlpha(PLASMA_CORE_RGB, 0.75),
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
      color: withAlpha(PLASMA_GLOW_RGB, 0.35),
    });
    expect(byKey(ops, "cbeam-9-core")).toMatchObject({
      x: 120 - BEAM_HALF_WIDTH * 0.5,
      w: BEAM_HALF_WIDTH,
      h: BEAM_LENGTH,
      color: withAlpha(PLASMA_RGB, 0.9),
    });
    // the hot core runs the bolt's length inside the body; the head is white-hot yellow
    expect(byKey(ops, "cbeam-9-hot")).toMatchObject({
      y: 300 - BEAM_LENGTH,
      h: BEAM_LENGTH,
      color: withAlpha(PLASMA_CORE_RGB, 0.95),
    });
    expect(byKey(ops, "cbeam-9-head")).toMatchObject({
      k: "circle",
      cx: 120,
      cy: 300,
      r: BEAM_HALF_WIDTH * 0.9,
      color: withAlpha(PLASMA_CORE_RGB, 1),
    });
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
    expect(ring0.stroke).toBe(3); // geometry unchanged
    expect(ring1.r).toBeLessThan(ring0.r);
    expect(byKey(late, "carrier-brace-chevron")).toMatchObject({ k: "poly" });
    // the red halo rides the ring, the hot chevron core rides the chevron
    const halo = byKey(early, "carrier-brace-halo") as Extract<DrawOp, { k: "circle" }>;
    expect(halo).toMatchObject({ r: ring0.r, stroke: 8 });
    expect(halo.color & 0xffffff).toBe(PLASMA_RGB);
    const hot = byKey(late, "carrier-brace-chevron-hot") as Extract<DrawOp, { k: "poly" }>;
    expect(hot.color & 0xffffff).toBe(PLASMA_CORE_RGB);
    // not bracing: no telegraph
    const idle = buildFrame(withBeam("idle", 5000), OPTS);
    expect(byKey(idle, "carrier-brace-ring")).toBeUndefined();
  });

  it("bay-open (#3561): a glow and hatch on the Carrier's underside only while the bay is open", () => {
    const at = (carrierBayOpen: number) =>
      blank({ carrierBayOpen, enemies: [enemyOf("Carrier", { id: 1 })] });
    const c = at(0).enemies[0]!;
    const early = buildFrame(at(REINFORCE_BAY_OPEN_MS), OPTS);
    const late = buildFrame(at(40), OPTS);
    const glow0 = byKey(early, "carrier-bay-glow") as Extract<DrawOp, { k: "circle" }>;
    const glow1 = byKey(late, "carrier-bay-glow") as Extract<DrawOp, { k: "circle" }>;
    // under the Queen's abdomen: the sprite's bay is 0.86 of the box down (generator `_queen_canvas`)
    const bayY = c.y - c.height / 2 + 0.86 * c.height;
    expect(glow0).toMatchObject({ k: "circle", cx: c.x, cy: bayY });
    expect(glow0.color & 0xffffff).toBe(HIVE_SHIELD_RGB);
    expect(glow1.r).toBeGreaterThan(glow0.r); // it swells as the launch nears
    const hatch0 = byKey(early, "carrier-bay-hatch") as Extract<DrawOp, { k: "rect" }>;
    const hatch1 = byKey(late, "carrier-bay-hatch") as Extract<DrawOp, { k: "rect" }>;
    expect(hatch1.h).toBeGreaterThan(hatch0.h);
    // the hatch is the sprite's bay: 0.24 of the box wide, centred on it
    expect(hatch0.w).toBeCloseTo(c.width * 0.24);
    expect(hatch0.x + hatch0.w / 2).toBeCloseTo(c.x);
    expect(hatch0.y + hatch0.h / 2).toBeCloseTo(bayY);
    // shut: no cue; open but the Carrier is dead: no cue either
    for (const shut of [at(0), blank({ carrierBayOpen: 200, enemies: [] })]) {
      const ops = buildFrame(shut, OPTS);
      expect(byKey(ops, "carrier-bay-glow")).toBeUndefined();
      expect(byKey(ops, "carrier-bay-hatch")).toBeUndefined();
    }
    // native and web replay the same ops
    expect(carrierOps(at(200)).map((o) => o.key)).toEqual([
      "carrier-bay-glow",
      "carrier-bay-hatch",
    ]);
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

  it("the player is the ship stack, or one cyan triangle while its sprites load", () => {
    const p = blank().player;
    const ops = buildFrame(blank(), OPTS);
    expect(byKey(ops, "player")).toMatchObject({
      k: "ship",
      sprites: ["p1Base"],
      x: p.x - p.width / 2 - SHIP_SPRITE_PAD,
      y: p.y - p.height / 2 - SHIP_SPRITE_PAD,
      w: p.width + 2 * SHIP_SPRITE_PAD,
      h: p.height + 2 * SHIP_SPRITE_PAD,
    });
    const bare = byKey(buildFrame(blank(), { ...OPTS, loaded: NONE }), "player");
    expect(bare).toMatchObject({ k: "poly", color: 0xff00ffcc });
    // the same triangle the web canvas replays: apex top-centre, base along the bottom
    const x = p.x - p.width / 2;
    const y = p.y - p.height / 2;
    expect(bare && bare.k === "poly" && bare.points).toEqual([
      x + p.width / 2,
      y,
      x,
      y + p.height,
      x + p.width,
      y + p.height,
    ]);
  });

  it("shield bubble: soft body, edge band, hex hint, bright rim (style B)", () => {
    const p = blank().player;
    expect(byKey(buildFrame(blank(), OPTS), "shield")).toBeUndefined();
    const ops = buildFrame(
      blank({ activePowerUp: { type: "shield", remainingMs: 1, shieldAbsorbed: 0 } }),
      OPTS
    );
    expect(byKey(ops, "shield")).toMatchObject({
      k: "circle",
      r: p.width * 0.8,
      color: withAlpha(SHIELD_BUBBLE_RGB, 0.1),
    });
    expect(byKey(ops, "shield")).not.toHaveProperty("stroke");
    expect(byKey(ops, "shield-edge")).toMatchObject({ stroke: 6 });
    const hex = byKey(ops, "shield-hex");
    expect(hex).toMatchObject({ k: "poly", stroke: 1 });
    expect(hex && hex.k === "poly" && hex.points).toHaveLength(12);
    expect(byKey(ops, "shield-ring")).toMatchObject({
      r: p.width * 0.8,
      color: withAlpha(SHIELD_RIM_RGB, 0.85),
      stroke: 2,
    });
    // back to front: body, edge band, hex, rim
    expect(keys(ops).filter((k) => k?.startsWith("shield"))).toEqual([
      "shield",
      "shield-edge",
      "shield-hex",
      "shield-ring",
    ]);
  });

  it("hull plating flash keeps its timing: a ring that grows and fades over the hit flash", () => {
    const p = blank().player;
    const flash = (t: number) => buildFrame(blank({ player: { ...p, hullFlashTimer: t } }), OPTS);
    expect(byKey(flash(0), "hull-flash")).toBeUndefined();
    expect(byKey(flash(HIT_FLASH_DURATION / 2), "hull-flash")).toMatchObject({
      r: p.width * 0.8,
      color: withAlpha(ARMOR_BLUE_RGB, 0.375),
      stroke: 3,
    });
    expect(byKey(flash(HIT_FLASH_DURATION / 2), "hull-flash-core")).toMatchObject({
      r: p.width * 0.8,
      color: withAlpha(ARMOR_PALE_RGB, 0.45),
      stroke: 1,
    });
    expect(byKey(flash(HIT_FLASH_DURATION), "hull-flash")).toMatchObject({ r: p.width * 0.6 });
  });

  it("Lightning: an electric halo and four sparks, no box tint over the ship", () => {
    const p = blank().player;
    const ops = buildFrame(
      blank({ activePowerUp: { type: "lightning", remainingMs: 5000, shieldAbsorbed: 0 } }),
      OPTS
    );
    expect(byKey(ops, "lightning")).toMatchObject({
      k: "circle",
      r: p.width * 0.75,
      color: withAlpha(LIGHTNING_AURA_RGB, 0.14),
    });
    expect(byKey(ops, "lightning-ring")).toMatchObject({ stroke: 1.5 });
    expect(keys(ops).filter((k) => k?.startsWith("lightning-spark"))).toHaveLength(4);
    expect(ops.some((o) => o.k === "rect" && o.w === p.width && o.h === p.height)).toBe(false);
    // the sparks jump as the power-up counts down
    const later = buildFrame(
      blank({ activePowerUp: { type: "lightning", remainingMs: 4800, shieldAbsorbed: 0 } }),
      OPTS
    );
    expect(byKey(later, "lightning-spark-0")).not.toEqual(byKey(ops, "lightning-spark-0"));
  });
});

describe("buildFrame — the player ship's layers (#3592)", () => {
  const ship = (guns: 1 | 2 | 3, hull: 0 | 1 | 2, o: { ship?: ShipId } = {}) => {
    const p = blank().player;
    const op = byKey(
      buildFrame(blank({ player: { ...p, guns, hull } }), { ...OPTS, ...o }),
      "player"
    );
    if (!op || op.k !== "ship") throw new Error("no ship op");
    return op;
  };

  it.each([
    [1, 0, ["p1Base"]],
    [2, 0, ["p1Base", "p1Guns2"]],
    [3, 0, ["p1Base", "p1Guns2", "p1Guns3"]],
    [1, 1, ["p1Base", "p1Plating1"]],
    [1, 2, ["p1Base", "p1Plating1", "p1Plating2"]],
    [2, 1, ["p1Base", "p1Guns2", "p1Plating1"]],
    [3, 2, ["p1Base", "p1Guns2", "p1Guns3", "p1Plating1", "p1Plating2"]],
  ] as const)("gun level %i and hull %i draw %j, bottom to top", (guns, hull, layers) => {
    expect(ship(guns, hull).sprites).toEqual(layers);
  });

  it("has the armour outline only at hull 1 (thin) and 2 (bold)", () => {
    expect(ship(3, 0).outline).toBeUndefined();
    expect(ship(3, 1).outline).toBe(1);
    expect(ship(1, 2).outline).toBe(2);
    expect(ship(3, 0).outlineKey).toBe(6);
    expect(ship(1, 2).outlineKey).toBe(2);
  });

  it("reuses one frozen layer list per level pair, so choosing layers allocates nothing", () => {
    expect(ship(2, 1).sprites).toBe(ship(2, 1).sprites);
    expect(Object.isFrozen(ship(3, 2).sprites)).toBe(true);
  });

  it("the ship id is an option that defaults to p1", () => {
    expect(ship(3, 2, { ship: "p1" })).toEqual(ship(3, 2));
  });

  it.each([
    ["p2", ["p2Base", "p2Guns2", "p2Guns3", "p2Plating1", "p2Plating2"]],
    ["p3", ["p3Base", "p3Guns2", "p3Guns3", "p3Plating1", "p3Plating2"]],
  ] as const)("#3600: ship %s emits its own five layers at gun 3 and hull 2", (id, layers) => {
    expect(ship(3, 2, { ship: id }).sprites).toEqual(layers);
    expect(ship(1, 0, { ship: id }).sprites).toEqual([layers[0]]);
  });

  it("#3600: the outline slot is per ship, so no ship draws another's glow", () => {
    expect(ship(1, 2, { ship: "p1" }).outlineKey).toBe(2);
    expect(ship(1, 2, { ship: "p2" }).outlineKey).toBe(11);
    expect(ship(1, 2, { ship: "p3" }).outlineKey).toBe(20);
  });

  it("#3600: every ship is drawn into the same box, so the hitbox art matches", () => {
    const box = (id: ShipId) => {
      const { x, y, w, h } = ship(3, 2, { ship: id });
      return { x, y, w, h };
    };
    expect(box("p2")).toEqual(box("p1"));
    expect(box("p3")).toEqual(box("p1"));
  });

  it("#3600: the fallback waits for the chosen ship's own base layer", () => {
    const p1Only: LoadedSprites = { ...NONE, p1Base: true };
    const p3Only: LoadedSprites = { ...NONE, p3Base: true };
    const kind = (loaded: LoadedSprites, id: ShipId) =>
      byKey(buildFrame(blank(), { ...OPTS, loaded, ship: id }), "player")?.k;
    expect(kind(p1Only, "p3")).toBe("poly");
    expect(kind(p3Only, "p3")).toBe("ship");
    expect(kind(p3Only, "p1")).toBe("poly");
  });

  it("draws the fallback until the base layer has loaded, whatever the other layers do", () => {
    const onlyGuns: LoadedSprites = { ...NONE, p1Guns2: true };
    expect(byKey(buildFrame(blank(), { ...OPTS, loaded: onlyGuns }), "player")?.k).toBe("poly");
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
      // the sprite is the 34 px box plus its transparent margin (#3592)
      x: 100 - BUDDY_SIZE / 2 - SHIP_SPRITE_PAD,
      w: BUDDY_SIZE + 2 * SHIP_SPRITE_PAD,
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

  it("asteroids: fallback while the art loads — basalt outline, then a light rim; the hit flash is the burst (#3596)", () => {
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
    expect(body).toMatchObject({ k: "poly", color: opaque(ASTEROID_RGB) });
    expect(body && body.k === "poly" && body.points.length).toBe(18); // 9 vertices
    expect(byKey(ops, "rock-10-edge")).toMatchObject({
      color: opaque(ASTEROID_EDGE_RGB),
      stroke: 1.5,
    });
    expect(byKey(ops, "rock-10-flash")).toBeUndefined();
    const flashing = buildFrame(
      blank({ asteroids: [{ ...rock, hitFlashTimer: 50 }] }),
      OPTS_NO_ASTEROID_SPRITES
    );
    // the body keeps its colour; the shared burst flashes over it instead
    expect(byKey(flashing, "rock-10")).toMatchObject({ color: opaque(ASTEROID_RGB) });
    expect(byKey(flashing, "rock-10-flash-ring")).toMatchObject({ k: "circle", stroke: 2 });
    // outline vertices are rounded to 0.1 px, as the path always was
    const pts = body && body.k === "poly" ? body.points : [];
    expect(pts.length).toBe(18);
    expect(pts.every((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9)).toBe(true);
  });

  it("asteroids: the tinted rock art, the box plus its margin, centred, rotated by `rotation`; veins on large rocks only (#3596)", () => {
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
    const m = ROCK_SPRITE_PAD;
    const rect = { x: 80 - 22 - m, y: 80 - 22 - m, w: 44 + 2 * m, h: 44 + 2 * m };
    expect(body).toMatchObject({ k: "image", ...rect, fit: "fill", rotate: 0.75 });
    const sprite = body && body.k === "image" ? body.sprite : undefined;
    expect(ROCK_BODIES.large as readonly string[]).toContain(sprite);
    expect([0, 1, 2]).toContain(body && body.k === "image" ? body.tint : undefined);
    // the veins: the same rect and spin, untinted, right over the body
    const veins = byKey(ops, "rock-10-veins");
    expect(veins).toMatchObject({ k: "image", ...rect, rotate: 0.75 });
    expect(veins && veins.k === "image" && veins.sprite).toBe(
      ROCK_VEINS[sprite as keyof typeof ROCK_VEINS]
    );
    expect(veins && veins.k === "image" && veins.tint).toBeUndefined();
    const k = keys(ops);
    expect(k.indexOf("rock-10-veins")).toBe(k.indexOf("rock-10") + 1);
    expect(byKey(ops, "rock-10-edge")).toBeUndefined();
    // a small rock: a small shape at its own size, and no ore
    const small = { ...rock, kind: "small" as const, radius: 12 };
    const smallOps = buildFrame(blank({ asteroids: [small] }), OPTS);
    const smallBody = byKey(smallOps, "rock-10");
    expect(smallBody).toMatchObject({ w: 24 + 2 * m, h: 24 + 2 * m });
    expect(ROCK_BODIES.small as readonly string[]).toContain(
      smallBody && smallBody.k === "image" ? smallBody.sprite : undefined
    );
    expect(byKey(smallOps, "rock-10-veins")).toBeUndefined();
  });

  it("asteroids: the hit flash is the shared burst (white-hot core, orange ring, sparks) on the rock's clock (#3596)", () => {
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
    const ring = byKey(ops, "rock-10-flash-ring");
    expect(ring).toMatchObject({ k: "circle", cx: 80, cy: 80, stroke: 2 });
    // normalized against ASTEROID_HIT_FLASH_MS (120), not the ships' HIT_FLASH_DURATION (250) —
    // a rock's flash timer never reaches 250, so the wrong constant would under-scale every value
    expect(ring).toMatchObject({ r: expect.closeTo(47.08, 2) });
    expect(ring && ring.k === "circle" && ring.color).toBe(withAlpha(HIT_RING_RGB, 0.313));
    const core = byKey(ops, "rock-10-flash");
    expect(core).toMatchObject({ k: "circle", cx: 80, cy: 80 });
    expect(core && core.k === "circle" && core.stroke).toBeUndefined();
    expect(core && core.k === "circle" && core.color & 0xffffff).toBe(HIT_CORE_RGB);
    expect(keys(ops).filter((x) => x.startsWith("rock-10-flash-spark-"))).toHaveLength(4);
    // drawn over the rock and its veins
    const k = keys(ops);
    expect(k.indexOf("rock-10-flash")).toBeGreaterThan(k.indexOf("rock-10-veins"));
    // fresh off a hit (timer === ASTEROID_HIT_FLASH_MS) the ring starts at full intensity, exactly
    // like a ship's fresh flash does at HIT_FLASH_DURATION
    const fresh = byKey(
      buildFrame(blank({ asteroids: [{ ...rock, hitFlashTimer: ASTEROID_HIT_FLASH_MS }] }), OPTS),
      "rock-10-flash-ring"
    );
    expect(fresh && fresh.k === "circle" && fresh.color).toBe(withAlpha(HIT_RING_RGB, 0.75));
    const calm = buildFrame(blank({ asteroids: [{ ...rock, hitFlashTimer: 0 }] }), OPTS);
    expect(keys(calm).some((x) => x.startsWith("rock-10-flash"))).toBe(false);
  });

  it("asteroids: the shape and palette picks are stable per id and use every shape and palette (#3596)", () => {
    const rockAt = (id: number, kind: "large" | "small") => ({
      id,
      kind,
      x: 80,
      y: 80,
      vx: 0,
      vy: 0,
      radius: kind === "large" ? 22 : 12,
      hp: 6,
      rotation: 0,
      spin: 0,
      hitFlashTimer: 0,
      hitEnemyIds: [],
    });
    const pick = (id: number, kind: "large" | "small") => {
      const op = byKey(buildFrame(blank({ asteroids: [rockAt(id, kind)] }), OPTS), `rock-${id}`);
      return op && op.k === "image" ? [op.sprite, op.tint] : undefined;
    };
    // deterministic: the same rock id always picks the same shape and palette
    expect(pick(10, "large")).toEqual(pick(10, "large"));
    for (const kind of ["large", "small"] as const) {
      const picks = Array.from({ length: 60 }, (_, i) => pick(i + 1, kind)!);
      expect(new Set(picks.map((p) => p[0]))).toEqual(new Set(ROCK_BODIES[kind]));
      expect(new Set(picks.map((p) => p[1]))).toEqual(new Set([0, 1, 2]));
    }
  });

  it("#3597: explosions are code-drawn shared ops, never an image, sprites loaded or not", () => {
    const ex = { id: 1, x: 100, y: 100, frame: 10, frameTimer: 14, kind: "blast" as const };
    const s = blank({ explosions: [ex] });
    for (const loaded of [ALL, NONE]) {
      const ops = buildFrame(s, { ...OPTS, loaded });
      const exOps = ops.filter((o) => o.key?.startsWith("ex-1"));
      expect(exOps).toEqual(explosionOps(ex));
      expect(exOps.length).toBeGreaterThan(0);
      expect(exOps.some((o) => o.k === "image")).toBe(false);
    }
  });

  it("#3597: worst-case op count while a Smart Bomb clears a full wave and 10 rocks", () => {
    // 30 kills (15 Grunt pops, 14 Elite / Guardian bursts, the Carrier's blast) and 10 rock breaks,
    // all caught in the 20-35% window where the core, ring, smoke and debris all show at once
    // (pop 7 ops, burst 14, blast 23, rock 18 = 504), plus the flash early on (tint, two rings,
    // core = 4) and the player. Measured 509; the ceiling leaves ~5% headroom so a later effect
    // tweak that doubles the cost is caught.
    const WORST_CASE_CEILING = 535;
    const kinds = [
      ...Array<ExplosionKind>(15).fill("pop"),
      ...Array<ExplosionKind>(14).fill("burst"),
      "blast" as const,
      ...Array<ExplosionKind>(10).fill("rock"),
    ];
    const s = blank({
      explosions: kinds.map((kind, i) => ({
        id: i + 1,
        x: 20 + (i % 10) * 30,
        y: 80 + Math.floor(i / 10) * 60,
        frame: 5,
        frameTimer: EXPLOSION_FRAME_MS,
        ...(kind === "pop" ? {} : { kind }),
      })),
      bombFlashTimer: 240,
    });
    const ops = buildFrame(s, OPTS);
    expect(ops.length).toBe(509);
    expect(ops.length).toBeLessThanOrEqual(WORST_CASE_CEILING);
  });

  it("#3597: the bomb flash is the last thing drawn, over the rocks and the explosions", () => {
    const s = blank({
      bombFlashTimer: 250,
      explosions: [{ id: 2, x: 40, y: 40, frame: 3, frameTimer: 10 }],
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
    });
    const ops = buildFrame(s, { ...OPTS, width: 300, height: 500 });
    const flash = bombFlashOps(s, 300, 500);
    expect(flash.length).toBeGreaterThan(0);
    expect(ops.slice(-flash.length)).toEqual(flash);
    const k = keys(ops);
    expect(k.indexOf("rock-7")).toBeLessThan(k.indexOf("ex-2-ring"));
    expect(k.indexOf("ex-2-ring")).toBeLessThan(k.indexOf("bomb-flash"));
    expect(byKey(buildFrame(blank(), OPTS), "bomb-flash")).toBeUndefined();
  });
});

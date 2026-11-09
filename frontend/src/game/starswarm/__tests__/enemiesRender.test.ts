/**
 * #3593: the hive's look (`render/enemies.ts`), shared by native (`buildFrame`) and web
 * (`drawEnemyOps`): sprite choice by tier, HP and phase, the bank toward the direction of travel,
 * the code-drawn damage effects, the restyled hit flash, flinch and fallbacks, and no HP pips.
 */
import { CANVAS_H, CANVAS_W, FLINCH_MS, HIT_FLASH_DURATION, initStarSwarm } from "../engine";
import { carrierOps } from "../render/carrier";
import { TIER_SIZE, TIER_HP } from "../engine/tuning";
import { carrierArmoredIn, carrierStageIn } from "../engine/roster";
import { alphaOf, withAlpha } from "../render/color";
import { flinchWobble } from "../render/flinch";
import {
  BANK_EASE_PX,
  BANK_MAX_RAD,
  CORE_FLICKER_MS,
  drawEnemyOps,
  ENEMY_SPRITE_PAD,
  ENEMY_SPRITES,
  eliteCoreLit,
  enemyBank,
  enemyLayers,
  enemyOps,
  hitFlash,
  type EnemySpriteKey,
} from "../render/enemies";
import { buildFrame, type DrawOp, type LoadedSprites } from "../render/frame";
import { setDebugOpKeys } from "../render/opKeys";
import {
  ENEMY_FALLBACK,
  HEAT_RGB,
  HIT_CORE_RGB,
  HIT_RING_RGB,
  HIVE_SHIELD_RGB,
  HIT_SPARK_RGB,
  SHELL_EDGE_RGB,
} from "../render/palette";
import type { CubicBezier, Enemy, StarSwarmState } from "../types";

beforeAll(() => setDebugOpKeys(true));
afterAll(() => setDebugOpKeys(false));

const ALL_ENEMY = Object.fromEntries(ENEMY_SPRITES.map((k) => [k, true])) as Record<
  EnemySpriteKey,
  boolean
>;
const NO_ENEMY = Object.fromEntries(ENEMY_SPRITES.map((k) => [k, false])) as Record<
  EnemySpriteKey,
  boolean
>;

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
    ...over,
  };
}

/** A live enemy of `tier` in formation at (200, 150), full HP, at its real size. */
function enemyOf(tier: Enemy["tier"], over: Partial<Enemy> = {}): Enemy {
  const template = [1, 5]
    .flatMap((wave) => initStarSwarm(CANVAS_W, CANVAS_H, wave, 42).enemies)
    .find((e) => e.tier === tier)!;
  return {
    ...template,
    phase: "Formation",
    path: null,
    pathT: 1,
    x: 200,
    y: 150,
    isAlive: true,
    hp: TIER_HP[tier],
    hitFlashTimer: 0,
    flinchMs: 0,
    ...over,
  };
}

function ops(enemies: Enemy[], o: { armored?: boolean; clock?: number; loaded?: boolean } = {}) {
  return enemyOps({
    enemies,
    carrierArmored: o.armored ?? false,
    clock: o.clock ?? 0,
    loaded: o.loaded === false ? NO_ENEMY : ALL_ENEMY,
  });
}
const byKey = (list: DrawOp[], key: string) => list.find((o) => o.key === key);
const images = (list: DrawOp[]) =>
  list.filter((o): o is Extract<DrawOp, { k: "image" }> => o.k === "image").map((o) => o.sprite);

/** A straight path from `a` to `b`, the enemy placed `t` of the way along it. */
function onLine(
  tier: Enemy["tier"],
  phase: Enemy["phase"],
  a: [number, number],
  b: [number, number],
  t: number
): Enemy {
  const lerp = (k: number) => ({ x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k });
  const path: CubicBezier = { p0: lerp(0), p1: lerp(1 / 3), p2: lerp(2 / 3), p3: lerp(1) };
  const at = lerp(t);
  return enemyOf(tier, { phase, path, pathT: t, x: at.x, y: at.y });
}

describe("sprite choice by tier, HP and phase", () => {
  it("Grunt: the Wasp, whatever it is doing", () => {
    expect(enemyLayers(enemyOf("Grunt"), true)).toEqual(["enemyGrunt"]);
    expect(enemyLayers(enemyOf("Grunt", { phase: "Diving" }), true)).toEqual(["enemyGrunt"]);
  });

  it("Elite: the Mantis in formation, the attack pose while diving or circling", () => {
    expect(enemyLayers(enemyOf("Elite"), true)).toEqual(["enemyElite"]);
    for (const phase of ["SwoopIn", "Wiggling", "Returning"] as const) {
      expect(enemyLayers(enemyOf("Elite", { phase }), true)).toEqual(["enemyElite"]);
    }
    for (const phase of ["Diving", "Circling"] as const) {
      expect(enemyLayers(enemyOf("Elite", { phase }), true)).toEqual(["enemyEliteAttack"]);
    }
  });

  it("Elite at 1 HP: the snapped-scythe sprite, which wins over the attack pose", () => {
    expect(enemyLayers(enemyOf("Elite", { hp: 1 }), true)).toEqual(["enemyEliteHurt"]);
    expect(enemyLayers(enemyOf("Elite", { hp: 1, phase: "Diving" }), true)).toEqual([
      "enemyEliteHurt",
    ]);
  });

  it("Guardian: base at 4 HP, then the plate, cracks and second plate layer over it", () => {
    const at = (hp: number) => enemyLayers(enemyOf("Guardian", { hp }), true);
    expect(at(4)).toEqual(["enemyGuardian"]);
    expect(at(3)).toEqual(["enemyGuardian", "enemyGuardianPlate"]);
    expect(at(2)).toEqual(["enemyGuardian", "enemyGuardianPlate", "enemyGuardianCracks"]);
    expect(at(1)).toEqual([
      "enemyGuardian",
      "enemyGuardianPlate",
      "enemyGuardianCracks",
      "enemyGuardianPlate2",
    ]);
  });

  it("Carrier: the Queen while armoured, plus its crack layer once exposed", () => {
    expect(enemyLayers(enemyOf("Carrier"), true)).toEqual(["enemyCarrier"]);
    expect(enemyLayers(enemyOf("Carrier"), false)).toEqual(["enemyCarrier", "enemyCarrierCracks"]);
  });

  it("buildFrame draws the layers in order, each the box plus the margin, centred", () => {
    const g = enemyOf("Guardian", { id: 3, hp: 2 });
    const list = buildFrame(blank({ enemies: [g] }), { loaded: loadedAll(), width: 1, height: 1 });
    expect(images(list)).toEqual(["enemyGuardian", "enemyGuardianPlate", "enemyGuardianCracks"]);
    const m = ENEMY_SPRITE_PAD;
    for (const op of list.filter((o) => o.k === "image")) {
      expect(op).toMatchObject({
        x: g.x - g.width / 2 - m,
        y: g.y - g.height / 2 - m,
        w: g.width + 2 * m,
        h: g.height + 2 * m,
        fit: "fill",
      });
    }
    expect(byKey(list, "en-3")).toMatchObject({ sprite: "enemyGuardian" });
    expect(byKey(list, "en-3-enemyGuardianPlate")).toBeDefined();
  });

  it("buildFrame shows the Carrier's cracks once the last Guardian is gone", () => {
    const carrier = enemyOf("Carrier", { id: 1 });
    const opts = { loaded: loadedAll(), width: 1, height: 1 };
    const escorted = buildFrame(
      blank({ enemies: [carrier, enemyOf("Guardian", { id: 2 })] }),
      opts
    );
    expect(byKey(escorted, "en-1-enemyCarrierCracks")).toBeUndefined();
    const exposed = buildFrame(blank({ enemies: [carrier] }), opts);
    expect(byKey(exposed, "en-1-enemyCarrierCracks")).toMatchObject({ k: "image" });
  });

  it("a damage layer that has not loaded is skipped while the base and the rest still draw", () => {
    const list = enemyOps({
      enemies: [enemyOf("Guardian", { id: 2, hp: 2 })],
      carrierArmored: true,
      clock: 0,
      loaded: { ...ALL_ENEMY, enemyGuardianPlate: false },
    });
    expect(images(list)).toEqual(["enemyGuardian", "enemyGuardianCracks"]);
    expect(byKey(list, "en-2")).toMatchObject({ sprite: "enemyGuardian" });
  });

  it("a look whose sprite has not loaded draws the tier's base; a missing layer is skipped", () => {
    const only = { ...NO_ENEMY, enemyElite: true, enemyGuardian: true };
    const list = enemyOps({
      enemies: [enemyOf("Elite", { id: 1, hp: 1 }), enemyOf("Guardian", { id: 2, hp: 1 })],
      carrierArmored: true,
      clock: 0,
      loaded: only,
    });
    expect(images(list)).toEqual(["enemyElite", "enemyGuardian"]);
  });
});

/** Every sprite loaded (native `LoadedSprites`). */
function loadedAll(): LoadedSprites {
  const keys = [
    "p1Base",
    "p1Guns2",
    "p1Guns3",
    "p1Plating1",
    "p1Plating2",
    "p2Base",
    "p2Guns2",
    "p2Guns3",
    "p2Plating1",
    "p2Plating2",
    "p3Base",
    "p3Guns2",
    "p3Guns3",
    "p3Plating1",
    "p3Plating2",
    "buddyShip",
    ...ENEMY_SPRITES,
    "bulletPlayer",
    "puShield",
    "puBomb",
    "puBuddy",
    "puLightning",
    "asteroid1",
    "asteroid2",
    "asteroid3",
    "asteroid4",
  ];
  return {
    ...Object.fromEntries(keys.map((k) => [k, true])),
  } as unknown as LoadedSprites;
}

describe("banking (visual only)", () => {
  const rotateOf = (e: Enemy) => (ops([e])[0] as Extract<DrawOp, { k: "image" }>).rotate;

  it("faces down (no rotation) in formation, wiggling, or waiting out a swoop's stagger", () => {
    expect(enemyBank(enemyOf("Grunt"))).toBe(0);
    expect(enemyBank(enemyOf("Grunt", { phase: "Wiggling" }))).toBe(0);
    const waiting = onLine("Grunt", "SwoopIn", [0, 0], [300, 0], 0.5);
    expect(enemyBank({ ...waiting, pathT: -0.2 })).toBe(0);
    expect(rotateOf(enemyOf("Grunt"))).toBeUndefined();
  });

  it("mid-path, the sprite leans into its sideways motion, at most BANK_MAX_RAD", () => {
    expect(BANK_MAX_RAD).toBeCloseTo((35 * Math.PI) / 180);
    // straight down or straight up: no lean (it keeps facing down, never flips)
    expect(enemyBank(onLine("Grunt", "Diving", [100, 0], [100, 400], 0.5))).toBeCloseTo(0);
    expect(enemyBank(onLine("Grunt", "Fleeing", [100, 400], [100, 0], 0.5))).toBeCloseTo(0);
    // moving right: the full lean clockwise-negative; moving left: the mirror
    expect(enemyBank(onLine("Grunt", "Diving", [0, 100], [400, 100], 0.5))).toBeCloseTo(
      -BANK_MAX_RAD
    );
    expect(enemyBank(onLine("Grunt", "Diving", [400, 100], [0, 100], 0.5))).toBeCloseTo(
      BANK_MAX_RAD
    );
    // diagonal: the sideways share of the motion (sin of the angle from vertical)
    expect(enemyBank(onLine("Grunt", "Diving", [0, 0], [300, 400], 0.5))).toBeCloseTo(
      -BANK_MAX_RAD * 0.6
    );
    expect(enemyBank(onLine("Grunt", "Returning", [300, 400], [0, 0], 0.5))).toBeCloseTo(
      BANK_MAX_RAD * 0.6
    );
    // every path phase leans, the Carrier's attack run too
    for (const phase of ["SwoopIn", "Returning", "Fleeing"] as const) {
      expect(enemyBank(onLine("Elite", phase, [0, 100], [400, 100], 0.5))).toBeCloseTo(
        -BANK_MAX_RAD
      );
    }
    expect(enemyBank(onLine("Carrier", "AttackRun", [0, 100], [400, 100], 0.5))).toBeCloseTo(
      -BANK_MAX_RAD
    );
  });

  it("no lean ever exceeds BANK_MAX_RAD, on any path phase or round a whole loop", () => {
    const phases = ["SwoopIn", "Diving", "Returning", "Fleeing", "AttackRun"] as const;
    const curve: CubicBezier = {
      p0: { x: 50, y: 60 },
      p1: { x: 380, y: 300 },
      p2: { x: -100, y: 500 },
      p3: { x: 200, y: 40 },
    };
    const at = (t: number) => {
      const u = 1 - t;
      const f = (a: number, b: number, c: number, d: number) =>
        u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
      return {
        x: f(curve.p0.x, curve.p1.x, curve.p2.x, curve.p3.x),
        y: f(curve.p0.y, curve.p1.y, curve.p2.y, curve.p3.y),
      };
    };
    for (const phase of phases) {
      for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        const e = enemyOf("Elite", { phase, path: curve, pathT: t, ...at(t) });
        expect(Math.abs(enemyBank(e))).toBeLessThanOrEqual(BANK_MAX_RAD + 1e-9);
      }
    }
    for (const speed of [0.003, -0.003]) {
      for (let i = 0; i <= 720; i++) {
        const circleAngle = Math.PI / 2 + (i / 720) * 2 * Math.PI * Math.sign(speed);
        const e = enemyOf("Guardian", { phase: "Circling", circleAngle, circleSpeed: speed });
        expect(Math.abs(enemyBank(e))).toBeLessThanOrEqual(BANK_MAX_RAD + 1e-9);
      }
    }
  });

  it("the lean is continuous round a whole Circling loop (no flip, no snap)", () => {
    const N = 720;
    const lean = (i: number) =>
      enemyBank(
        enemyOf("Guardian", {
          phase: "Circling",
          circleAngle: Math.PI / 2 + (i / N) * 2 * Math.PI,
          circleSpeed: 0.003,
        })
      );
    let maxStep = 0;
    let maxLean = 0;
    for (let i = 1; i <= N; i++) {
      maxStep = Math.max(maxStep, Math.abs(lean(i) - lean(i - 1)));
      maxLean = Math.max(maxLean, Math.abs(lean(i)));
    }
    // one sample is half a degree of loop; the lean never jumps more than a couple of degrees
    expect(maxStep).toBeLessThan(0.03);
    expect(maxLean).toBeGreaterThan(BANK_MAX_RAD * 0.9); // it does lean, fully at the sides
    expect(lean(0)).toBe(0);
    expect(lean(N)).toBeCloseTo(0);
  });

  it("a rotated sprite turns about its own centre: the op carries the angle, not a new rect", () => {
    const e = onLine("Grunt", "Diving", [0, 100], [400, 100], 0.5);
    const op = ops([e])[0] as Extract<DrawOp, { k: "image" }>;
    expect(op.rotate).toBeCloseTo(-BANK_MAX_RAD);
    expect(op.x + op.w / 2).toBeCloseTo(e.x);
    expect(op.y + op.h / 2).toBeCloseTo(e.y);
  });

  it("eases in leaving the slot and out arriving, so it never snaps on the frame it settles", () => {
    const len = 400;
    const near = BANK_EASE_PX / 2 / len; // half the ease distance from an end
    const leaving = enemyBank(onLine("Grunt", "Diving", [0, 100], [len, 100], near));
    const arriving = enemyBank(onLine("Grunt", "Returning", [0, 100], [len, 100], 1 - near));
    expect(leaving).toBeCloseTo(-BANK_MAX_RAD / 2);
    expect(arriving).toBeCloseTo(-BANK_MAX_RAD / 2);
    expect(enemyBank(onLine("Grunt", "Returning", [0, 100], [len, 100], 1))).toBeCloseTo(0);
  });

  it("circling ships lean into their loop's sideways motion, easing in and out at its ends", () => {
    const circling = (circleAngle: number, circleSpeed = 0.003) =>
      enemyOf("Guardian", { phase: "Circling", circleAngle, circleSpeed });
    // angle pi: moving straight up (clockwise speed), so no lean
    expect(enemyBank(circling(Math.PI))).toBeCloseTo(0);
    // angle 3pi/2: moving (−sin, cos) = (1, 0), right: the full lean
    expect(enemyBank(circling(1.5 * Math.PI))).toBeCloseTo(-BANK_MAX_RAD);
    // the reversed loop there moves left: the mirror lean
    expect(enemyBank(circling(1.5 * Math.PI, -0.003))).toBeCloseTo(BANK_MAX_RAD);
    // at the start and end of the loop it faces down
    expect(enemyBank(circling(Math.PI / 2))).toBe(0);
    expect(enemyBank(circling(Math.PI / 2 + 2 * Math.PI))).toBeCloseTo(0);
  });

  it("the flinch tilt adds on top of the bank", () => {
    const e = onLine("Grunt", "Diving", [0, 100], [400, 100], 0.5);
    const flinchMs = Array.from({ length: 40 }, (_, i) => (FLINCH_MS * (i + 1)) / 41).find(
      (ms) => Math.abs(flinchWobble(ms).rotate) > 0.01
    )!;
    const wobble = flinchWobble(flinchMs);
    expect(rotateOf({ ...e, flinchMs })).toBeCloseTo(-BANK_MAX_RAD + wobble.rotate);
    expect(rotateOf({ ...enemyOf("Grunt"), flinchMs })).toBeCloseTo(wobble.rotate);
  });

  it("is visual only: building ops never changes the enemy, and the tier sizes are unchanged", () => {
    const e = onLine("Elite", "Diving", [0, 100], [400, 100], 0.5);
    const before = JSON.stringify(e);
    ops([{ ...e, hp: 1, hitFlashTimer: 50, flinchMs: 100 }]);
    ops([e]);
    expect(JSON.stringify(e)).toBe(before);
    expect(TIER_SIZE).toEqual({
      Grunt: { w: 24, h: 24 },
      Elite: { w: 28, h: 28 },
      Guardian: { w: 36, h: 32 },
      Carrier: { w: 54, h: 48 },
    });
    expect(TIER_HP).toEqual({ Grunt: 1, Elite: 2, Guardian: 4, Carrier: 8 });
    for (const tier of ["Grunt", "Elite", "Guardian", "Carrier"] as const) {
      const live = enemyOf(tier);
      expect([live.width, live.height]).toEqual([TIER_SIZE[tier].w, TIER_SIZE[tier].h]);
    }
  });
});

describe("code-drawn damage effects", () => {
  it("the Elite at 1 HP flickers its core: two frames, on then off", () => {
    const e = enemyOf("Elite", { id: 4, hp: 1 });
    const litClock = [0, 40, 80, 120].find((c) => eliteCoreLit(c, e.id))!;
    const darkClock = [0, 40, 80, 120].find((c) => !eliteCoreLit(c, e.id))!;
    expect(eliteCoreLit(litClock + 2 * CORE_FLICKER_MS, e.id)).toBe(true);
    const lit = ops([e], { clock: litClock });
    expect(byKey(lit, "en-4-core")).toMatchObject({ k: "circle", r: e.width * 0.09 });
    expect(byKey(lit, "en-4-core-hot")).toMatchObject({ k: "circle" });
    // the core sits on the centre line above the middle of the box
    expect(byKey(lit, "en-4-core")).toMatchObject({ cx: e.x, cy: e.y - 0.08 * e.height });
    expect(byKey(ops([e], { clock: darkClock }), "en-4-core")).toBeUndefined();
    // at 2 HP there is no flicker
    expect(byKey(ops([{ ...e, hp: 2 }], { clock: litClock }), "en-4-core")).toBeUndefined();
  });

  it("the flickering core turns with the bank", () => {
    const e = { ...onLine("Elite", "Diving", [0, 100], [400, 100], 0.5), id: 4, hp: 1 };
    const clock = [0, 80].find((c) => eliteCoreLit(c, e.id))!;
    const core = byKey(ops([e], { clock }), "en-4-core") as Extract<DrawOp, { k: "circle" }>;
    // leaning by -BANK_MAX_RAD: the offset (0, -d) turns to (-d sin B, -d cos B)
    const d = 0.08 * e.height;
    expect(core.cx).toBeCloseTo(e.x - d * Math.sin(BANK_MAX_RAD));
    expect(core.cy).toBeCloseTo(e.y - d * Math.cos(BANK_MAX_RAD));
  });

  it("the Guardian smokes at 1 HP only, two puffs that fade", () => {
    const g = enemyOf("Guardian", { id: 6, hp: 1 });
    const list = ops([g], { clock: 300 });
    const smoke = list.filter((o) => o.key?.startsWith("en-6-smoke-"));
    expect(smoke).toHaveLength(2);
    for (const s of smoke) expect(s).toMatchObject({ k: "circle" });
    for (const hp of [2, 3, 4]) {
      expect(ops([{ ...g, hp }]).some((o) => o.key?.includes("smoke"))).toBe(false);
    }
  });

  it("a smoke puff grows and fades as time runs on (the clock counts down)", () => {
    const g = enemyOf("Guardian", { id: 6, hp: 1 });
    const puff = (clock: number) =>
      byKey(ops([g], { clock }), "en-6-smoke-0") as Extract<DrawOp, { k: "circle" }>;
    // pick a clock mid-puff, so 100 ms later (nextDiveTimer 100 less) is still the same puff
    const clock = Array.from({ length: 90 }, (_, i) => 1000 + i * 10).find(
      (c) => puff(c - 100).r > puff(c).r && puff(c - 200).r > puff(c - 100).r
    )!;
    const now = puff(clock);
    const later = puff(clock - 100);
    expect(later.r).toBeGreaterThan(now.r);
    expect(alphaOf(later.color)).toBeLessThan(alphaOf(now.color));
    // and it drifts back, away from the ship's front (up the screen when it faces down)
    expect(later.cy).toBeLessThan(now.cy);
  });

  it("draws no HP pips: an enemy is its sprites and effects only, no rects", () => {
    const list = ops(
      [enemyOf("Elite", { id: 1 }), enemyOf("Guardian", { id: 2, hp: 2 }), enemyOf("Carrier")],
      { armored: true }
    );
    expect(list.some((o) => o.k === "rect")).toBe(false);
  });
});

describe("restyled hit flash, flinch and fallbacks", () => {
  it("the hit flash: a white-hot core, a hot ring and four sparks, on the old timing", () => {
    const e = enemyOf("Elite", { id: 5, hitFlashTimer: HIT_FLASH_DURATION / 2 });
    const list = ops([e]);
    const f = hitFlash(e.width, e.height, e.hitFlashTimer);
    expect(byKey(list, "en-5-flash")).toMatchObject({
      k: "circle",
      cx: e.x,
      cy: e.y,
      r: f.r * 0.6,
      color: withAlpha(HIT_CORE_RGB, f.fillAlpha * 1.6),
    });
    expect(byKey(list, "en-5-flash-ring")).toMatchObject({
      r: f.r,
      color: withAlpha(HIT_RING_RGB, f.strokeAlpha),
      stroke: 2,
    });
    const sparks = list.filter((o) => o.key?.startsWith("en-5-flash-spark-"));
    expect(sparks).toHaveLength(4);
    for (const s of sparks) {
      expect(s).toMatchObject({ k: "poly", color: withAlpha(HIT_SPARK_RGB, f.strokeAlpha) });
    }
    expect(ops([{ ...e, hitFlashTimer: 0 }]).some((o) => o.key?.includes("flash"))).toBe(false);
  });

  it("the flinch draws two rim-light ticks that fade out with it", () => {
    const e = enemyOf("Grunt", { id: 7, flinchMs: FLINCH_MS });
    const full = byKey(ops([e]), "en-7-flinch-l") as Extract<DrawOp, { k: "poly" }>;
    expect(full.color).toBe(withAlpha(SHELL_EDGE_RGB, 0.7));
    expect(byKey(ops([e]), "en-7-flinch-r")).toBeDefined();
    const half = byKey(ops([{ ...e, flinchMs: FLINCH_MS / 2 }]), "en-7-flinch-r");
    expect(half).toMatchObject({ color: withAlpha(SHELL_EDGE_RGB, 0.35) });
    expect(ops([{ ...e, flinchMs: 0 }]).some((o) => o.key?.includes("flinch"))).toBe(false);
  });

  it("fallbacks: one distinct shape per tier, in the shell's light violet, inside the box", () => {
    const tiers = ["Grunt", "Elite", "Guardian", "Carrier"] as const;
    const shapes = tiers.map((tier, i) => {
      const e = enemyOf(tier, { id: i + 1 });
      // a lone Carrier is in its final stand, so its heat glow is drawn first (#3625): find the body
      const op = ops([e], { loaded: false }).find((o) => o.key === `en-${i + 1}`) as Extract<
        DrawOp,
        { k: "poly" }
      >;
      expect(op).toMatchObject({ k: "poly", key: `en-${i + 1}`, color: ENEMY_FALLBACK });
      expect(op.stroke).toBeUndefined();
      for (let p = 0; p < op.points.length; p += 2) {
        expect(Math.abs(op.points[p]! - e.x)).toBeLessThanOrEqual(e.width / 2 + 1e-9);
        expect(Math.abs(op.points[p + 1]! - e.y)).toBeLessThanOrEqual(e.height / 2 + 1e-9);
      }
      return op.points.length / 2;
    });
    expect(new Set(shapes).size).toBe(4); // a different vertex count per tier
  });

  it("a fallback banks with its enemy", () => {
    const e = onLine("Grunt", "Diving", [0, 100], [400, 100], 0.5);
    const op = ops([e], { loaded: false })[0] as Extract<DrawOp, { k: "poly" }>;
    // the dart's tip (0, 0.5h below the centre) leans toward the travel, by BANK_MAX_RAD
    const tip = [op.points[4]!, op.points[5]!];
    expect(tip[0]).toBeCloseTo(e.x + 0.5 * e.height * Math.sin(BANK_MAX_RAD));
    expect(tip[1]).toBeCloseTo(e.y + 0.5 * e.height * Math.cos(BANK_MAX_RAD));
  });

  it("armoured Carrier: a hive-shield bubble (fill, rim, hex hints) over its sprite, before a flash, and no old ring", () => {
    const c = enemyOf("Carrier", { id: 9, hitFlashTimer: 100 });
    const list = ops([c], { armored: true });
    const keys = list.map((o) => o.key);
    expect(keys.slice(0, 2)).toEqual(["en-9", "en-9-bubble"]);
    expect(keys[keys.length - 1]).toMatch(/^en-9-flash/);
    expect(keys).not.toContain("en-9-ring");
    const r = Math.max(c.width, c.height) * 0.68;
    expect(byKey(list, "en-9-bubble")).toMatchObject({ k: "circle", cx: c.x, cy: c.y, r });
    const rim = byKey(list, "en-9-bubble-rim") as Extract<DrawOp, { k: "circle" }>;
    expect(rim).toMatchObject({ r, stroke: 1.5 });
    expect(rim.color & 0xffffff).toBe(HIVE_SHIELD_RGB);
    expect(keys.filter((k) => k?.startsWith("en-9-bubble-hex-"))).toHaveLength(6);
    expect(keys.some((k) => k?.includes("heat"))).toBe(false);
  });

  it("exposed Carrier: no bubble, no links, no heat (its crack layer is the look)", () => {
    const c = enemyOf("Carrier", { id: 9 });
    const g = enemyOf("Grunt", { id: 3 });
    const keys = ops([c, g], { armored: false }).map((o) => o.key);
    expect(keys.filter((k) => /bubble|link|heat/.test(k ?? ""))).toEqual([]);
  });

  it("final stand: a red glow under the sprite and a heat tint over it, only when alone", () => {
    const c = enemyOf("Carrier", { id: 9 });
    const keys = ops([c], { armored: false }).map((o) => o.key);
    expect(keys).toEqual([
      "en-9-heat-glow",
      "en-9-heat-glow-core",
      "en-9",
      "en-9-enemyCarrierCracks",
      "en-9-heat-tint",
    ]);
    const list = ops([c], { armored: false });
    for (const k of ["en-9-heat-glow", "en-9-heat-glow-core", "en-9-heat-tint"]) {
      expect((byKey(list, k) as Extract<DrawOp, { k: "circle" }>).color & 0xffffff).toBe(HEAT_RGB);
    }
    // a fleeing grunt does not hold it out of its final stand; a fighting one does
    const fleeing = enemyOf("Grunt", { id: 3, phase: "Fleeing" });
    expect(ops([c, fleeing]).some((o) => o.key === "en-9-heat-tint")).toBe(true);
    expect(ops([c, enemyOf("Grunt", { id: 3 })]).some((o) => o.key === "en-9-heat-tint")).toBe(
      false
    );
    // heat is the Carrier's only: nothing for other tiers
    expect(ops([enemyOf("Guardian", { id: 4 })]).some((o) => /heat/.test(o.key ?? ""))).toBe(false);
  });

  it("shield links: one per LIVING Guardian while armoured, none otherwise, ending on the bubble's rim", () => {
    const c = enemyOf("Carrier", { id: 1, x: 200, y: 60 });
    const gs = [
      enemyOf("Guardian", { id: 2, x: 100, y: 120 }),
      enemyOf("Guardian", { id: 3, x: 300, y: 120 }),
      enemyOf("Guardian", { id: 4, x: 150, y: 120, isAlive: false }),
    ];
    const list = ops([c, ...gs], { armored: true });
    const links = list.filter((o) => /^en-1-link-\d+$/.test(o.key ?? ""));
    expect(links.map((o) => o.key)).toEqual(["en-1-link-2", "en-1-link-3"]);
    expect(list.filter((o) => /link-\d+-core$/.test(o.key ?? ""))).toHaveLength(2);
    expect(list.filter((o) => /link-\d+-pulse$/.test(o.key ?? ""))).toHaveLength(2);
    // under the ships: links come before every sprite
    expect(list.findIndex((o) => o.key === "en-1-link-2")).toBeLessThan(
      list.findIndex((o) => o.key === "en-1")
    );
    // the far end is on the bubble's rim, the near end on the Guardian
    const r = Math.max(c.width, c.height) * 0.68;
    const pts = (links[0] as Extract<DrawOp, { k: "poly" }>).points;
    const endX = (pts[2]! + pts[4]!) / 2;
    const endY = (pts[3]! + pts[5]!) / 2;
    expect(Math.hypot(endX - c.x, endY - c.y)).toBeCloseTo(r, 5);
    // no living Guardian → no armour → no links
    expect(ops([c], { armored: true }).some((o) => /link/.test(o.key ?? ""))).toBe(false);
    expect(ops([c, ...gs], { armored: false }).some((o) => /link/.test(o.key ?? ""))).toBe(false);
  });

  it("links show only in formation and fade as a Guardian leaves its slot (#3625)", () => {
    const c = enemyOf("Carrier", { id: 1, x: 200, y: 60 });
    const slot = { formationX: 100, formationY: 120 };
    const g = (over: Partial<Enemy>) => enemyOf("Guardian", { id: 2, ...slot, ...over });
    const link = (e: Enemy) => {
      const list = ops([c, e], { armored: true });
      return {
        n: list.filter((o) => /^en-1-link-/.test(o.key ?? "")).length,
        glow: byKey(list, "en-1-link-2") as Extract<DrawOp, { k: "poly" }> | undefined,
      };
    };
    const at = (phase: Enemy["phase"], x: number, y: number) => link(g({ phase, x, y }));
    const full = at("Formation", 100, 120);
    expect(full.n).toBe(3);
    expect(alphaOf(full.glow!.color)).toBeCloseTo(0.25);
    expect(alphaOf(at("Wiggling", 100, 120).glow!.color)).toBeCloseTo(0.25);
    // a diver far from its slot, and a swoop-in off-screen: no link ops at all
    expect(at("Diving", 100, 400).n).toBe(0);
    expect(at("SwoopIn", 100, -60).n).toBe(0);
    // partway out: weaker than at the slot, and fading in again on the way back
    const half = at("Returning", 100, 140);
    expect(alphaOf(half.glow!.color)).toBeCloseTo(0.25 * 0.5);
    expect(alphaOf(half.glow!.color)).toBeLessThan(alphaOf(full.glow!.color));
    expect(alphaOf(at("Returning", 100, 130).glow!.color)).toBeGreaterThan(
      alphaOf(half.glow!.color)
    );
    // never more links than living Guardians
    const four = [2, 3, 4, 5].map((id) => enemyOf("Guardian", { id, x: 80 + id * 20, y: 120 }));
    const n = ops([c, ...four], { armored: true }).filter((o) =>
      /^en-1-link-\d+$/.test(o.key ?? "")
    ).length;
    expect(n).toBeLessThanOrEqual(4);
  });

  it("no links while the Carrier itself is away from its slot, fading in as it settles (#3650)", () => {
    const slot = { formationX: 200, formationY: 60 };
    const guardian = enemyOf("Guardian", {
      id: 2,
      phase: "Formation",
      x: 100,
      y: 120,
      formationX: 100,
      formationY: 120,
    });
    const glowAlpha = (carrier: Enemy) => {
      const list = ops([carrier, guardian], { armored: true });
      const glow = byKey(list, "en-1-link-2") as Extract<DrawOp, { k: "poly" }> | undefined;
      return glow ? alphaOf(glow.color) : 0;
    };
    const carrier = (over: Partial<Enemy>) => enemyOf("Carrier", { id: 1, ...slot, ...over });
    // still swooping in, far above its slot: the settled Guardian draws no link
    const swooping = carrier({ phase: "SwoopIn", x: 60, y: -40 });
    expect(
      ops([swooping, guardian], { armored: true }).filter((o) => /-link-/.test(o.key ?? ""))
    ).toHaveLength(0);
    // halfway through the fade: half strength; at its slot: full
    expect(glowAlpha(carrier({ phase: "SwoopIn", x: 200, y: 40 }))).toBeCloseTo(0.25 * 0.5);
    expect(glowAlpha(carrier({ phase: "Formation", x: 200, y: 60 }))).toBeCloseTo(0.25);
    // away on an attack run: no links either
    expect(glowAlpha(carrier({ phase: "AttackRun", x: 200, y: 300 }))).toBe(0);
  });

  it("a Wiggling Guardian far from its slot keeps a full link; a faint one is skipped", () => {
    const c = enemyOf("Carrier", { id: 1, x: 200, y: 60 });
    const far = enemyOf("Guardian", {
      id: 2,
      phase: "Wiggling",
      x: 100,
      y: 120,
      formationX: 100,
      formationY: 200,
    });
    const glow = byKey(ops([c, far], { armored: true }), "en-1-link-2") as Extract<
      DrawOp,
      { k: "poly" }
    >;
    expect(alphaOf(glow.color)).toBeCloseTo(0.25);
    // 39.9 px out: strength 0.0025, below the floor, no link
    const faint = enemyOf("Guardian", {
      id: 3,
      phase: "Returning",
      x: 100,
      y: 159.9,
      formationX: 100,
      formationY: 120,
    });
    expect(byKey(ops([c, faint], { armored: true }), "en-1-link-3")).toBeUndefined();
  });

  it("the final stand derived in enemyOps matches carrierStageIn over several rosters", () => {
    const c = enemyOf("Carrier", { id: 1 });
    const rosters: Enemy[][] = [
      [c],
      [c, enemyOf("Grunt", { id: 2 })],
      [c, enemyOf("Grunt", { id: 2, phase: "Fleeing" })],
      [c, enemyOf("Grunt", { id: 2, isAlive: false })],
      [c, enemyOf("Guardian", { id: 2 })],
      [c, enemyOf("Guardian", { id: 2, isAlive: false })],
      [c, enemyOf("Elite", { id: 2 }), enemyOf("Grunt", { id: 3, phase: "Fleeing" })],
      [enemyOf("Grunt", { id: 2 })],
    ];
    for (const r of rosters) {
      const armored = carrierArmoredIn(r);
      const heat = ops(r, { armored }).some((o) => o.key === "en-1-heat-tint");
      expect(heat).toBe(carrierStageIn(r) === "finalStand");
    }
  });

  it("the bubble's hex hints sit at the direct formula's angles, drifting with the clock", () => {
    const c = enemyOf("Carrier", { id: 4, x: 150, y: 80 });
    const clock = 777;
    const t = ((((clock + c.id * 53) % 2400) + 2400) % 2400) / 2400;
    const r = Math.max(c.width, c.height) * 0.68;
    const list = ops([c], { armored: true, clock });
    for (let k = 0; k < 6; k++) {
      const a = t * 2 * Math.PI + (k * 2 * Math.PI) / 6;
      const a0 = a - 0.17;
      const a1 = a + 0.17;
      const want = [
        [a0, r - 1.5],
        [a1, r - 1.5],
        [a1, r + 0.5],
        [a0, r + 0.5],
      ].flatMap(([an, rad]) => [c.x + Math.cos(an!) * rad!, c.y + Math.sin(an!) * rad!]);
      const got = (byKey(list, `en-4-bubble-hex-${k}`) as Extract<DrawOp, { k: "poly" }>).points;
      expect(got).toHaveLength(8);
      got.forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 6));
    }
  });

  it("the bay cue sits on the sprite's bay: 0.86 of the box down, 0.24 wide, at any position", () => {
    for (const [x, y] of [
      [200, 150],
      [57, 311],
    ] as const) {
      const c = enemyOf("Carrier", { id: 1, x, y });
      const s = blank({ carrierBayOpen: 200, enemies: [c] });
      const list = carrierOps(s);
      const bayY = y - c.height / 2 + 0.86 * c.height;
      const glow = list.find((o) => o.key === "carrier-bay-glow") as Extract<
        DrawOp,
        { k: "circle" }
      >;
      const hatch = list.find((o) => o.key === "carrier-bay-hatch") as Extract<
        DrawOp,
        { k: "rect" }
      >;
      expect(glow.cx).toBeCloseTo(x);
      expect(glow.cy).toBeCloseTo(bayY);
      expect(hatch.w).toBeCloseTo(0.24 * c.width);
      expect(hatch.x + hatch.w / 2).toBeCloseTo(x);
      expect(hatch.y + hatch.h / 2).toBeCloseTo(bayY);
    }
  });

  it("the bubble and links shimmer on the effect clock but never mutate state", () => {
    const c = enemyOf("Carrier", { id: 1 });
    const g = enemyOf("Guardian", { id: 2, x: 100, y: 120 });
    const before = JSON.stringify([c, g]);
    const a = ops([c, g], { armored: true, clock: 0 });
    const b = ops([c, g], { armored: true, clock: 700 });
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
    expect(a.map((o) => o.key)).toEqual(b.map((o) => o.key));
    expect(JSON.stringify([c, g])).toBe(before);
  });
});

describe("drawEnemyOps (web replay)", () => {
  function ctxRecorder() {
    const calls: { fn: string; args: unknown[] }[] = [];
    const rec =
      (fn: string) =>
      (...args: unknown[]) =>
        calls.push({ fn, args });
    const ctx = {
      save: rec("save"),
      restore: rec("restore"),
      translate: rec("translate"),
      rotate: rec("rotate"),
      drawImage: rec("drawImage"),
    } as unknown as CanvasRenderingContext2D;
    return { calls, ctx };
  }
  const imgs = Object.fromEntries(
    ENEMY_SPRITES.map((k) => [k, { id: k } as unknown as CanvasImageSource])
  ) as Record<EnemySpriteKey, CanvasImageSource>;

  it("draws an unturned sprite straight into its rect", () => {
    const { calls, ctx } = ctxRecorder();
    const shapes = jest.fn();
    drawEnemyOps(ctx, ops([enemyOf("Grunt")]), imgs, shapes);
    expect(calls).toEqual([
      { fn: "drawImage", args: [{ id: "enemyGrunt" }, 200 - 12 - 4, 150 - 12 - 4, 32, 32] },
    ]);
    expect(shapes).not.toHaveBeenCalled();
  });

  it("turns a banked sprite about its centre, as Skia's rotate(deg, px, py) does on native", () => {
    const e = onLine("Grunt", "Diving", [0, 100], [400, 100], 0.5);
    const { calls, ctx } = ctxRecorder();
    drawEnemyOps(ctx, ops([e]), imgs, jest.fn());
    expect(calls.map((c) => c.fn)).toEqual(["save", "translate", "rotate", "drawImage", "restore"]);
    expect(calls[1]!.args).toEqual([e.x, e.y]);
    expect(calls[2]!.args[0]).toBeCloseTo(-BANK_MAX_RAD);
    expect(calls[3]!.args).toEqual([{ id: "enemyGrunt" }, -16, -16, 32, 32]);
  });

  it("hands shapes (fallbacks, flashes, effects) to the shared shape replay, in order", () => {
    const { ctx } = ctxRecorder();
    const seen: DrawOp[] = [];
    // the replay reuses one scratch list, so read each op as it is handed over
    const shapes = jest.fn((_: CanvasRenderingContext2D, list: readonly DrawOp[]) => {
      expect(list).toHaveLength(1);
      seen.push(list[0]!);
    });
    const list = ops([enemyOf("Guardian", { id: 2, hp: 1, hitFlashTimer: 100 })], {
      loaded: false,
    });
    drawEnemyOps(ctx, list, imgs, shapes);
    expect(seen).toEqual(list);
  });

  it("skips a sprite whose image is missing", () => {
    const { calls, ctx } = ctxRecorder();
    drawEnemyOps(ctx, ops([enemyOf("Grunt")]), { ...imgs, enemyGrunt: null }, jest.fn());
    expect(calls).toEqual([]);
  });

  it("hands the Carrier's bubble, links and heat to the shared shape replay, in order (#3625)", () => {
    const c = enemyOf("Carrier", { id: 1 });
    const g = enemyOf("Guardian", { id: 2, x: 100, y: 120 });
    const { ctx } = ctxRecorder();
    const seen: (string | undefined)[] = [];
    const shapes = jest.fn((_c: unknown, list: readonly DrawOp[]) => seen.push(list[0]!.key));
    const armoured = ops([c, g], { armored: true });
    drawEnemyOps(ctx, armoured, imgs, shapes);
    // every non-image op reaches the replay, once, in the list's order (link, bubble, ...)
    expect(seen).toEqual(armoured.filter((o) => o.k !== "image").map((o) => o.key));
    expect(seen).toEqual(expect.arrayContaining(["en-1-link-2", "en-1-bubble", "en-1-bubble-rim"]));
    seen.length = 0;
    const final = ops([c], { armored: false });
    drawEnemyOps(ctx, final, imgs, shapes);
    expect(seen).toEqual(["en-1-heat-glow", "en-1-heat-glow-core", "en-1-heat-tint"]);
  });
});

/**
 * #3593: the hive's look (`render/enemies.ts`), shared by native (`buildFrame`) and web
 * (`drawEnemyOps`): sprite choice by tier, HP and phase, the bank toward the direction of travel,
 * the code-drawn damage effects, the restyled hit flash, flinch and fallbacks, and no HP pips.
 */
import { CANVAS_H, CANVAS_W, FLINCH_MS, HIT_FLASH_DURATION, initStarSwarm } from "../engine";
import { TIER_SIZE, TIER_HP } from "../engine/tuning";
import { withAlpha } from "../render/color";
import { flinchWobble } from "../render/flinch";
import {
  BANK_EASE_PX,
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
  HIT_CORE_RGB,
  HIT_RING_RGB,
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
const RING = withAlpha(0x00aaff, 0.45);

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
    armourRing: RING,
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

  it("a look whose sprite has not loaded draws the tier's base; a missing layer is skipped", () => {
    const only = { ...NO_ENEMY, enemyElite: true, enemyGuardian: true };
    const list = enemyOps({
      enemies: [enemyOf("Elite", { id: 1, hp: 1 }), enemyOf("Guardian", { id: 2, hp: 1 })],
      carrierArmored: true,
      clock: 0,
      loaded: only,
      armourRing: RING,
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
    explosion: Array.from({ length: 20 }, () => true),
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

  it("mid-path, the sprite faces its direction of travel", () => {
    // straight down: no turn; to the right: a quarter turn clockwise; up: a half turn
    expect(enemyBank(onLine("Grunt", "Diving", [100, 0], [100, 400], 0.5))).toBeCloseTo(0);
    expect(enemyBank(onLine("Grunt", "Diving", [0, 100], [400, 100], 0.5))).toBeCloseTo(
      -Math.PI / 2
    );
    expect(enemyBank(onLine("Grunt", "Diving", [400, 100], [0, 100], 0.5))).toBeCloseTo(
      Math.PI / 2
    );
    expect(Math.abs(enemyBank(onLine("Grunt", "Fleeing", [100, 400], [100, 0], 0.5)))).toBeCloseTo(
      Math.PI
    );
    // every path phase banks, the Carrier's attack run too
    for (const phase of ["SwoopIn", "Returning", "Fleeing"] as const) {
      expect(enemyBank(onLine("Elite", phase, [0, 100], [400, 100], 0.5))).toBeCloseTo(
        -Math.PI / 2
      );
    }
    expect(enemyBank(onLine("Carrier", "AttackRun", [0, 100], [400, 100], 0.5))).toBeCloseTo(
      -Math.PI / 2
    );
  });

  it("a rotated sprite turns about its own centre: the op carries the angle, not a new rect", () => {
    const e = onLine("Grunt", "Diving", [0, 100], [400, 100], 0.5);
    const op = ops([e])[0] as Extract<DrawOp, { k: "image" }>;
    expect(op.rotate).toBeCloseTo(-Math.PI / 2);
    expect(op.x + op.w / 2).toBeCloseTo(e.x);
    expect(op.y + op.h / 2).toBeCloseTo(e.y);
  });

  it("eases in leaving the slot and out arriving, so it never snaps on the frame it settles", () => {
    const len = 400;
    const near = BANK_EASE_PX / 2 / len; // half the ease distance from an end
    const leaving = enemyBank(onLine("Grunt", "Diving", [0, 100], [len, 100], near));
    const arriving = enemyBank(onLine("Grunt", "Returning", [0, 100], [len, 100], 1 - near));
    expect(leaving).toBeCloseTo(-Math.PI / 4);
    expect(arriving).toBeCloseTo(-Math.PI / 4);
    expect(enemyBank(onLine("Grunt", "Returning", [0, 100], [len, 100], 1))).toBeCloseTo(0);
  });

  it("circling ships face along their loop, easing in and out at its ends", () => {
    const circling = (circleAngle: number, circleSpeed = 0.003) =>
      enemyOf("Guardian", { phase: "Circling", circleAngle, circleSpeed });
    // a quarter of the way round (angle pi): moving up (clockwise speed), so it faces up
    expect(Math.abs(enemyBank(circling(Math.PI)))).toBeCloseTo(Math.PI);
    // at angle 2pi it moves down-screen... (−sin 2π, cos 2π) = (0, 1): faces down
    expect(enemyBank(circling(2 * Math.PI))).toBeCloseTo(0);
    // reversed loop at angle pi: moves down
    expect(enemyBank(circling(Math.PI, -0.003))).toBeCloseTo(0);
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
    expect(rotateOf({ ...e, flinchMs })).toBeCloseTo(-Math.PI / 2 + wobble.rotate);
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
    // turned a quarter clockwise (-pi/2): the offset (0, -dy) becomes (-dy, 0)
    expect(core.cx).toBeCloseTo(e.x - 0.08 * e.height);
    expect(core.cy).toBeCloseTo(e.y);
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
      const op = ops([e], { loaded: false })[0] as Extract<DrawOp, { k: "poly" }>;
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
    // the dart's tip (0, 0.5h below the centre) now points right, along the travel
    const tip = [op.points[4]!, op.points[5]!];
    expect(tip[0]).toBeCloseTo(e.x + 0.5 * e.height);
    expect(tip[1]).toBeCloseTo(e.y);
  });

  it("the Carrier keeps its armour ring while escorted, after its sprite and before a flash", () => {
    const c = enemyOf("Carrier", { id: 9, hitFlashTimer: 100 });
    const keys = ops([c], { armored: true }).map((o) => o.key);
    expect(keys.slice(0, 3)).toEqual(["en-9", "en-9-ring", "en-9-flash"]);
    expect(byKey(ops([c], { armored: true }), "en-9-ring")).toMatchObject({
      color: RING,
      stroke: 2,
    });
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
    expect(calls[2]!.args[0]).toBeCloseTo(-Math.PI / 2);
    expect(calls[3]!.args).toEqual([{ id: "enemyGrunt" }, -16, -16, 32, 32]);
  });

  it("hands shapes (fallbacks, flashes, effects) to the shared shape replay, in order", () => {
    const { ctx } = ctxRecorder();
    const shapes = jest.fn();
    const list = ops([enemyOf("Guardian", { id: 2, hp: 1, hitFlashTimer: 100 })], {
      loaded: false,
    });
    drawEnemyOps(ctx, list, imgs, shapes);
    expect(shapes.mock.calls.map((c) => (c[1] as DrawOp[])[0])).toEqual(list);
  });

  it("skips a sprite whose image is missing", () => {
    const { calls, ctx } = ctxRecorder();
    drawEnemyOps(ctx, ops([enemyOf("Grunt")]), { ...imgs, enemyGrunt: null }, jest.fn());
    expect(calls).toEqual([]);
  });
});

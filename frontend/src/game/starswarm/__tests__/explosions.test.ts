/**
 * #3597: explosions, the Smart Bomb flash and the nebula, code-drawn. The explosion and flash ops
 * are shared by both canvases (`render/explosions.ts`); the explosion's size is its `kind`, set
 * where it spawns; the nebula is baked once with the background (`render/nebula.ts`).
 */
import {
  applyPowerUp,
  BOMB_FLASH_DURATION,
  EXPLOSION_FRAMES,
  EXPLOSION_FRAME_MS,
  initStarSwarm,
  tick,
} from "../engine";
import { enemyExplosion, explosionKindOf, rockExplosion, spawnExplosion } from "../engine/entities";
import { settleRocks } from "../engine/asteroids";
import { _resetIds } from "../engine/rng";
import { alphaOf } from "../render/color";
import {
  bombFlashOps,
  effectOps,
  explosionOps,
  explosionProgress,
  explosionStyle,
  EXPLOSION_STYLE,
} from "../render/explosions";
import type { DrawOp } from "../render/frame";
import { buildWebBackdrop, nebulaBlobs } from "../render/nebula";
import { setDebugOpKeys } from "../render/opKeys";
import { rockPalette } from "../render/rockTint";
import * as palette from "../render/palette";
import { SAVE_FINGERPRINT, fitsSaveShape } from "../saveShape";
import type { Asteroid, Explosion, ExplosionKind, StarSwarmState } from "../types";

beforeAll(() => setDebugOpKeys(true));
afterAll(() => setDebugOpKeys(false));

const LIFE = EXPLOSION_FRAMES * EXPLOSION_FRAME_MS;

/** An explosion `t` (0-1) through its life, as the engine's frame clock would hold it. */
function at(t: number, kind?: ExplosionKind, id = 7): Explosion {
  const into = t * LIFE;
  const frame = Math.floor(into / EXPLOSION_FRAME_MS);
  const frameTimer = EXPLOSION_FRAME_MS - (into - frame * EXPLOSION_FRAME_MS);
  return { id, x: 100, y: 200, frame, frameTimer, ...(kind ? { kind } : {}) };
}

const part = (ops: DrawOp[], name: string) =>
  ops.filter((o) => o.key !== undefined && new RegExp(`^ex-\\d+-${name}(-\\d+)?$`).test(o.key));
const radius = (op: DrawOp | undefined) => (op && op.k === "circle" ? op.r : NaN);

describe("explosionProgress", () => {
  it("runs from 0 at spawn toward 1 as the engine retires it, smoothly between frames", () => {
    expect(explosionProgress(spawnExplosion(0, 0, 1))).toBe(0);
    expect(
      explosionProgress({ id: 1, x: 0, y: 0, frame: 10, frameTimer: EXPLOSION_FRAME_MS })
    ).toBe(0.5);
    expect(
      explosionProgress({ id: 1, x: 0, y: 0, frame: 10, frameTimer: EXPLOSION_FRAME_MS / 2 })
    ).toBeCloseTo(0.525);
    // the last frame's last moment is just short of 1
    expect(
      explosionProgress({ id: 1, x: 0, y: 0, frame: EXPLOSION_FRAMES - 1, frameTimer: 1 })
    ).toBeLessThan(1);
  });
});

describe("explosionOps by size and life stage", () => {
  it("sizes each kind as approved: pop r 14, burst r 22, blast r 40, rock r 20", () => {
    expect(EXPLOSION_STYLE.pop).toMatchObject({ r: 14, debris: 0 });
    expect(EXPLOSION_STYLE.burst).toMatchObject({ r: 22, debris: 6 });
    expect(EXPLOSION_STYLE.blast).toMatchObject({ r: 40, debris: 14 });
    expect(EXPLOSION_STYLE.rock).toMatchObject({ r: 20, debris: 10 });
    // no kind (a Grunt, or an older save) and an unknown one (another build's) draw as a pop
    expect(explosionStyle(at(0.1))).toBe(EXPLOSION_STYLE.pop);
    expect(explosionStyle({ ...at(0.1), kind: "nova" as ExplosionKind })).toBe(EXPLOSION_STYLE.pop);
    // a saved kind that names an Object.prototype member is not a style either
    for (const kind of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const ex = { ...at(0.5), kind: kind as ExplosionKind };
      expect(explosionStyle(ex)).toBe(EXPLOSION_STYLE.pop);
      const ops = explosionOps(ex);
      expect(ops).toEqual(explosionOps(at(0.5)).map((o) => ({ ...o })));
      expect(ops.every((o) => Object.values(o).every((v) => !Number.isNaN(v)))).toBe(true);
    }
  });

  it.each(["pop", "burst", "blast", "rock"] as const)(
    "%s: hot core early, ring throughout, smoke from 20%%, debris on the bigger ones",
    (kind) => {
      const s = EXPLOSION_STYLE[kind];
      for (const t of [0.1, 0.3, 0.55, 0.8]) {
        const ops = explosionOps(at(t, kind));
        expect(part(ops, "core")).toHaveLength(t < 0.35 ? 1 : 0);
        expect(part(ops, "core-hot")).toHaveLength(t < 0.35 ? 1 : 0);
        expect(part(ops, "ring-glow")).toHaveLength(1);
        expect(part(ops, "ring")).toHaveLength(1);
        expect(part(ops, "smoke")).toHaveLength(t >= 0.2 ? s.smoke : 0);
        expect(part(ops, "debris")).toHaveLength(s.debris);
        expect(ops).toHaveLength((t < 0.35 ? 2 : 0) + 2 + (t >= 0.2 ? s.smoke : 0) + s.debris);
        // never an image: no sprite to load, nothing to fall back from
        expect(ops.every((o) => o.k === "circle" || o.k === "line")).toBe(true);
      }
    }
  );

  it("the ring grows from 30% to 110% of the radius and fades as it goes", () => {
    const ring = (t: number) => part(explosionOps(at(t, "burst")), "ring")[0]!;
    expect(radius(ring(0))).toBeCloseTo(22 * 0.3 * 0.86);
    expect(radius(ring(0.5))).toBeCloseTo(22 * 0.7 * 0.86);
    expect(radius(ring(0.8))).toBeGreaterThan(radius(ring(0.5)));
    expect(alphaOf(ring(0.8).color)).toBeLessThan(alphaOf(ring(0.1).color));
  });

  it("bigger kinds are bigger at the same age", () => {
    const r = (k: ExplosionKind) => radius(part(explosionOps(at(0.5, k)), "ring")[0]);
    expect(r("pop")).toBeLessThan(r("rock"));
    expect(r("rock")).toBeLessThan(r("burst"));
    expect(r("burst")).toBeLessThan(r("blast"));
  });

  it("fire is the flash family; a rock breaks in its own dust colours", () => {
    const rgb = (o: DrawOp) => ("color" in o ? o.color & 0xffffff : -1);
    const fire = part(explosionOps(at(0.1, "blast")), "ring")[0]!;
    const core = part(explosionOps(at(0.1, "blast")), "core")[0]!;
    expect(rgb(fire)).toBe(palette.PLASMA_GLOW_RGB);
    expect(rgb(core)).toBe(palette.PLASMA_CORE_RGB);
    expect(rgb(part(explosionOps(at(0.1, "rock")), "ring")[0]!)).toBe(palette.ROCK_DUST_RGB);
    expect(rgb(part(explosionOps(at(0.1, "rock")), "core")[0]!)).toBe(palette.ROCK_DUST_HOT_RGB);
    expect(rgb(part(explosionOps(at(0.5, "pop")), "smoke")[0]!)).toBe(palette.EXPLOSION_SMOKE_RGB);
    expect(rgb(part(explosionOps(at(0.5, "burst")), "debris")[0]!)).toBe(
      palette.EXPLOSION_SPARK_RGB
    );
  });

  it("puffs and ticks keep their angles for the explosion's life (hashed from its id)", () => {
    const angle = (t: number) => {
      const o = part(explosionOps(at(t, "burst", 42)), "debris")[0]!;
      return o.k === "line" ? Math.atan2(o.y0 - 200, o.x0 - 100) : NaN;
    };
    expect(angle(0.3)).toBeCloseTo(angle(0.7));
    const other = part(explosionOps(at(0.3, "burst", 43)), "debris")[0]!;
    expect(other).not.toEqual(part(explosionOps(at(0.3, "burst", 42)), "debris")[0]);
  });

  it("draws nothing once its life is over, or without a usable clock", () => {
    expect(explosionOps({ id: 1, x: 0, y: 0, frame: EXPLOSION_FRAMES, frameTimer: 28 })).toEqual(
      []
    );
    expect(explosionOps({ id: 1 } as unknown as Explosion)).toEqual([]);
  });

  it("appends to the list it is given", () => {
    const ops: DrawOp[] = [{ k: "fill", color: 0 }];
    expect(explosionOps(at(0.5), ops)).toBe(ops);
    expect(ops.length).toBeGreaterThan(1);
  });
});

describe("bombFlashOps", () => {
  const W = 360;
  const H = 640;
  const base = initStarSwarm(W, H, 1, 42);
  const flashing = (timer: number): StarSwarmState => ({
    ...base,
    bombFlashTimer: timer,
    player: { ...base.player, x: 100, y: 560 },
  });
  const keysOf = (ops: DrawOp[]) => ops.map((o) => o.key);

  it("draws nothing without a flash", () => {
    expect(bombFlashOps(flashing(0), W, H)).toEqual([]);
  });

  it("is a warm tint, the shockwave's glow and band, and the white-hot core, in that order", () => {
    const ops = bombFlashOps(flashing(BOMB_FLASH_DURATION * 0.9), W, H);
    expect(keysOf(ops)).toEqual(["bomb-flash", "bomb-wave-glow", "bomb-wave", "bomb-core"]);
    expect(ops[0]).toMatchObject({ k: "rect", x: 0, y: 0, w: W, h: H });
    expect(ops[0]!.k === "rect" && ops[0]!.color & 0xffffff).toBe(palette.BOMB_TINT_RGB);
    // the tint is warm, not the old plain white
    expect(palette.BOMB_TINT_RGB).not.toBe(palette.WHITE_RGB);
    // the ring is centred on the ship
    expect(ops[1]).toMatchObject({ k: "circle", cx: 100, cy: 560 });
  });

  it("the ring sweeps out to the farthest corner while the tint fades; the core is early only", () => {
    const early = bombFlashOps(flashing(BOMB_FLASH_DURATION * 0.8), W, H);
    const late = bombFlashOps(flashing(1), W, H);
    const wave = (ops: DrawOp[]) => ops.find((o) => o.key === "bomb-wave");
    expect(radius(wave(late))).toBeGreaterThan(radius(wave(early)));
    expect(radius(wave(late))).toBeCloseTo(Math.hypot(W - 100, 560), 0);
    expect(alphaOf(late[0]!.k === "rect" ? late[0]!.color : 0)).toBeLessThan(
      alphaOf(early[0]!.k === "rect" ? early[0]!.color : 0)
    );
    expect(keysOf(late)).not.toContain("bomb-core");
  });

  it("at detonation the ring has not left the ship yet, so only the tint and core show", () => {
    expect(keysOf(bombFlashOps(flashing(BOMB_FLASH_DURATION), W, H))).toEqual([
      "bomb-flash",
      "bomb-core",
    ]);
  });
});

describe("effectOps", () => {
  it("is every explosion in turn, then the bomb flash over them", () => {
    const s0 = initStarSwarm(360, 640, 1, 42);
    const a = at(0.3, "burst", 1);
    const b = at(0.6, "rock", 2);
    const s = { ...s0, explosions: [a, b], bombFlashTimer: 200 };
    expect(effectOps(s, 360, 640)).toEqual([
      ...explosionOps(a),
      ...explosionOps(b),
      ...bombFlashOps(s, 360, 640),
    ]);
  });
});

describe("the explosion's kind, set where it spawns", () => {
  beforeEach(() => _resetIds());

  it("by tier: a Grunt pops, an Elite or Guardian bursts, the Carrier blasts", () => {
    expect(explosionKindOf("Grunt")).toBe("pop");
    expect(explosionKindOf("Elite")).toBe("burst");
    expect(explosionKindOf("Guardian")).toBe("burst");
    expect(explosionKindOf("Carrier")).toBe("blast");
    expect(enemyExplosion({ x: 1, y: 2, tier: "Carrier" })).toMatchObject({ kind: "blast" });
  });

  it("a pop carries no kind, so a Grunt's explosion is the object it always was", () => {
    expect(spawnExplosion(1, 2, 9)).toEqual({ id: 9, x: 1, y: 2, frame: 0, frameTimer: 28 });
    expect(enemyExplosion({ x: 1, y: 2, tier: "Grunt" })).not.toHaveProperty("kind");
    expect(spawnExplosion(1, 2, 9, "rock")).toMatchObject({ kind: "rock" });
  });

  it("a Smart Bomb breaks the rocks on screen as rock explosions", () => {
    const s0 = { ...initStarSwarm(360, 640, 1, 42), phase: "Playing" as const };
    const rock: Asteroid = {
      id: 900,
      kind: "large",
      x: 50,
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
    const s = applyPowerUp({ ...s0, asteroids: [rock] }, "bomb");
    const rocks = s.explosions.filter((e) => e.x === 50 && e.y === 300);
    expect(rocks).toHaveLength(1);
    expect(rocks[0]!.kind).toBe("rock");
    expect(s.bombFlashTimer).toBe(BOMB_FLASH_DURATION);
  });

  it("the kind never changes play: the explosion still lives its 20 frames", () => {
    const s0 = initStarSwarm(360, 640, 1, 42);
    let s: StarSwarmState = {
      ...s0,
      explosions: [spawnExplosion(10, 10, 1, "blast")],
    };
    for (let i = 0; i < EXPLOSION_FRAMES - 1; i++) {
      s = tick(s, EXPLOSION_FRAME_MS, { playerX: s.player.x, fire: false });
    }
    expect(s.explosions.some((e) => e.id === 1)).toBe(true);
    s = tick(s, EXPLOSION_FRAME_MS, { playerX: s.player.x, fire: false });
    expect(s.explosions.some((e) => e.id === 1)).toBe(false);
  });

  it("stays out of the save fingerprint; a save with or without it, or another build's, fits", () => {
    // the fingerprint's explosion spec is the five fields it always had, so no paused run is dropped
    expect(JSON.parse(SAVE_FINGERPRINT).EXPLOSION).toEqual({
      id: "required",
      x: "required",
      y: "required",
      frame: "required",
      frameTimer: "required",
    });
    const s = JSON.parse(JSON.stringify(initStarSwarm(360, 640, 1, 42))) as StarSwarmState;
    const withEx = (e: object) => ({ ...s, explosions: [e] });
    expect(fitsSaveShape(withEx(spawnExplosion(1, 2, 3)))).toBe(true);
    expect(fitsSaveShape(withEx(spawnExplosion(1, 2, 3, "blast")))).toBe(true);
    expect(fitsSaveShape(withEx({ ...spawnExplosion(1, 2, 3), kind: "nova" }))).toBe(true);
    expect(fitsSaveShape(withEx({ ...spawnExplosion(1, 2, 3), extra: 1 }))).toBe(false);
  });
});

describe("the nebula (N2 teal-violet)", () => {
  it("is a violet cloud high on the right and a teal one low on the left, subtle, in canvas fractions", () => {
    const blobs = nebulaBlobs(360, 640);
    const violet = blobs.filter((b) => b.rgb === palette.NEBULA_VIOLET_RGB);
    const teal = blobs.filter((b) => b.rgb === palette.NEBULA_TEAL_RGB);
    expect(violet.length + teal.length).toBe(blobs.length);
    for (const b of violet) expect(b.cy).toBeLessThan(320);
    for (const b of teal) expect(b.cy).toBeGreaterThan(320);
    expect(violet[0]!.cx).toBeGreaterThan(180);
    expect(teal[0]!.cx).toBeLessThan(180);
    for (const b of blobs) expect(b.alpha).toBeLessThanOrEqual(0.3);
    // scales with the canvas
    expect(nebulaBlobs(720, 1280)[0]).toMatchObject({ cx: blobs[0]!.cx * 2, r: blobs[0]!.r * 2 });
  });

  it("web: paints the fill and one radial gradient per blob into an offscreen canvas, once", () => {
    const calls: string[] = [];
    const gradients: unknown[][] = [];
    const ctx = {
      scale: (...a: number[]) => calls.push(`scale ${a.join(",")}`),
      fillRect: () => calls.push(`fillRect ${String(ctx.fillStyle)}`),
      createRadialGradient: () => {
        const stops: unknown[] = [];
        gradients.push(stops);
        return { tag: "g", addColorStop: (o: number, c: string) => stops.push([o, c]) };
      },
      fillStyle: "" as unknown,
    };
    const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
    const make = jest.fn(() => canvas);
    expect(buildWebBackdrop(360, 640, 2, "#000010", make)).toBe(canvas);
    expect(make).toHaveBeenCalledWith(720, 1280);
    expect(calls[0]).toBe("scale 2,2");
    expect(calls[1]).toBe("fillRect #000010");
    const blobs = nebulaBlobs(360, 640);
    expect(gradients).toHaveLength(blobs.length);
    expect(gradients[0]).toEqual([
      [0, `rgba(122,60,200,${blobs[0]!.alpha})`],
      [1, "rgba(122,60,200,0)"],
    ]);
  });

  it("web: no 2D context (or one without gradients) means no backdrop, so the plain fill is used", () => {
    expect(buildWebBackdrop(360, 640, 1, "#000010", () => null)).toBeNull();
    const bare = { getContext: () => ({ fillRect: () => {} }) } as unknown as HTMLCanvasElement;
    expect(buildWebBackdrop(360, 640, 1, "#000010", () => bare)).toBeNull();
  });
});

describe("palette (#3597)", () => {
  it("keeps the effect and background colours as approved", () => {
    expect(palette.EXPLOSION_HOT_RGB).toBe(0xfff2b0);
    expect(palette.EXPLOSION_FIRE_RGB).toBe(0xff8a3c);
    expect(palette.EXPLOSION_SMOKE_RGB).toBe(0x594d61);
    expect(palette.EXPLOSION_SPARK_RGB).toBe(0xffd980);
    expect(palette.ROCK_DUST_HOT_RGB).toBe(0xe8d3b8);
    expect(palette.ROCK_DUST_RGB).toBe(0x8b6a47);
    expect(palette.BOMB_TINT_RGB).toBe(0xfff2b0);
    expect(palette.NEBULA_VIOLET_RGB).toBe(0x7a3cc8);
    expect(palette.NEBULA_TEAL_RGB).toBe(0x1a7a9a);
    expect([palette.STAR_FAR_RGB, palette.STAR_MID_RGB, palette.STAR_NEAR_RGB]).toEqual([
      0xd8ccff, 0xc8f4ff, 0xf2f6ff,
    ]);
  });
});

describe("a rock's dust in its own palette (#3596)", () => {
  beforeEach(() => _resetIds());

  /** The first rock id (from 1) whose hash picks each palette. */
  const idFor = (p: number) => {
    for (let id = 1; ; id++) if (rockPalette(id) === p) return id;
  };
  const ringRgb = (ex: Explosion) => {
    const o = part(explosionOps(ex), "ring")[0];
    return o && "color" in o ? o.color & 0xffffff : -1;
  };
  const coreRgb = (ex: Explosion) => {
    const o = part(explosionOps(ex), "core")[0];
    return o && "color" in o ? o.color & 0xffffff : -1;
  };

  it.each([
    [0, "R1 basalt"],
    [1, "R2 rust iron"],
    [2, "R3 slate blue-grey"],
  ])("a rock tinted into palette %p (%s) breaks into that palette's dust", (p) => {
    const ex = { ...at(0.1, "rock"), srcId: idFor(p) };
    expect(ringRgb(ex)).toBe(palette.ROCK_DUST_PALETTES[p]!.ring);
    expect(coreRgb(ex)).toBe(palette.ROCK_DUST_PALETTES[p]!.hot);
    // the same size and debris as any rock break: only the colours change
    expect(explosionStyle(ex)).toMatchObject({ r: 20, debris: 10, smoke: 4 });
  });

  it("the dust pairs are each palette's light stop, with a core halfway to white", () => {
    const half = (rgb: number) =>
      [16, 8, 0].reduce((acc, sh) => {
        const c = (rgb >> sh) & 255;
        return acc | (Math.round((c + 255) / 2) << sh);
      }, 0);
    palette.ROCK_PALETTES.forEach((p, i) => {
      expect(palette.ROCK_DUST_PALETTES[i]).toEqual({ ring: p.light, hot: half(p.light) });
    });
  });

  it("without a usable srcId (an older save, another build's) it is the default brown", () => {
    const brown = { ring: palette.ROCK_DUST_RGB, hot: palette.ROCK_DUST_HOT_RGB };
    for (const ex of [
      at(0.1, "rock"),
      { ...at(0.1, "rock"), srcId: "12" as unknown as number },
      { ...at(0.1, "rock"), srcId: NaN },
    ]) {
      expect(ringRgb(ex)).toBe(brown.ring);
      expect(coreRgb(ex)).toBe(brown.hot);
    }
    // and a srcId on another kind changes nothing
    expect(explosionStyle({ ...at(0.1, "burst"), srcId: 5 })).toBe(EXPLOSION_STYLE.burst);
  });

  it("rockExplosion names the rock and takes exactly one id, like spawnExplosion", () => {
    const a = rockExplosion({ id: 900, x: 3, y: 4 });
    expect(a).toEqual({ id: 1, x: 3, y: 4, frame: 0, frameTimer: 28, kind: "rock", srcId: 900 });
    expect(spawnExplosion(0, 0).id).toBe(2);
  });

  const rockAt = (id: number, kind: Asteroid["kind"], extra: Partial<Asteroid> = {}): Asteroid => ({
    id,
    kind,
    x: 50,
    y: 300,
    vx: 0,
    vy: 0,
    radius: kind === "large" ? 22 : 12,
    hp: kind === "large" ? 6 : 2,
    rotation: 0,
    spin: 0,
    hitFlashTimer: 0,
    hitEnemyIds: [],
    ...extra,
  });

  it("a rock broken by a shot (split or not) leaves dust naming it, and ids are drawn in the same order", () => {
    const explosions: Explosion[] = [];
    const out = settleRocks(
      [rockAt(901, "large", { hp: 0 }), rockAt(902, "small", { hp: 0 })],
      explosions,
      [],
      640,
      0
    );
    expect(explosions.map((e) => [e.kind, e.srcId])).toEqual([
      ["rock", 901],
      ["rock", 902],
    ]);
    // the large rock's dust takes id 1, its two halves 2 and 3, then the small rock's dust 4
    expect(explosions.map((e) => e.id)).toEqual([1, 4]);
    expect(out.map((r) => r.id)).toEqual([2, 3]);
  });

  it("a Smart Bomb's rock dust names each rock", () => {
    const s0 = { ...initStarSwarm(360, 640, 1, 42), phase: "Playing" as const };
    const s = applyPowerUp({ ...s0, asteroids: [rockAt(903, "large")] }, "bomb");
    const dust = s.explosions.filter((e) => e.kind === "rock");
    expect(dust.map((e) => e.srcId)).toEqual([903]);
  });

  it("srcId stays out of the save fingerprint; a save with or without it fits", () => {
    expect(Object.keys(JSON.parse(SAVE_FINGERPRINT).EXPLOSION)).toEqual([
      "id",
      "x",
      "y",
      "frame",
      "frameTimer",
    ]);
    const s = JSON.parse(JSON.stringify(initStarSwarm(360, 640, 1, 42))) as StarSwarmState;
    const withEx = (e: object) => ({ ...s, explosions: [e] });
    expect(fitsSaveShape(withEx(rockExplosion({ id: 5, x: 1, y: 2 })))).toBe(true);
    expect(fitsSaveShape(withEx(spawnExplosion(1, 2, 3, "rock")))).toBe(true);
  });
});

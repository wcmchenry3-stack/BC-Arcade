/**
 * #3596: the asteroid art as shared display-list geometry (`render/asteroids.ts`) — which shape
 * and palette a rock draws, the ore veins on large rocks only, the fallback outline, the shared
 * hit flash, and the split crack read from engine state — plus the tint maths both renderers use
 * (`render/rockTint.ts`) and the web replay of the same ops.
 */
import {
  initStarSwarm,
  tick,
  seedRng,
  _resetIds,
  CANVAS_W,
  CANVAS_H,
  ASTEROID_STATS,
  ASTEROID_SPLIT_VX,
  EXPLOSION_FRAME_MS,
  EXPLOSION_FRAMES,
} from "../engine";
import {
  asteroidOps,
  rockBody,
  rockBodySlot,
  rockVeins,
  ROCK_BODIES,
  ROCK_BODY_LIST,
  ROCK_SPRITES,
  ROCK_SPRITE_PAD,
  type RockSpriteKey,
} from "../render/asteroids";
import {
  buildTintedRock,
  drawRockOps,
  prebuildRockTints,
  rockBodyBaked,
  rockPalette,
  rockTintMatrix,
  rockTintSlot,
  ROCK_PALETTE_COUNT,
  ROCK_TINT_MATRICES,
  type RockTintCache,
} from "../render/rockTint";
import { setDebugOpKeys } from "../render/opKeys";
import {
  effectOps,
  explosionProgress,
  splitCrackOps,
  splitHalves,
  SPLIT_CRACK_MS,
} from "../render/explosions";
import { buildFrame } from "../render/frame";
import { HIT_CORE_RGB, HIT_RING_RGB, ROCK_PALETTES } from "../render/palette";
import type { DrawOp } from "../render/frame";
import type { Asteroid, AsteroidKind, Bullet, Explosion, StarSwarmState } from "../types";
import { NO_INPUT, advanceMs } from "./helpers/engineFixtures";

beforeAll(() => setDebugOpKeys(true));
afterAll(() => setDebugOpKeys(false));
beforeEach(() => {
  seedRng(42);
  _resetIds();
});

const ALL_LOADED = Object.fromEntries(ROCK_SPRITES.map((k) => [k, true])) as Record<
  RockSpriteKey,
  boolean
>;
const NONE_LOADED = Object.fromEntries(ROCK_SPRITES.map((k) => [k, false])) as Record<
  RockSpriteKey,
  boolean
>;

function rock(id: number, kind: AsteroidKind, extra: Partial<Asteroid> = {}): Asteroid {
  return {
    id,
    kind,
    x: 100,
    y: 200,
    vx: 0,
    vy: 0,
    radius: ASTEROID_STATS[kind].radius,
    hp: ASTEROID_STATS[kind].hp,
    rotation: 0,
    spin: 0,
    hitFlashTimer: 0,
    hitEnemyIds: [],
    ...extra,
  };
}

const byKey = (ops: readonly DrawOp[], key: string) => ops.find((o) => o.key === key);
const keys = (ops: readonly DrawOp[]) => ops.map((o) => o.key ?? "");

describe("rock picks (#3596)", () => {
  it("a rock's shape follows its size, and both picks are stable per id", () => {
    for (let id = 1; id <= 50; id++) {
      expect(ROCK_BODIES.large as readonly string[]).toContain(rockBody(rock(id, "large")));
      expect(ROCK_BODIES.small as readonly string[]).toContain(rockBody(rock(id, "small")));
      expect(rockBody(rock(id, "large"))).toBe(rockBody(rock(id, "large")));
      expect(rockPalette(id)).toBe(rockPalette(id));
      expect(rockPalette(id)).toBeGreaterThanOrEqual(0);
      expect(rockPalette(id)).toBeLessThan(ROCK_PALETTE_COUNT);
    }
  });

  it("every shape and every palette turns up across ids, and the two picks are not locked together", () => {
    const pairs = new Set<string>();
    for (let id = 1; id <= 200; id++)
      pairs.add(`${rockBody(rock(id, "large"))}/${rockPalette(id)}`);
    // 2 large shapes x 3 palettes = 6 looks, all reachable
    expect(pairs.size).toBe(ROCK_BODIES.large.length * ROCK_PALETTE_COUNT);
  });

  it("only large shapes have a vein layer", () => {
    for (const b of ROCK_BODIES.large) expect(rockVeins(b)).toBeDefined();
    for (const b of ROCK_BODIES.small) expect(rockVeins(b)).toBeUndefined();
  });

  it("the image slots: 2 large and 2 small bodies, 2 vein layers", () => {
    expect(ROCK_SPRITES).toEqual([
      "rockLarge1",
      "rockLarge2",
      "rockSmall1",
      "rockSmall2",
      "rockLarge1Veins",
      "rockLarge2Veins",
    ]);
    expect(ROCK_BODY_LIST.map(rockBodySlot)).toEqual([0, 1, 2, 3]);
    expect(rockBodySlot("rockLarge1Veins")).toBe(-1);
  });
});

describe("asteroidOps (#3596)", () => {
  it("the art: the tinted body then the untinted veins, the hitbox box plus the margin, spun by rotation", () => {
    const a = rock(11, "large", { x: 50, y: 60, rotation: 1.25 });
    const ops = asteroidOps([a], ALL_LOADED);
    expect(keys(ops)).toEqual(["rock-11", "rock-11-veins"]);
    const m = ROCK_SPRITE_PAD;
    const rect = { x: 50 - 22 - m, y: 60 - 22 - m, w: 44 + 2 * m, h: 44 + 2 * m };
    expect(ops[0]).toEqual({
      k: "image",
      key: "rock-11",
      sprite: rockBody(a),
      ...rect,
      fit: "fill",
      rotate: 1.25,
      tint: rockPalette(11),
    });
    expect(ops[1]).toEqual({
      k: "image",
      key: "rock-11-veins",
      sprite: rockVeins(rockBody(a)),
      ...rect,
      fit: "fill",
      rotate: 1.25,
    });
  });

  it("a small rock has no veins", () => {
    const ops = asteroidOps([rock(12, "small")], ALL_LOADED);
    expect(keys(ops)).toEqual(["rock-12"]);
  });

  it("no outline polygon once the art is loaded; the outline (and no image) while it is not", () => {
    const a = rock(13, "large");
    expect(asteroidOps([a], ALL_LOADED).some((o) => o.k === "poly")).toBe(false);
    const fallback = asteroidOps([a], NONE_LOADED);
    expect(fallback.map((o) => o.k)).toEqual(["poly", "poly"]);
    expect(keys(fallback)).toEqual(["rock-13", "rock-13-edge"]);
    // the body loaded but its veins not yet: the body alone
    const noVeins = { ...ALL_LOADED, rockLarge1Veins: false, rockLarge2Veins: false };
    expect(keys(asteroidOps([a], noVeins))).toEqual(["rock-13"]);
  });

  it("the hit flash is the shared burst on the rock's own clock, over the rock", () => {
    const ops = asteroidOps([rock(14, "large", { hitFlashTimer: 60 })], ALL_LOADED);
    expect(keys(ops)).toEqual([
      "rock-14",
      "rock-14-veins",
      "rock-14-flash",
      "rock-14-flash-ring",
      "rock-14-flash-spark-0",
      "rock-14-flash-spark-1",
      "rock-14-flash-spark-2",
      "rock-14-flash-spark-3",
    ]);
    const ring = byKey(ops, "rock-14-flash-ring");
    expect(ring && ring.k === "circle" && ring.color & 0xffffff).toBe(HIT_RING_RGB);
    const core = byKey(ops, "rock-14-flash");
    expect(core && core.k === "circle" && core.color & 0xffffff).toBe(HIT_CORE_RGB);
  });

  it("appends to the buffer it is given, so a renderer can reuse one array", () => {
    const buf: DrawOp[] = [];
    expect(asteroidOps([rock(15, "small")], ALL_LOADED, buf)).toBe(buf);
    expect(buf).toHaveLength(1);
  });

  it("never moves or resizes the hitbox: the rock is unchanged by drawing it", () => {
    const a = rock(16, "large", { hitFlashTimer: 30 });
    const before = JSON.stringify(a);
    asteroidOps([a], ALL_LOADED);
    expect(JSON.stringify(a)).toBe(before);
    expect(a.radius).toBe(ASTEROID_STATS.large.radius);
  });
});

describe("the split crack (#3596)", () => {
  const SAFE_Y = 460;
  function shot(x: number, y: number): Bullet {
    return { id: 90_000, x, y, vx: 0, vy: 0, owner: "player", width: 5, height: 14, damage: 1 };
  }
  function quiet(): StarSwarmState {
    const s = advanceMs(initStarSwarm(CANVAS_W, CANVAS_H, 2), 8000);
    return {
      ...s,
      enemyFireDisabled: true,
      enemyBullets: [],
      asteroids: [],
      explosions: [],
      carrierBeams: [],
      player: { ...s.player, lives: 3, invincibleTimer: 0 },
      enemies: s.enemies.map((e) => (e.tier === "Carrier" ? { ...e, beamTimer: 1e9 } : e)),
    };
  }
  /** A moving large rock broken by one shot, as the engine does it. */
  function split(vx = 0.12, vy = 0.18): StarSwarmState {
    const s = quiet();
    const big = { ...rock(80_000, "large", { hp: 1, vx, vy }), x: CANVAS_W / 2, y: SAFE_Y };
    return tick({ ...s, asteroids: [big], playerBullets: [shot(big.x, big.y)] }, 16, NO_INPUT);
  }

  /** The age of `ex` on its own clock, ms (what the crack's 220 ms is counted in). */
  const ageOf = (ex: Explosion) => explosionProgress(ex) * EXPLOSION_FRAMES * EXPLOSION_FRAME_MS;

  /**
   * Ticks a fresh split at the given steps (cycled) for 700 ms and checks every frame: the crack is
   * drawn exactly while the dust's clock is under SPLIT_CRACK_MS, centred between the halves.
   * Returns how many frames showed it.
   */
  function crackRun(steps: readonly number[], vx = 0.12, vy = 0.18): number {
    let s = split(vx, vy);
    expect(s.asteroids.filter((r) => r.kind === "small")).toHaveLength(2);
    const id = s.explosions.find((e) => e.kind === "rock")!.id;
    let frames = 0;
    for (let t = 0, i = 0; t < 700; i++) {
      const ex = s.explosions.find((e) => e.id === id);
      if (!ex) break;
      const crack = effectOps(s, CANVAS_W, CANVAS_H).filter((o) =>
        o.key?.startsWith(`crack-${id}`)
      );
      expect({ t, shown: crack.length > 0 }).toEqual({ t, shown: ageOf(ex) < SPLIT_CRACK_MS });
      if (crack.length > 0) {
        frames++;
        const [a, b] = s.asteroids;
        const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        const glow = crack.find((o) => o.key === `crack-${id}-glow-2`);
        expect(
          glow && glow.k === "line" && Math.hypot(glow.x0 - mid.x, glow.y0 - mid.y)
        ).toBeLessThan(12);
      }
      const dt = steps[i % steps.length]!;
      s = tick(s, dt, NO_INPUT);
      t += dt;
    }
    return frames;
  }

  it.each([8, 16.67, 33])(
    "lasts its full SPLIT_CRACK_MS of the dust's clock at %p ms ticks, though the clock drops each frame's overshoot",
    (dt) => {
      // the clock runs slow, so the crack spans more real frames than 220 / dt
      expect(crackRun([dt])).toBeGreaterThanOrEqual(Math.floor(SPLIT_CRACK_MS / dt));
    }
  );

  it.each([
    [0.155, 0.155],
    [0, -0.22],
    [-0.22, 0],
  ])("survives a 100 ms hitch mid-crack at full rock speed (vx %p, vy %p)", (vx, vy) => {
    // 16.67 ms ticks with one 100 ms tick after ~120 ms: the halves travel 100 ms while the
    // dust's clock moves one 28 ms frame
    const steps = [...Array<number>(7).fill(16.67), 100, ...Array<number>(40).fill(16.67)];
    expect(crackRun(steps, vx, vy)).toBeGreaterThan(8);
  });

  it("draws over the dust and under the bomb flash, on native (frame ops) and web (the same effect ops)", () => {
    const s = { ...split(), bombFlashTimer: 200 };
    const id = s.explosions.find((e) => e.kind === "rock")!.id;
    const loaded = new Proxy({}, { get: () => true }) as Parameters<typeof buildFrame>[1]["loaded"];
    const native = keys(buildFrame(s, { loaded, width: CANVAS_W, height: CANVAS_H }));
    // web replays effectOps right after its rocks (GameCanvas.web.test pins that), so its order
    // is this list's
    const web = keys(effectOps(s, CANVAS_W, CANVAS_H));
    for (const k of [native, web]) {
      const lastDust = Math.max(...k.map((x, i) => (x.startsWith(`ex-${id}`) ? i : -1)));
      const firstCrack = k.findIndex((x) => x.startsWith(`crack-${id}`));
      const firstBomb = k.findIndex((x) => x.startsWith("bomb-"));
      expect(lastDust).toBeGreaterThanOrEqual(0);
      expect(firstCrack).toBeGreaterThan(lastDust);
      expect(firstBomb).toBeGreaterThan(firstCrack);
    }
    const lastRock = Math.max(...native.map((x, i) => (x.startsWith("rock-") ? i : -1)));
    expect(native.findIndex((x) => x.startsWith(`crack-${id}`))).toBeGreaterThan(lastRock);
  });

  it.each([
    [0, 0.22],
    [-0.22, 0],
    [0.155, -0.155],
  ])("is found for a rock at full speed (vx %p, vy %p) through its whole crack", (vx, vy) => {
    let s = split(vx, vy);
    const ex = s.explosions.find((e) => e.kind === "rock")!;
    for (let t = 0; t < SPLIT_CRACK_MS - 16; t += 16) {
      const now = s.explosions.find((e) => e.id === ex.id)!;
      expect(splitHalves(now, s.asteroids)).not.toBeNull();
      s = tick(s, 16, NO_INPUT);
    }
  });

  it("is a white-hot core over an orange glow, both fading, plus a flash where it opened", () => {
    const s = split();
    const ex = s.explosions.find((e) => e.kind === "rock")!;
    const ops = splitCrackOps(ex, s.asteroids);
    expect(keys(ops)[0]).toBe(`crack-${ex.id}-flash`);
    const glows = ops.filter((o) => o.key?.includes("-glow-"));
    const cores = ops.filter((o) => o.key?.includes("-core-"));
    expect(glows).toHaveLength(4);
    expect(cores).toHaveLength(4);
    for (const o of glows) expect(o.k === "line" && o.color & 0xffffff).toBe(HIT_RING_RGB);
    for (const o of cores) expect(o.k === "line" && o.color & 0xffffff).toBe(HIT_CORE_RGB);
    // later in the crack the flash is gone and the lines are fainter
    const later: Explosion = { ...ex, frameTimer: ex.frameTimer - 0, frame: 6 };
    const moved = s.asteroids.map((r) => ({ ...r, x: r.x + r.vx * 6 * EXPLOSION_FRAME_MS }));
    const laterOps = splitCrackOps(later, moved);
    expect(laterOps.some((o) => o.key?.endsWith("-flash"))).toBe(false);
    const alpha = (o: DrawOp | undefined) => (o && "color" in o ? o.color >>> 24 : -1);
    expect(alpha(laterOps.find((o) => o.key?.includes("-core-")))).toBeLessThan(alpha(cores[0]));
  });

  it("not for a small rock breaking, a shattered large rock, or unrelated rocks near a dust cloud", () => {
    // a broken small rock: dust, no halves
    let s = quiet();
    const small = { ...rock(81_000, "small", { hp: 1 }), x: CANVAS_W / 2, y: SAFE_Y };
    s = tick({ ...s, asteroids: [small], playerBullets: [shot(small.x, small.y)] }, 16, NO_INPUT);
    const dust = s.explosions.find((e) => e.kind === "rock")!;
    expect(dust).toBeDefined();
    expect(splitHalves(dust, s.asteroids)).toBeNull();
    // two consecutive small rocks that did not come from this explosion
    const strays = [
      rock(dust.id + 1, "small", { x: dust.x - 60, y: dust.y, vx: -ASTEROID_SPLIT_VX }),
      rock(dust.id + 2, "small", { x: dust.x + 80, y: dust.y + 40, vx: ASTEROID_SPLIT_VX }),
    ];
    expect(splitHalves(dust, strays)).toBeNull();
    // a non-rock explosion never cracks
    expect(splitHalves({ ...dust, kind: "burst" }, s.asteroids)).toBeNull();
  });

  it("a small rock broken in the same tick as a nearby split gets no crack of its own", () => {
    let s = quiet();
    const small = { ...rock(82_000, "small", { hp: 1, vy: 0.2 }), x: CANVAS_W / 2 - 60, y: SAFE_Y };
    const big = { ...rock(82_001, "large", { hp: 1, vy: 0.2 }), x: CANVAS_W / 2 + 40, y: SAFE_Y };
    s = tick(
      {
        ...s,
        asteroids: [small, big],
        playerBullets: [shot(small.x, small.y), { ...shot(big.x, big.y), id: 90_001 }],
      },
      16,
      NO_INPUT
    );
    const dust = s.explosions.filter((e) => e.kind === "rock");
    expect(dust.map((e) => e.srcId)).toEqual([small.id, big.id]);
    for (let t = 0; t < SPLIT_CRACK_MS; t += 16) {
      const now = dust.map((d) => s.explosions.find((e) => e.id === d.id)!);
      expect(splitHalves(now[0]!, s.asteroids)).toBeNull();
      expect(splitHalves(now[1]!, s.asteroids)).not.toBeNull();
      s = tick(s, 16, NO_INPUT);
    }
  });
});

describe("rock tint (#3596)", () => {
  it("the matrix maps grey L to edge + L x (light - edge), alpha untouched, for every palette", () => {
    expect(ROCK_TINT_MATRICES).toHaveLength(3);
    ROCK_PALETTES.forEach((p, i) => {
      const m = rockTintMatrix(i);
      expect(ROCK_TINT_MATRICES[i]).toEqual(m);
      const apply = (l: number) =>
        [0, 1, 2].map((row) => Math.round((m[row * 5 + row]! * l + m[row * 5 + 4]!) * 255));
      const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
      expect(apply(1)).toEqual(rgb(p.light));
      expect(apply(0)).toEqual(rgb(p.edge));
      expect(m.slice(15)).toEqual([0, 0, 0, 1, 0]);
    });
  });

  it("the palettes are the approved R1 basalt, R2 rust iron and R3 slate blue-grey", () => {
    expect(ROCK_PALETTES).toEqual([
      { light: 0x9a8c80, edge: 0x1e1915 },
      { light: 0xb0805a, edge: 0x24140c },
      { light: 0x8a96a8, edge: 0x151a22 },
    ]);
  });

  /** A recording 2D context and the canvases it was made for. */
  function fakeCanvases() {
    const made: { w: number; h: number; calls: unknown[][] }[] = [];
    const makeCanvas = (w: number, h: number) => {
      const calls: unknown[][] = [];
      made.push({ w, h, calls });
      const ctx = {
        set fillStyle(v: string) {
          calls.push(["fillStyle", v]);
        },
        set globalCompositeOperation(v: string) {
          calls.push(["op", v]);
        },
        fillRect: (...a: unknown[]) => calls.push(["fillRect", ...a]),
        drawImage: (...a: unknown[]) => calls.push(["drawImage", ...a]),
      };
      return { width: w, height: h, getContext: () => ctx } as unknown as HTMLCanvasElement;
    };
    return { made, makeCanvas };
  }

  it("web bakes a palette with compositing alone: black, the grey image, x (light - edge), + edge, the rock's alpha", () => {
    const { made, makeCanvas } = fakeCanvases();
    const img = { width: 144, height: 144 } as unknown as HTMLImageElement;
    expect(buildTintedRock(img, 1, makeCanvas)).not.toBeNull();
    expect(made).toHaveLength(1);
    expect(made[0]!.calls).toEqual([
      ["fillStyle", "#000000"],
      ["fillRect", 0, 0, 144, 144],
      ["drawImage", img, 0, 0, 144, 144],
      ["op", "multiply"],
      ["fillStyle", "#8c6c4e"], // 0xb0805a - 0x24140c
      ["fillRect", 0, 0, 144, 144],
      ["op", "lighter"],
      ["fillStyle", "#24140c"],
      ["fillRect", 0, 0, 144, 144],
      ["op", "destination-in"],
      ["drawImage", img, 0, 0, 144, 144],
      ["op", "source-over"],
    ]);
  });

  it("web bakes every body x palette once; later calls and frames build nothing", () => {
    const { made, makeCanvas } = fakeCanvases();
    const img = { width: 84, height: 84 } as unknown as HTMLImageElement;
    const cache: RockTintCache = [];
    const bodies = ROCK_BODY_LIST.map(() => img);
    prebuildRockTints(cache, bodies, makeCanvas);
    expect(made).toHaveLength(ROCK_BODY_LIST.length * ROCK_PALETTE_COUNT);
    prebuildRockTints(cache, bodies, makeCanvas);
    expect(made).toHaveLength(ROCK_BODY_LIST.length * ROCK_PALETTE_COUNT);
    ROCK_BODY_LIST.forEach((_, b) => expect(rockBodyBaked(cache, b)).toBe(true));
  });

  it("web skips a body that has not loaded and bakes it when it arrives", () => {
    const { made, makeCanvas } = fakeCanvases();
    const img = { width: 84, height: 84 } as unknown as HTMLImageElement;
    const cache: RockTintCache = [];
    prebuildRockTints(cache, [img, null], makeCanvas);
    expect(rockBodyBaked(cache, 0)).toBe(true);
    expect(rockBodyBaked(cache, 1)).toBe(false);
    prebuildRockTints(cache, [img, img], makeCanvas);
    expect(rockBodyBaked(cache, 1)).toBe(true);
    expect(made).toHaveLength(2 * ROCK_PALETTE_COUNT);
  });

  it("web replays the same ops native draws: the baked canvas for the tinted body, the veins image, rotated about the centre", () => {
    const tinted = Array.from({ length: ROCK_BODY_LIST.length * ROCK_PALETTE_COUNT }, (_, i) => ({
      baked: i,
    })) as unknown as RockTintCache;
    const veins = { veins: true } as unknown as HTMLImageElement;
    const images = Object.fromEntries(ROCK_SPRITES.map((k) => [k, null])) as Record<
      string,
      CanvasImageSource | null
    >;
    images.rockLarge1Veins = veins;
    images.rockLarge2Veins = veins;
    const a = rock(21, "large", { x: 70, y: 90, rotation: 0.5 });
    const ops = asteroidOps([a], ALL_LOADED);
    const calls: unknown[][] = [];
    const ctx = {
      save: () => calls.push(["save"]),
      restore: () => calls.push(["restore"]),
      translate: (...v: unknown[]) => calls.push(["translate", ...v]),
      rotate: (...v: unknown[]) => calls.push(["rotate", ...v]),
      drawImage: (...v: unknown[]) => calls.push(["drawImage", ...v]),
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;
    drawRockOps(ctx, ops, images, tinted, rockBodySlot);
    const s = 44 + 2 * ROCK_SPRITE_PAD;
    const slot = rockTintSlot(rockBodySlot(rockBody(a)), rockPalette(21));
    expect(calls).toEqual([
      ["save"],
      ["translate", 70, 90],
      ["rotate", 0.5],
      ["drawImage", tinted[slot], -s / 2, -s / 2, s, s],
      ["restore"],
      ["save"],
      ["translate", 70, 90],
      ["rotate", 0.5],
      ["drawImage", veins, -s / 2, -s / 2, s, s],
      ["restore"],
    ]);
  });
});

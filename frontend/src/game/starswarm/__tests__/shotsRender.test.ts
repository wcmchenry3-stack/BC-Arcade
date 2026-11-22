/**
 * #3594: the projectiles as shared display-list ops (`render/shots.ts`): one sprite op per shot,
 * the kind picked from the shot, bolts turned along their travel, and one fallback shape while a
 * sprite loads. The native replay is pinned in drawFrame.test.ts and the web replay in
 * GameCanvas.web.test.tsx; this file pins the ops both replay.
 */
import { CANVAS_H, CANVAS_W, initStarSwarm } from "../engine";
import { makeBuddy } from "../engine/buddy";
import { BUDDY_BULLET_SPEED, BULLET_P_VY, DEFAULT_TUNING, SPREAD_VX } from "../engine/tuning";
import { tickCarrier, type CarrierCtx } from "../engine/carrier";
import { playerVolley } from "../engine/powerups";
import { opaque } from "../render/color";
import { buildFrame, type DrawOp, type LoadedSprites } from "../render/frame";
import { setDebugOpKeys } from "../render/opKeys";
import {
  SHOT_BUDDY_RGB,
  SHOT_CARRIER_RGB,
  SHOT_ENEMY_RGB,
  SHOT_FLAK_RGB,
  SHOT_PLAYER_RGB,
} from "../render/palette";
import {
  SHOT_LOOKS,
  SHOT_PAD,
  SHOT_SPRITES,
  shotOps,
  shotSprite,
  shotTurn,
  type ShotSpriteKey,
} from "../render/shots";
import type { Bullet, StarSwarmState } from "../types";

const ON = Object.fromEntries(SHOT_SPRITES.map((k) => [k, true])) as Record<ShotSpriteKey, boolean>;
const OFF = Object.fromEntries(SHOT_SPRITES.map((k) => [k, false])) as Record<
  ShotSpriteKey,
  boolean
>;

function bullet(over: Partial<Bullet> = {}): Bullet {
  return {
    id: 1,
    x: 100,
    y: 300,
    vx: 0,
    vy: 0.35,
    owner: "enemy",
    width: 5,
    height: 10,
    damage: 1,
    ...over,
  };
}

const player = (over: Partial<Bullet> = {}) =>
  bullet({ owner: "player", width: 5, height: 14, vy: BULLET_P_VY, ...over });
const image = (op: DrawOp | undefined) => op as Extract<DrawOp, { k: "image" }>;

beforeAll(() => setDebugOpKeys(true));
afterAll(() => setDebugOpKeys(false));

describe("shotSprite (#3594)", () => {
  it("picks one sprite per kind: player, Buddy, enemy, flak, the Carrier's twin lasers", () => {
    expect(shotSprite(player())).toBe("shotPlayer");
    expect(shotSprite(player({ source: "buddy" }))).toBe("shotBuddy");
    expect(shotSprite(bullet())).toBe("shotEnemy");
    expect(shotSprite(bullet({ flak: true }))).toBe("shotFlak");
    expect(shotSprite(bullet({ source: "carrier" }))).toBe("shotCarrier");
    // flak wins over the shooter: a Carrier volley diverted at a rock is amber flak
    expect(shotSprite(bullet({ source: "carrier", flak: true }))).toBe("shotFlak");
    // an enemy shot aimed at Buddy is still danger
    expect(shotSprite(bullet({ target: "buddy" }))).toBe("shotEnemy");
  });

  it("Buddy's bolt is its own sprite, smaller than the player's, in a different colour", () => {
    expect(SHOT_LOOKS.shotBuddy).not.toEqual(SHOT_LOOKS.shotPlayer);
    expect(SHOT_LOOKS.shotBuddy.h).toBeLessThan(SHOT_LOOKS.shotPlayer.h);
    expect(SHOT_LOOKS.shotBuddy.color).not.toBe(SHOT_LOOKS.shotPlayer.color);
  });

  it("the art boxes match the generator's (SHOT_BOXES) and the player's bolt its hitbox", () => {
    const box = (k: ShotSpriteKey) => [SHOT_LOOKS[k].w, SHOT_LOOKS[k].h];
    expect(box("shotPlayer")).toEqual([5, 14]);
    expect(box("shotBuddy")).toEqual([4, 10]);
    expect(box("shotEnemy")).toEqual([7, 7]);
    expect(box("shotFlak")).toEqual([5, 8]);
    expect(box("shotCarrier")).toEqual([8, 8]);
    const [bolt] = playerVolley(100, 500, 1);
    expect([bolt!.width, bolt!.height]).toEqual(box("shotPlayer"));
    expect(SHOT_PAD).toBe(2); // the generator's SHOT_PAD (6 px at 3x)
  });
});

describe("shotOps (#3594)", () => {
  it("one image op per shot, the sprite rect centred on the shot (art box plus its glow margin)", () => {
    const enemy = [bullet({ id: 1 }), bullet({ id: 2, flak: true, vx: 0.2 })];
    const mine = [player({ id: 3 }), player({ id: 4, source: "buddy", width: 5, height: 10 })];
    const ops = shotOps(enemy, mine, ON);
    expect(ops).toHaveLength(4);
    expect(ops.every((o) => o.k === "image")).toBe(true);
    expect(ops.map((o) => o.key)).toEqual(["eb-1", "eb-2", "pb-3", "pb-4"]);
    expect(ops.map((o) => image(o).sprite)).toEqual([
      "shotEnemy",
      "shotFlak",
      "shotPlayer",
      "shotBuddy",
    ]);
    // 7 px orb + 2 px either side, centred on (100, 300)
    expect(ops[0]).toMatchObject({ x: 94.5, y: 294.5, w: 11, h: 11, fit: "fill" });
    // Buddy's bolt is drawn at its art box (4 x 10), not its 5 x 10 hitbox
    expect(ops[3]).toMatchObject({ x: 96, y: 293, w: 8, h: 14 });
  });

  it("enemy fire is listed first, under the player's", () => {
    const ops = shotOps([bullet({ id: 9 })], [player({ id: 1 })], ON);
    expect(ops.map((o) => o.key)).toEqual(["eb-9", "pb-1"]);
  });

  it("a straight-up bolt is not turned; a spread bolt is turned along its drift", () => {
    const [left, right, spreadL, spreadR] = playerVolley(200, 500, 3).map((b, i) => ({
      ...b,
      id: i + 1,
    }));
    const ops = shotOps([], [left!, right!, spreadL!, spreadR!], ON).map(image);
    expect(ops[0]!.rotate).toBeUndefined();
    expect(ops[1]!.rotate).toBeUndefined();
    const angle = Math.atan2(SPREAD_VX, -BULLET_P_VY); // about 14 degrees
    expect(ops[2]!.rotate).toBeCloseTo(-angle);
    expect(ops[3]!.rotate).toBeCloseTo(angle);
    expect((angle * 180) / Math.PI).toBeGreaterThan(10);
  });

  it("Buddy's bolts and flak turn along their velocity; orbs never turn", () => {
    const flak = bullet({ id: 1, flak: true, vx: -0.3, vy: 0.3 });
    const orb = bullet({ id: 2, vx: 0.3, vy: 0.1 });
    const pink = bullet({ id: 3, source: "carrier", vx: -0.2, vy: 0.4 });
    const fan = player({ id: 4, source: "buddy", vx: BUDDY_BULLET_SPEED, vy: 0 });
    const ops = shotOps([flak, orb, pink], [fan], ON).map(image);
    expect(ops.map((o) => o.sprite)).toEqual(["shotFlak", "shotEnemy", "shotCarrier", "shotBuddy"]);
    expect(ops[0]!.rotate).toBeCloseTo(Math.atan2(-0.3, -0.3)); // down-left
    expect(ops[1]!.rotate).toBeUndefined();
    expect(ops[2]!.rotate).toBeUndefined();
    expect(ops[3]!.rotate).toBeCloseTo(Math.PI / 2); // flying right
  });

  it("shotTurn points an up-facing sprite along (vx, vy)", () => {
    expect(shotTurn(0, -1)).toBeUndefined();
    expect(shotTurn(1, 0)).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(shotTurn(0, 1)!)).toBeCloseTo(Math.PI);
    expect(shotTurn(-1, 0)).toBeCloseTo(-Math.PI / 2);
  });

  it("a charged bolt from an older save keeps its width (no separate charge look)", () => {
    const [op] = shotOps([], [player({ width: 12, height: 14 })], ON);
    expect(op).toMatchObject({ k: "image", sprite: "shotPlayer", w: 12 + 2 * SHOT_PAD });
  });

  it("while a sprite loads: one plain shape in the shot's colour, a circle for an orb", () => {
    const ops = shotOps(
      [bullet({ id: 1 }), bullet({ id: 2, flak: true }), bullet({ id: 3, source: "carrier" })],
      [player({ id: 4 }), player({ id: 5, source: "buddy" })],
      OFF
    );
    expect(ops).toEqual([
      { k: "circle", key: "eb-1", cx: 100, cy: 300, r: 3.5, color: opaque(SHOT_ENEMY_RGB) },
      {
        k: "rect",
        key: "eb-2",
        x: 97.5,
        y: 296,
        w: 5,
        h: 8,
        color: opaque(SHOT_FLAK_RGB),
      },
      { k: "circle", key: "eb-3", cx: 100, cy: 300, r: 4, color: opaque(SHOT_CARRIER_RGB) },
      {
        k: "rect",
        key: "pb-4",
        x: 97.5,
        y: 293,
        w: 5,
        h: 14,
        color: opaque(SHOT_PLAYER_RGB),
      },
      { k: "rect", key: "pb-5", x: 98, y: 295, w: 4, h: 10, color: opaque(SHOT_BUDDY_RGB) },
    ]);
  });

  it("each sprite falls back on its own: a loaded one still draws", () => {
    const ops = shotOps([bullet()], [player()], { ...OFF, shotPlayer: true });
    expect(ops.map((o) => o.k)).toEqual(["circle", "image"]);
  });

  it("appends to the list it is given and builds no keys with debug keys off", () => {
    const list: DrawOp[] = [];
    expect(shotOps([bullet()], [], ON, list)).toBe(list);
    setDebugOpKeys(false);
    try {
      expect(shotOps([bullet()], [player()], ON).every((o) => o.key === undefined)).toBe(true);
    } finally {
      setDebugOpKeys(true);
    }
  });

  it("buildFrame draws exactly these ops, first in the list (under the enemies)", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42);
    const state: StarSwarmState = {
      ...s,
      enemyBullets: [bullet({ id: 1 }), bullet({ id: 2, source: "carrier" })],
      playerBullets: [player({ id: 3 })],
    };
    const all = new Proxy({}, { get: () => true }) as LoadedSprites;
    const ops = buildFrame(state, { loaded: all, width: CANVAS_W, height: CANVAS_H });
    expect(ops.slice(0, 3)).toEqual(shotOps(state.enemyBullets, state.playerBullets, ON));
  });
});

describe("the Carrier's twin lasers carry source: carrier (#3594, render-only)", () => {
  const base = () => initStarSwarm(CANVAS_W, CANVAS_H, 5, 42, "Captain");
  const ctx = (over: Partial<CarrierCtx> = {}): CarrierCtx => ({
    playing: true,
    stage: "exposed",
    prevStage: "exposed",
    bossWave: false,
    difficulty: "Captain",
    playerX: 300,
    playerY: 560,
    canvasH: CANVAS_H,
    flakRock: null,
    buddy: null,
    rocks: [],
    bayOpen: false,
    ...over,
  });
  const ready = () => ({
    ...base().enemies.find((e) => e.tier === "Carrier")!,
    phase: "Formation" as const,
    shootTimer: 0,
    beamTimer: 1e9,
    runTimer: 1e9,
  });

  it("at the player and at Buddy: pink; diverted at a rock: amber flak", () => {
    const atPlayer = tickCarrier(ready(), 16, ctx()).bullets!;
    expect(atPlayer).toHaveLength(2);
    expect(atPlayer.every((b) => b.source === "carrier")).toBe(true);
    expect(atPlayer.map(shotSprite)).toEqual(["shotCarrier", "shotCarrier"]);

    const buddy = makeBuddy(base());
    const always = {
      ...DEFAULT_TUNING,
      BUDDY_TARGETING: {
        ...DEFAULT_TUNING.BUDDY_TARGETING,
        Carrier: { ...DEFAULT_TUNING.BUDDY_TARGETING.Carrier, divert: 1 },
      },
    };
    const atBuddy = tickCarrier(ready(), 16, ctx({ buddy }), always).bullets!;
    expect(atBuddy.every((b) => b.target === "buddy" && b.source === "carrier")).toBe(true);

    const rock = { x: 300, y: 200, vx: 0, vy: -0.1 };
    const flak = tickCarrier(ready(), 16, ctx({ flakRock: rock })).bullets!;
    expect(flak.every((b) => b.flak === true && b.source === undefined)).toBe(true);
    expect(flak.map(shotSprite)).toEqual(["shotFlak", "shotFlak"]);
  });
});

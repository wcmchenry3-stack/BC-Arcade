/**
 * #3562: Lightning's beams as shared display-list geometry (`render/lightningBeam.ts`), the ops
 * `buildFrame` appends and `GameCanvas.web.tsx` replays (its replay is pinned in
 * GameCanvas.web.test.tsx).
 */
import {
  CANVAS_H,
  CANVAS_W,
  POWERUP_DURATION,
  initStarSwarm,
  lightningBeamAt,
  lightningBeamCount,
  newLightningBeam,
} from "../engine";
import { makeAsteroid } from "../engine/asteroids";
import { withAlpha } from "../render/color";
import { buildFrame, type DrawOp, type LoadedSprites } from "../render/frame";
import { CRACKLE_MS, CRACKLE_SEGMENTS, lightningBeamOps } from "../render/lightningBeam";
import { setDebugOpKeys } from "../render/opKeys";
import { LIGHTNING_RGB, WHITE_RGB } from "../render/palette";
import type { GunsLevel, StarSwarmState } from "../types";

const LOADED: LoadedSprites = {
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
const OPTS = { loaded: LOADED, width: CANVAS_W, height: CANVAS_H };

function lit(guns: GunsLevel = 1, remainingMs = POWERUP_DURATION): StarSwarmState {
  const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42);
  return {
    ...s,
    phase: "Playing",
    enemies: [],
    activePowerUp: { type: "lightning", remainingMs, shieldAbsorbed: 0 },
    player: { ...s.player, guns, invincibleTimer: 0 },
  };
}

const keyed = (ops: readonly DrawOp[]) => ops.map((o) => o.key ?? "");
const poly = (op: DrawOp | undefined) => (op as Extract<DrawOp, { k: "poly" }>).points;

describe("lightningBeamOps (#3562)", () => {
  beforeAll(() => setDebugOpKeys(true));
  afterAll(() => setDebugOpKeys(false));

  it("draws only while the beam is on: never off, banked, in the extraction or toggled off", () => {
    const on = lit();
    expect(lightningBeamOps(on)).toHaveLength(4);
    const off: StarSwarmState[] = [
      { ...on, activePowerUp: null },
      { ...on, activePowerUp: null, bankedPowerUp: "lightning" },
      { ...on, activePowerUp: { type: "shield", remainingMs: 4000, shieldAbsorbed: 0 } },
      { ...on, phase: "Extraction" },
      { ...on, phase: "SwoopIn" },
      { ...on, phase: "GameOver" },
      { ...on, playerFireDisabled: true },
    ];
    for (const s of off) expect(lightningBeamOps(s)).toEqual([]);
    expect(lightningBeamOps({ ...on, phase: "ClearAwaitingPickups" })).toHaveLength(4);
  });

  it.each([
    [1, 4],
    [2, 8],
    [3, 16],
  ] as const)("L%s: one beam per gun, four ops each (%s ops)", (guns, n) => {
    const ops = lightningBeamOps(lit(guns));
    expect(ops).toHaveLength(n);
    expect(lightningBeamCount(lit(guns)) * 4).toBe(n);
    expect(keyed(ops.slice(0, 4))).toEqual([
      "lbeam-0-glow",
      "lbeam-0-crackle",
      "lbeam-0-core",
      "lbeam-0-flare",
    ]);
  });

  it("is the engine's beam: from the gun on the nose to the top, in palette colours", () => {
    const s = lit();
    const b = lightningBeamAt(s, 0, s.asteroids, newLightningBeam());
    const [glow, crackle, core, flare] = lightningBeamOps(s);
    expect(glow!.color).toBe(withAlpha(LIGHTNING_RGB, 0.3));
    expect(crackle!.color).toBe(withAlpha(LIGHTNING_RGB, 0.85));
    expect(core!.color).toBe(withAlpha(WHITE_RGB, 0.9));
    expect(flare).toMatchObject({ k: "circle", cx: b.ox, cy: b.oy, r: b.halfW });
    // glow: a quad from the nose (oy) to y = 0, halfW + 4 either side
    const g = poly(glow);
    expect(g).toHaveLength(8);
    expect(Math.min(g[1]!, g[3]!, g[5]!, g[7]!)).toBeCloseTo(0);
    expect(Math.max(g[1]!, g[3]!, g[5]!, g[7]!)).toBeCloseTo(b.oy);
    expect(Math.max(g[0]!, g[2]!) - Math.min(g[4]!, g[6]!)).toBeCloseTo(2 * (b.halfW + 4));
    // the ribbon is a closed polygon up one edge and down the other
    expect(poly(crackle)).toHaveLength((CRACKLE_SEGMENTS + 1) * 4);
  });

  it("an angled L3 beam is drawn along its own line", () => {
    const s = lit(3);
    const b = lightningBeamAt(s, 3, s.asteroids, newLightningBeam());
    const core = poly(lightningBeamOps(s)[3 * 4 + 2]);
    const topX = (core[2]! + core[4]!) / 2;
    expect(topX).toBeCloseTo(b.ox + b.ux * b.len);
    expect(topX).toBeGreaterThan(b.ox + 50);
  });

  it("ends at the rock that stops it", () => {
    const s = lit();
    const rocked = {
      ...s,
      asteroids: [{ ...makeAsteroid("large", s.player.x, 300, 0, 0), spin: 0 }],
    };
    const core = poly(lightningBeamOps(rocked)[2]);
    expect(Math.min(core[1]!, core[3]!, core[5]!, core[7]!)).toBeCloseTo(300);
  });

  it("crackles without state: the same frame twice is identical, the next crackle step differs", () => {
    const a = lightningBeamOps(lit(1, 4000));
    expect(lightningBeamOps(lit(1, 4000))).toEqual(a);
    expect(lightningBeamOps(lit(1, 4000 - 1))).not.toEqual(a); // across a CRACKLE_MS boundary
    expect(lightningBeamOps(lit(1, 4000 + CRACKLE_MS - 1))).toEqual(a); // same step
    // only the ribbon moves
    const b = lightningBeamOps(lit(1, 4000 - 1));
    expect([b[0], b[2], b[3]]).toEqual([a[0], a[2], a[3]]);
  });

  it("buildFrame appends exactly these ops, after the enemies and before the ship", () => {
    const s = lit(2);
    const ops = buildFrame(s, OPTS);
    const keys = keyed(ops);
    const first = keys.indexOf("lbeam-0-glow");
    expect(ops.slice(first, first + 8)).toEqual(lightningBeamOps(s));
    expect(first).toBeLessThan(keys.indexOf("player"));
    // with the beam off, the frame loses exactly the beam's ops (and nothing else is added)
    const offOps = buildFrame({ ...s, phase: "Extraction" }, OPTS);
    expect(ops.length - offOps.length).toBe(8);
    expect(keyed(offOps).some((k) => k.startsWith("lbeam"))).toBe(false);
  });

  it("appends to the list it is given, and builds no keys when debug keys are off", () => {
    const list: DrawOp[] = [];
    expect(lightningBeamOps(lit(), list)).toBe(list);
    setDebugOpKeys(false);
    try {
      expect(lightningBeamOps(lit()).every((o) => o.key === undefined)).toBe(true);
    } finally {
      setDebugOpKeys(true);
    }
  });

  it("writes the beam geometry into the scratch it is given (the geometry step allocates nothing)", () => {
    const s = lit(3);
    const scratch = newLightningBeam();
    for (let i = 0; i < 4; i++) expect(lightningBeamAt(s, i, s.asteroids, scratch)).toBe(scratch);
  });
});

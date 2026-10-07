/**
 * #2880 Buddy balance simulation: the fast smoke layer (a few seconds, every PR).
 *
 * The harness drives the real engine, its attribution adds up to Buddy's real HP loss, a seeded
 * cell replays to the same metrics, a no-override engine variant is the shipped engine, and every
 * preset variant still applies to the current engine source. The full run is the CLI
 * (`npx tsx tools/sim/simulate-starswarm.ts`), see docs/games/starswarm.md → "Balance simulation".
 */
import * as fs from "fs";
import * as realEngine from "../../../src/game/starswarm/engine";
import {
  PILOTS,
  cellSeed,
  measureCell,
  runCell,
  runOne,
  attributeTick,
  type CellSpec,
  type RunSpec,
} from "../balance";
import { loadEngineVariant, patchEngineSource } from "../engineVariant";
import { BASE, CANDIDATES, FAST, SWEEPS, VARIANTS, engineFor, isShipped } from "../presets";
import { formatOffense, formatReport } from "../report";

const fastCells: CellSpec[] = FAST.groups.flatMap((g) =>
  g.scenarios.flatMap((scenario) =>
    g.difficulties.map((difficulty) => ({
      scenario,
      difficulty,
      pilot: g.pilots[0]!,
      variant: g.variants[0]!.name,
      seeds: FAST.seeds,
    }))
  )
);

describe("balance sim harness (fast)", () => {
  it("launches Buddy through the real power-up path and accounts for every hit point", () => {
    for (const cell of fastCells) {
      for (const r of runCell(realEngine, cell)) {
        expect(r.reached).toBe(true);
        expect(r.sortieMs).toBeGreaterThan(0);
        expect(r.hpEnd).toBeGreaterThanOrEqual(0);
        expect(r.hpEnd).toBeLessThanOrEqual(realEngine.BUDDY_HP);
        // a shot fired and landed within one tick is invisible to diffing: rare, and counted
        expect(r.attributionMisses).toBeLessThanOrEqual(1);
        const taken = Object.values(r.damageTaken).reduce((a, b) => a + b, 0);
        if (r.destroyed) expect(taken + r.attributionMisses).toBeGreaterThanOrEqual(1);
        else expect(realEngine.BUDDY_HP - taken - r.attributionMisses).toBe(r.hpEnd);
        expect(r.fleetAtLaunch).toBeGreaterThan(0);
        const kills = r.killsByRun.reduce((a, b) => a + b, 0);
        expect(kills).toBe(Object.values(r.buddyKills).reduce((a, b) => a + b, 0));
        expect(r.killsByRun.length).toBeLessThanOrEqual(realEngine.BUDDY_BURSTS);
      }
    }
  });

  it("measures a cell deterministically into a plain metrics object", () => {
    const cell = fastCells[0]!;
    const a = measureCell(realEngine, cell);
    expect(measureCell(realEngine, cell)).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(a.reached).toBe(cell.seeds);
    expect(a.destroyedPct).toBeGreaterThanOrEqual(0);
    expect(a.destroyedPct).toBeLessThanOrEqual(1);
    expect(formatReport([a])).toContain("| Capt |");
    expect(formatOffense([a])).toContain("base");
  });

  it("hashes seeds instead of counting them (the engine's LCG correlates neighbours)", () => {
    const seeds = new Set(Array.from({ length: 50 }, (_, i) => cellSeed(i)));
    expect(seeds.size).toBe(50);
    expect(Math.abs(cellSeed(1) - cellSeed(0))).toBeGreaterThan(1000);
  });

  it("a variant with no overrides replays the shipped engine exactly", () => {
    const spec: RunSpec = {
      scenario: "boss-exposed",
      difficulty: "Commander",
      seed: cellSeed(0),
      pilot: PILOTS.normal,
      variant: "x",
    };
    expect(runOne(loadEngineVariant({}), spec)).toEqual(runOne(realEngine, spec));
  });

  it("every preset variant still applies to the current engine source", () => {
    const src = fs.readFileSync(require.resolve("../../../src/game/starswarm/engine.ts"), "utf8");
    for (const v of VARIANTS) {
      expect(() => patchEngineSource(src, v.spec)).not.toThrow();
      expect(typeof engineFor(v).tick).toBe("function");
    }
    expect(() => patchEngineSource(src, { consts: { NOT_A_CONSTANT: "1" } })).toThrow();
  });

  it("does not credit the player's Carrier damage to a Buddy shot spent on an escort that tick", () => {
    // A Buddy shot that already hit the Carrier on an earlier tick still overlaps it, and is spent
    // on a neighbouring escort this tick, while the player's own shot damages the Carrier.
    const s0 = realEngine.initStarSwarm(390, 844, 5, 1);
    const carrier = s0.enemies.find((e) => e.tier === "Carrier")!;
    const escort = s0.enemies.find((e) => e.tier === "Guardian")!;
    const enemies = s0.enemies.map((e) =>
      e.id === escort.id ? { ...e, x: carrier.x, y: carrier.y } : e
    );
    const shot = {
      id: 987_654,
      x: carrier.x,
      y: carrier.y,
      vx: 0,
      vy: 0,
      owner: "player" as const,
      width: 6,
      height: 6,
      damage: 1,
      piercing: true,
      pierceLeft: 1,
      source: "buddy" as const,
      hitEnemyIds: [carrier.id],
    };
    const pre = { ...s0, enemies, playerBullets: [shot] };
    const post = {
      ...pre,
      playerBullets: [], // the shot was spent on its last hit
      enemies: enemies.map((e) =>
        e.id === carrier.id || e.id === escort.id ? { ...e, hp: e.hp - 1 } : e
      ),
    };
    const rec = attributeTick(realEngine, pre, post, {
      scenario: "boss-exposed",
      difficulty: "Captain",
      seed: 0,
      pilot: PILOTS.normal,
      variant: "x",
    });
    expect(rec.carrierDamageTotal).toBe(1);
    expect(rec.buddyCarrierDamage).toBe(0); // the player hit the Carrier
    expect(rec.buddyDamage).toBe(1); // the escort was Buddy's hit
    expect(rec.playerDamage).toBe(1);
  });

  it("credits a shot to a ship that fired and was killed in the same tick", () => {
    const s0 = realEngine.initStarSwarm(390, 844, 5, 1);
    const guardian = s0.enemies.find((e) => e.tier === "Guardian")!;
    // the Guardian fires and dies this tick; the nearest *surviving* ship is a different tier
    const shot = {
      id: 876_543,
      x: guardian.x,
      y: guardian.y + guardian.height / 2,
      vx: 0,
      vy: 0.3,
      owner: "enemy" as const,
      width: 6,
      height: 10,
      damage: 1,
      target: "buddy" as const,
    };
    const post = {
      ...s0,
      enemyBullets: [shot],
      enemies: s0.enemies.map((e) => (e.id === guardian.id ? { ...e, hp: 0, isAlive: false } : e)),
    };
    const rec = attributeTick(realEngine, s0, post, {
      scenario: "boss-exposed",
      difficulty: "Captain",
      seed: 0,
      pilot: PILOTS.normal,
      variant: "x",
    });
    expect(rec.drawn.Guardian).toBe(1);
    expect(rec.drawn.Grunt + rec.drawn.Elite + rec.drawn.Carrier).toBe(0);
  });

  it("sweeps and candidates are built on the pre-#2880 tuning, not the shipped engine", () => {
    expect(isShipped(BASE)).toBe(true);
    for (const v of [...SWEEPS, ...CANDIDATES]) {
      expect(isShipped(v)).toBe(false);
      expect(v.spec.consts).toHaveProperty("BUDDY_REPLAN_MS"); // legacy values are explicit
    }
    // a no-evade variant also stops noticing shots aimed at Buddy
    const noEvade = SWEEPS.find((v) => v.name === "noEvade")!;
    expect(JSON.stringify(noEvade.spec.patches)).toContain("? 0 :");
  });
});

/**
 * Star Swarm `damage.hitsByTier` (#3710): which enemy tier landed each hit on the player.
 *
 * - attribution per cause (bullet by its stamp, ram by the rammer, beam = Carrier, rock = none),
 *   per result (shield per projectile, plating / life once per tick);
 * - the owner's rules: the first bullet in array order is charged for a tick (D5), a bullet with
 *   no tier (an older save's) is counted in no tier (D6);
 * - the stamp itself, at the two places an enemy shot enters play, and that stamping never
 *   changes play (the golden hashes are the proof; `sha()` leaves `tier` out);
 * - the wire form (sparse), the worst-case size, the invariant over a seeded run, the save.
 *
 * See docs/games/starswarm.md#per-wave-stats.
 */
import {
  CANVAS_H,
  CANVAS_W,
  ENEMY_TIERS,
  HIT_CAUSES,
  HIT_RESULTS,
  _resetIds,
  emptyWaveStats,
  initStarSwarm,
  tick,
  toWirePayload,
  type HitResult,
  type WaveStatsSnapshot,
} from "../engine";
import { bulletTier } from "../engine/waveCounters";
import { withSavedHitsByTier } from "../engine/waveStats";
import { WAVE_STATS_MAX_BYTES } from "../../_shared/eventQueueConfig";
import { SAVE_FINGERPRINT, fitsSaveShape, restoreSavedState } from "../saveShape";
import type { EnemyTier, StarSwarmState } from "../types";
import { NO_INPUT, makeBeam } from "./helpers/engineFixtures";
import { arena, collide, enemyShot, lone, rock, snap } from "./helpers/waveStatsScenarios";

beforeEach(() => _resetIds());

const SHIELD = { type: "shield", remainingMs: 5000, shieldAbsorbed: 0 } as const;

/** The grid as `{tier: {result: n}}`, nonzero cells only. */
function grid(s: StarSwarmState): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const t of ENEMY_TIERS) {
    for (const r of HIT_RESULTS) {
      const n = s.waveStats.damage.hitsByTier[t][r];
      if (n > 0) (out[t] ??= {})[r] = n;
    }
  }
  return out;
}

/** The ship, in `ward`'s protection, with `hazard` on it. */
function hit(
  hazard: (s: StarSwarmState) => Partial<StarSwarmState>,
  ward: HitResult = "life",
  base = arena()
): StarSwarmState {
  return collide({
    ...base,
    ...hazard(base),
    activePowerUp: ward === "shield" ? { ...SHIELD } : null,
    player: { ...base.player, hull: ward === "plating" ? 1 : 0 },
  });
}

/** A ram-eligible diving ship of `tier` on the ship, every tier's ram latch open. */
function rammer(tier: EnemyTier): StarSwarmState {
  const base = arena();
  const { state, ship } = lone(base, tier, { phase: "Diving" });
  const placed = { ...ship, x: state.player.x, y: state.player.y };
  return {
    ...state,
    guardianThresholdCrossed: true,
    guardianDeepThresholdCrossed: true,
    enemies: state.enemies.map((e) => (e.id === ship.id ? placed : e)),
  };
}

const shotOf = (s: StarSwarmState, extra: Parameters<typeof enemyShot>[2]) =>
  enemyShot(s.player.x, s.player.y, extra);

describe("bullets: charged to the tier that fired them", () => {
  it.each(ENEMY_TIERS)("a %s bullet that costs a life", (tier) => {
    const s = hit((b) => ({ enemyBullets: [shotOf(b, { tier })] }));
    expect(grid(s)).toEqual({ [tier]: { life: 1 } });
    expect(s.waveStats.damage.hits.bullet.life).toBe(1);
  });

  it.each(ENEMY_TIERS)("a %s bullet that costs a plate", (tier) => {
    const s = hit((b) => ({ enemyBullets: [shotOf(b, { tier })] }), "plating");
    expect(grid(s)).toEqual({ [tier]: { plating: 1 } });
  });

  it.each(ENEMY_TIERS)("a %s bullet the shield soaks", (tier) => {
    const s = hit((b) => ({ enemyBullets: [shotOf(b, { tier })] }), "shield");
    expect(grid(s)).toEqual({ [tier]: { shield: 1 } });
    expect(s.waveStats.damage.hits.bullet.shield).toBe(1);
  });

  it("a Carrier twin laser restored without a stamp is a Carrier hit (its `source`)", () => {
    const s = hit((b) => ({ enemyBullets: [shotOf(b, { source: "carrier" })] }));
    expect(grid(s)).toEqual({ Carrier: { life: 1 } });
  });

  it("D6: a bullet with no tier (an older save's) is counted in no tier", () => {
    const s = hit((b) => ({ enemyBullets: [shotOf(b, {})] }));
    expect(grid(s)).toEqual({});
    expect(s.waveStats.damage.hits.bullet.life).toBe(1);
  });

  it("a tier that isn't one (another build's) is read as none", () => {
    const odd = { tier: "Drone" } as unknown as Parameters<typeof enemyShot>[2];
    expect(bulletTier(enemyShot(0, 0, odd))).toBeNull();
    expect(bulletTier(enemyShot(0, 0, { tier: "Elite" }))).toBe("Elite");
  });

  it("D5: several bullets on one tick cost one life, charged to the first in array order", () => {
    const s = hit((b) => ({
      enemyBullets: [shotOf(b, { tier: "Guardian" }), shotOf(b, { tier: "Grunt" })],
    }));
    expect(grid(s)).toEqual({ Guardian: { life: 1 } });
    expect(s.waveStats.damage.hits.bullet.life).toBe(1);
  });

  it("D5: …and one plate the same way", () => {
    const s = hit(
      (b) => ({ enemyBullets: [shotOf(b, { tier: "Elite" }), shotOf(b, { tier: "Carrier" })] }),
      "plating"
    );
    expect(grid(s)).toEqual({ Elite: { plating: 1 } });
  });

  it("the shield charges each soaked bullet to its own tier", () => {
    const s = hit(
      (b) => ({
        enemyBullets: [
          shotOf(b, { tier: "Guardian" }),
          shotOf(b, { tier: "Grunt" }),
          shotOf(b, { tier: "Grunt" }),
          shotOf(b, {}), // no tier: soaked, counted in none
        ],
      }),
      "shield"
    );
    expect(grid(s)).toEqual({ Guardian: { shield: 1 }, Grunt: { shield: 2 } });
    expect(s.waveStats.damage.hits.bullet.shield).toBe(4);
  });
});

describe("rams, beams and rocks", () => {
  it.each(["Grunt", "Elite", "Guardian"] as const)("a %s ram is charged to the rammer", (tier) => {
    const s = collide(rammer(tier));
    expect(grid(s)).toEqual({ [tier]: { life: 1 } });
    expect(s.waveStats.damage.hits.ram.life).toBe(1);
  });

  it("a ram that costs a plate", () => {
    const s = rammer("Elite");
    const out = collide({ ...s, player: { ...s.player, hull: 1 } });
    expect(grid(out)).toEqual({ Elite: { plating: 1 } });
  });

  it("a ram beside a shield-soaked Guardian bullet: the ram takes the life, the bullet the shield", () => {
    const s = rammer("Grunt");
    const out = collide({
      ...s,
      enemyBullets: [shotOf(s, { tier: "Guardian" })],
      activePowerUp: { ...SHIELD },
    });
    expect(grid(out)).toEqual({ Guardian: { shield: 1 }, Grunt: { life: 1 } });
  });

  it("a beam is the Carrier's: life, plating and shield", () => {
    const beam = (b: StarSwarmState) => ({ carrierBeams: [makeBeam(b.player.x, b.player.y)] });
    expect(grid(hit(beam))).toEqual({ Carrier: { life: 1 } });
    expect(grid(hit(beam, "plating"))).toEqual({ Carrier: { plating: 1 } });
    expect(grid(hit(beam, "shield"))).toEqual({ Carrier: { shield: 1 } });
  });

  it("a rock has no tier: it is in `hits.rock` and nowhere in the grid", () => {
    const small = (b: StarSwarmState) => ({
      asteroids: [rock("small", b.player.x, b.player.y)],
    });
    for (const ward of ["life", "plating", "shield"] as const) {
      const s = hit(small, ward);
      expect(grid(s)).toEqual({});
      expect(s.waveStats.damage.hits.rock[ward]).toBe(1);
    }
  });

  it("a rock beside a Guardian bullet: one life, charged to the rock's cause (no tier)", () => {
    const s = hit((b) => ({
      asteroids: [rock("small", b.player.x, b.player.y)],
      enemyBullets: [shotOf(b, { tier: "Guardian" })],
    }));
    expect(grid(s)).toEqual({});
    expect(s.waveStats.damage.hits.rock.life).toBe(1);
  });
});

describe("the stamp", () => {
  /** Every enemy bullet seen over a seeded run of `wave`, with the tiers of the ships on screen. */
  function shotsOf(wave: number, ticks: number) {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, wave, 42, "Commander");
    const seen = new Map<number, EnemyTier | undefined>();
    const flak = new Set<number>();
    for (let i = 0; i < ticks && s.phase !== "GameOver"; i++) {
      s = tick(s, 16, { playerX: 60 + ((i * 3) % 240), fire: true });
      for (const b of s.enemyBullets) {
        seen.set(b.id, b.tier);
        if (b.flak) flak.add(b.id);
      }
    }
    return { seen, flak };
  }

  it("every enemy shot of a seeded run carries its shooter's tier", () => {
    const { seen } = shotsOf(1, 1500);
    expect(seen.size).toBeGreaterThan(0);
    for (const tier of seen.values()) expect(ENEMY_TIERS).toContain(tier);
  });

  it("…the Carrier's twin lasers too (wave 5)", () => {
    const { seen } = shotsOf(5, 2500);
    expect([...seen.values()]).toContain("Carrier");
    for (const tier of seen.values()) expect(ENEMY_TIERS).toContain(tier);
  });

  it("a player shot has no tier", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Commander");
    let fired = 0;
    for (let i = 0; i < 600; i++) {
      s = tick(s, 16, { playerX: 160, fire: true });
      for (const b of s.playerBullets) {
        fired++;
        expect(b.tier).toBeUndefined();
      }
    }
    expect(fired).toBeGreaterThan(0);
  });
});

describe("the invariant, over a seeded run (the issue's AC)", () => {
  it("per result: Σ tiers + rock = Σ causes, in every closed wave", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 7, "Commander");
    const waves: WaveStatsSnapshot[] = [];
    for (let i = 0; i < 6000 && s.phase !== "GameOver"; i++) {
      const before = s.closedWaves.length;
      s = tick(s, 16, { playerX: 60 + ((i * 7) % 240), fire: i % 5 !== 0 });
      if (s.closedWaves.length > before && s.lastClosedWave) waves.push(s.lastClosedWave);
    }
    waves.push(snap(s));
    let hits = 0;
    for (const w of waves) {
      for (const r of HIT_RESULTS) {
        const byTier = ENEMY_TIERS.reduce((n, t) => n + w.damage.hitsByTier[t][r], 0);
        const byCause = HIT_CAUSES.reduce((n, c) => n + w.damage.hits[c][r], 0);
        expect(byTier + w.damage.hits.rock[r]).toBe(byCause);
        hits += byCause;
      }
    }
    expect(hits).toBeGreaterThan(0); // the run was hit, so the invariant is not 0 = 0
  });
});

describe("the wire form and its size", () => {
  const hitSnapshot = (): WaveStatsSnapshot => {
    const s = hit((b) => ({ enemyBullets: [shotOf(b, { tier: "Guardian" })] }));
    return snap(s);
  };

  it("is sparse: a wave with no hits sends no hitsByTier", () => {
    const wire = toWirePayload(snap(arena()));
    expect(wire.damage).not.toHaveProperty("hitsByTier");
  });

  it("sends only the nonzero cells", () => {
    expect(toWirePayload(hitSnapshot()).damage.hitsByTier).toEqual({ Guardian: { life: 1 } });
  });

  it("v stays 2 (additive)", () => {
    expect(toWirePayload(hitSnapshot()).v).toBe(2);
  });

  it("worst case: 12 cells at 99,999 add 236 bytes, and the wave still fits its cap", () => {
    const base = snap(arena());
    const full = {
      ...base,
      damage: {
        ...base.damage,
        hitsByTier: Object.fromEntries(
          ENEMY_TIERS.map((t) => [t, Object.fromEntries(HIT_RESULTS.map((r) => [r, 99_999]))])
        ),
      },
    } as WaveStatsSnapshot;
    const size = (w: WaveStatsSnapshot) => JSON.stringify(toWirePayload(w)).length;
    const wire = toWirePayload(full).damage.hitsByTier;
    expect(JSON.stringify({ hitsByTier: wire }).length - 1).toBe(236);
    expect(size(full) - size(base)).toBe(236);
    expect(size(full)).toBeLessThanOrEqual(WAVE_STATS_MAX_BYTES);
  });
});

describe("the paused-run save", () => {
  const playing = () => tick(initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Commander"), 16, NO_INPUT);

  it("adds nothing to the save fingerprint (the key is left out of the spec)", () => {
    const bullet = (JSON.parse(SAVE_FINGERPRINT) as Record<string, Record<string, string>>).BULLET!;
    expect(bullet).not.toHaveProperty("tier");
    expect(bullet).toHaveProperty("source");
    expect(SAVE_FINGERPRINT).not.toContain("hitsByTier");
  });

  it("a save with a tiered enemy bullet fits, and one without a tier does too", () => {
    const s = playing();
    const withTier = { ...s, enemyBullets: [enemyShot(10, 10, { tier: "Elite" })] };
    const without = { ...s, enemyBullets: [enemyShot(10, 10, {})] };
    for (const v of [withTier, without]) {
      expect(fitsSaveShape(JSON.parse(JSON.stringify(v)))).toBe(true);
    }
  });

  it("a stamped bullet round-trips; an unknown key on a bullet still does not fit", () => {
    const s = { ...playing(), enemyBullets: [enemyShot(10, 10, { tier: "Guardian" })] };
    const saved = JSON.parse(JSON.stringify(s)) as StarSwarmState;
    expect(restoreSavedState(saved).enemyBullets[0]!.tier).toBe("Guardian");
    const junk = { ...saved, enemyBullets: [{ ...saved.enemyBullets[0]!, bogus: 1 }] };
    expect(fitsSaveShape(junk)).toBe(false);
  });

  it("a save's wave stats from before the field restore with zeros, nothing else lost", () => {
    const s = hit((b) => ({ enemyBullets: [shotOf(b, { tier: "Grunt" })] }));
    const saved = JSON.parse(JSON.stringify(s)) as StarSwarmState;
    const { hitsByTier: _t, ...olderDamage } = saved.waveStats.damage;
    const older = { ...saved, waveStats: { ...saved.waveStats, damage: olderDamage } };
    expect(fitsSaveShape(older)).toBe(true);
    const restored = restoreSavedState(older as unknown as StarSwarmState);
    expect(restored.waveStats.damage.hits.bullet.life).toBe(1); // kept, not started over
    expect(restored.waveStats.damage.hitsByTier).toEqual(
      emptyWaveStats({ lives: 0, guns: 1, hull: 0 }).damage.hitsByTier
    );
  });

  it("a current save keeps the grid", () => {
    const s = hit((b) => ({ enemyBullets: [shotOf(b, { tier: "Grunt" })] }));
    const saved = JSON.parse(JSON.stringify(s)) as StarSwarmState;
    expect(restoreSavedState(saved).waveStats.damage.hitsByTier.Grunt.life).toBe(1);
  });

  it("a saved closed wave with the grid restores (counts only), one without it too", () => {
    const s = hit((b) => ({ enemyBullets: [shotOf(b, { tier: "Grunt" })] }));
    const wire = toWirePayload(snap(s));
    expect(wire.damage.hitsByTier).toEqual({ Grunt: { life: 1 } });
    const { hitsByTier: _g, ...noGrid } = wire.damage;
    for (const damage of [wire.damage, noGrid]) {
      const saved = JSON.parse(
        JSON.stringify({ ...playing(), closedWaves: [{ ...wire, damage }] })
      ) as StarSwarmState;
      expect(fitsSaveShape(saved)).toBe(true);
      expect(restoreSavedState(saved).closedWaves).toHaveLength(1);
    }
  });

  it("withSavedHitsByTier leaves anything it can't fill for isWaveStats to judge", () => {
    expect(withSavedHitsByTier(null)).toBeNull();
    expect(withSavedHitsByTier([])).toEqual([]);
    const has = { damage: { hitsByTier: {} } };
    expect(withSavedHitsByTier(has)).toBe(has);
    const noDamage = { pacing: {} };
    expect(withSavedHitsByTier(noDamage)).toBe(noDamage);
  });
});

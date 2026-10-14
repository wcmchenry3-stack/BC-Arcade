/**
 * Star Swarm per-wave rock counters (#3247): spawns (timed and dev), who broke each rock, the
 * ships rocks struck and destroyed by tier, rocks on the player and on Buddy, and the per-wave
 * dodge table. See docs/games/starswarm.md#per-wave-stats.
 */
import {
  BUDDY_ROCK_DAMAGE,
  ENEMY_TIERS,
  _resetIds,
  applyPowerUp,
  emptyTierStats,
  throwAsteroid,
  tick,
} from "../engine";
import type { EnemyTier, StarSwarmState, TierStats } from "../types";
import { NO_INPUT } from "./helpers/engineFixtures";
import {
  OPEN,
  arena,
  buddyAt,
  buddyShot,
  collide,
  enemyShot,
  lone,
  pickupOnShip,
  rock,
  shot,
} from "./helpers/waveStatsScenarios";

beforeEach(() => _resetIds());

const rocksOf = (s: StarSwarmState) => s.waveStats.rocks;

describe("rocks.spawned / devSpawned", () => {
  it("counts every timed spawn by kind, matching the run's rocksSpawned", () => {
    let s: StarSwarmState = { ...arena(2), asteroidsDisabled: false };
    s = { ...s, player: { ...s.player, invincibleTimer: 1e9 } };
    for (let i = 0; i < 6000 && s.runStats.rocksSpawned < 3; i++) s = tick(s, 16, NO_INPUT);
    expect(s.runStats.rocksSpawned).toBeGreaterThanOrEqual(3);
    const { spawned, devSpawned } = rocksOf(s);
    expect(spawned.large + spawned.small).toBe(s.runStats.rocksSpawned);
    expect(devSpawned).toBe(0);
  });

  it("a dev throw counts in spawned[kind] and in devSpawned", () => {
    let s = throwAsteroid(arena(), "large");
    s = throwAsteroid(s, "small");
    expect(rocksOf(s).spawned).toEqual({ large: 1, small: 1 });
    expect(rocksOf(s).devSpawned).toBe(2);
    expect(s.runStats.rocksSpawned).toBe(2);
  });
});

describe("rocks.broken by breaker", () => {
  it("player: a player shot (or one of Buddy's) that finishes a rock", () => {
    const s = arena();
    const a = rock("large", OPEN.x, OPEN.y, { hp: 1 });
    const b = rock("large", OPEN.x + 300, OPEN.y, { hp: 1 });
    const out = collide({
      ...s,
      asteroids: [a, b],
      playerBullets: [shot(a.x, a.y), buddyShot(b.x, b.y)],
    });
    expect(rocksOf(out).broken).toEqual({ player: 2, enemy: 0, bomb: 0, contact: 0 });
    expect(out.runStats.rocksBrokenByPlayer).toBe(2);
  });

  it("a chip that doesn't break the rock counts nothing", () => {
    const s = arena();
    const a = rock("large", OPEN.x, OPEN.y);
    const out = collide({ ...s, asteroids: [a], playerBullets: [shot(a.x, a.y)] });
    expect(rocksOf(out).broken.player).toBe(0);
  });

  it("enemy: an enemy shot or flak that finishes a rock", () => {
    const s = arena();
    const a = rock("small", OPEN.x, OPEN.y, { hp: 1 });
    const b = rock("small", OPEN.x + 300, OPEN.y, { hp: 1 });
    const out = collide({
      ...s,
      asteroids: [a, b],
      enemyBullets: [enemyShot(a.x, a.y), enemyShot(b.x, b.y, { flak: true })],
    });
    expect(rocksOf(out).broken.enemy).toBe(2);
    expect(out.runStats.rocksBrokenByEnemy).toBe(2);
  });

  it("bomb: every rock still whole when a collected bomb goes off", () => {
    const s = arena();
    const out = collide({
      ...s,
      powerUps: [pickupOnShip(s, "bomb")],
      asteroids: [rock("large", OPEN.x, OPEN.y), rock("small", OPEN.x + 300, OPEN.y)],
    });
    expect(rocksOf(out).broken.bomb).toBe(2);
  });

  it("bomb: a rock a shot broke earlier in the same pass is the shot's, not the bomb's", () => {
    const s = arena();
    const a = rock("large", OPEN.x, OPEN.y, { hp: 1 });
    const out = collide({
      ...s,
      powerUps: [pickupOnShip(s, "bomb")],
      asteroids: [a, rock("small", OPEN.x + 300, OPEN.y)],
      playerBullets: [shot(a.x, a.y)],
    });
    expect(rocksOf(out).broken).toEqual({ player: 1, enemy: 0, bomb: 1, contact: 0 });
  });

  it("bomb: the dev panel's bomb clears every rock on screen", () => {
    const s = arena();
    const out = applyPowerUp(
      { ...s, asteroids: [rock("large", OPEN.x, OPEN.y), rock("small", 300, OPEN.y)] },
      "bomb"
    );
    expect(rocksOf(out).broken.bomb).toBe(2);
  });

  it("contact: a rock that shatters on the hull", () => {
    const s = arena();
    const out = collide({ ...s, asteroids: [rock("large", s.player.x, s.player.y)] });
    expect(rocksOf(out).broken.contact).toBe(1);
  });

  it("contact: a small rock that shatters on a ship; a large one flies on unbroken", () => {
    const { state, ship } = lone(arena(), "Grunt", { hp: 5 });
    const small = collide({ ...state, asteroids: [rock("small", ship.x, ship.y)] });
    expect(rocksOf(small).broken.contact).toBe(1);
    const large = collide({ ...state, asteroids: [rock("large", ship.x, ship.y)] });
    expect(rocksOf(large).broken.contact).toBe(0);
    expect(large.asteroids).toHaveLength(1);
  });

  it("contact: any rock that shatters on the escorted Carrier's field (a deflect, not a strike)", () => {
    const { state, ship } = lone(arena(), "Carrier", {}, true);
    const out = collide({ ...state, asteroids: [rock("large", ship.x, ship.y)] });
    expect(rocksOf(out).broken.contact).toBe(1);
    expect(rocksOf(out).enemiesStruck.Carrier).toBe(0);
    expect(out.runStats.armorDeflects).toBe(state.runStats.armorDeflects + 1);
  });

  it("contact: a small rock that shatters on Buddy", () => {
    const s = arena();
    const out = collide({
      ...s,
      buddyShips: [buddyAt(s, OPEN.x, OPEN.y, 9)],
      asteroids: [rock("small", OPEN.x, OPEN.y)],
    });
    expect(rocksOf(out).broken.contact).toBe(1);
  });
});

describe("rocks.enemiesStruck / enemiesDestroyed", () => {
  it.each(ENEMY_TIERS.map((t) => [t] as const))(
    "%s: a strike that kills counts struck, destroyed and a rock kill",
    (tier: EnemyTier) => {
      const { state, ship } = lone(arena(), tier, { hp: 1 });
      const out = collide({ ...state, asteroids: [rock("small", ship.x, ship.y)] });
      const r = rocksOf(out);
      expect(r.enemiesStruck[tier]).toBe(1);
      expect(r.enemiesDestroyed[tier]).toBe(1);
      expect(out.waveStats.combat.kills[tier].rock).toBe(1);
      expect(out.tierStats[tier].struck).toBe(state.tierStats[tier].struck + 1);
    }
  );

  it.each(ENEMY_TIERS.map((t) => [t] as const))(
    "%s: a strike the ship survives counts struck only",
    (tier: EnemyTier) => {
      const { state, ship } = lone(arena(), tier, { hp: 5 });
      const out = collide({ ...state, asteroids: [rock("large", ship.x, ship.y)] });
      const r = rocksOf(out);
      expect(r.enemiesStruck[tier]).toBe(1);
      expect(r.enemiesDestroyed[tier]).toBe(0);
      expect(out.waveStats.combat.kills[tier].rock).toBe(0);
      expect(out.enemies.find((e) => e.id === ship.id)!.hp).toBe(4);
    }
  );
});

describe("rocks.playerHits", () => {
  it("shield, plating and life — each also a damage hit with cause rock", () => {
    const base = arena();
    const onHull = (s: StarSwarmState) =>
      collide({ ...s, asteroids: [rock("small", s.player.x, s.player.y)] });
    const shielded = onHull({
      ...base,
      activePowerUp: { type: "shield", remainingMs: 5000, shieldAbsorbed: 0 },
    });
    const plated = onHull({ ...base, player: { ...base.player, hull: 1 } });
    const bare = onHull(base);
    expect(rocksOf(shielded).playerHits).toEqual({ life: 0, plating: 0, shield: 1 });
    expect(rocksOf(plated).playerHits).toEqual({ life: 0, plating: 1, shield: 0 });
    expect(rocksOf(bare).playerHits).toEqual({ life: 1, plating: 0, shield: 0 });
    for (const s of [shielded, plated, bare]) {
      expect(s.waveStats.damage.hits.rock).toEqual(rocksOf(s).playerHits);
    }
  });
});

describe("rocks.buddyHits / buddyDestroyed", () => {
  it("a rock Buddy survives is a hit; one that takes its last HP also destroys it", () => {
    const s = arena();
    const hit = collide({
      ...s,
      buddyShips: [buddyAt(s, OPEN.x, OPEN.y, BUDDY_ROCK_DAMAGE + 1)],
      asteroids: [rock("large", OPEN.x, OPEN.y)],
    });
    expect([rocksOf(hit).buddyHits, rocksOf(hit).buddyDestroyed]).toEqual([1, 0]);
    expect(hit.waveStats.buddy.hits.rock).toBe(1);

    const lost = collide({
      ...s,
      buddyShips: [buddyAt(s, OPEN.x, OPEN.y, BUDDY_ROCK_DAMAGE)],
      asteroids: [rock("large", OPEN.x, OPEN.y)],
    });
    expect([rocksOf(lost).buddyHits, rocksOf(lost).buddyDestroyed]).toEqual([1, 1]);
    expect(lost.waveStats.buddy.destroyed.rock).toBe(1);
    expect(lost.runStats.buddyLost).toBe(1);
  });
});

describe("rocks.dodge", () => {
  const FIELDS = ["rolls", "dodged", "pathRolls", "pathDodged", "flak"] as const;
  const delta = (a: TierStats, b: TierStats, f: (typeof FIELDS)[number]) => b[f] - a[f];

  it("mirrors every tierStats dodge and flak bump into the wave's table", () => {
    let s: StarSwarmState = arena(3);
    s = {
      ...s,
      enemyFireDisabled: false,
      nextDiveTimer: 500,
      tierStats: emptyTierStats(),
      player: { ...s.player, invincibleTimer: 1e9 },
    };
    const start = s.tierStats;
    for (let i = 0; i < 1500 && s.phase === "Playing"; i++) {
      if (s.asteroids.length < 2) s = throwAsteroid(s);
      s = tick(s, 16, NO_INPUT);
      s = { ...s, player: { ...s.player, invincibleTimer: 1e9 } };
    }
    let rolls = 0;
    for (const tier of ENEMY_TIERS) {
      for (const f of FIELDS) {
        expect(rocksOf(s).dodge[tier][f]).toBe(delta(start[tier], s.tierStats[tier], f));
      }
      rolls += rocksOf(s).dodge[tier].rolls;
    }
    expect(rolls).toBeGreaterThan(0);
  });
});

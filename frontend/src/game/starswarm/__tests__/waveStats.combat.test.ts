/**
 * Star Swarm per-wave combat, damage and Buddy counters (#3248): spawns, kills by tier × method,
 * shots fired / hit / spent on rocks, hits on the player by cause × result (the multi-hit rule),
 * the death cause, and Buddy's launches, hits, losses, drawn fire and kills — plus the
 * invariants a seeded multi-wave run must hold. See docs/games/starswarm.md#per-wave-stats.
 */
import {
  BUDDY_BEAM_DAMAGE,
  CANVAS_H,
  CANVAS_W,
  ENEMY_TIERS,
  KILL_METHODS,
  _resetIds,
  applyPowerUp,
  emptyTierStats,
  initStarSwarm,
  throwAsteroid,
  tick,
  waveJustClosed,
  type WaveStats,
  type WaveStatsSnapshot,
} from "../engine";
import { resolveBuddyHits } from "../engine/buddy";
import { bonusLifeThreshold } from "../engine/tuning";
import { killMethod, scoreSource } from "../scoreLedger";
import type { EnemyTier, StarSwarmInput, StarSwarmState } from "../types";
import { FIRE_INPUT, NO_INPUT, makeBeam } from "./helpers/engineFixtures";
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

const SHIPS = ["Grunt", "Elite", "Guardian"] as const; // the tiers that leave formation
const killsOf = (s: StarSwarmState, tier: EnemyTier) => s.waveStats.combat.kills[tier];
const SHIELD = { type: "shield", remainingMs: 5000, shieldAbsorbed: 0 } as const;

/** A ram-eligible diving ship of `tier` on the ship, every tier's ram latch open. */
function rammer(tier: EnemyTier, base = arena()) {
  const { state, ship } = lone(base, tier, { phase: "Diving" });
  const placed = { ...ship, x: state.player.x, y: state.player.y };
  return {
    ...state,
    guardianThresholdCrossed: true,
    guardianDeepThresholdCrossed: true,
    enemies: state.enemies.map((e) => (e.id === ship.id ? placed : e)),
  };
}

describe("killMethod (next to scoreSource)", () => {
  it("is the ledger modifier where there is one, else shot — rock and Buddy say who", () => {
    expect(killMethod(undefined)).toBe("shot");
    for (const mod of ["dive", "rout", "bomb", "ram"] as const) {
      expect(killMethod(mod)).toBe(mod);
      expect(scoreSource("Elite", mod)).toBe(`Elite:${mod}`);
    }
    expect(killMethod("dive", "buddy")).toBe("buddy");
    expect(killMethod(undefined, "rock")).toBe("rock");
  });
});

describe("combat.spawned", () => {
  it("counts the roster the wave opens with, by tier", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Commander");
    const roster = { Grunt: 0, Elite: 0, Guardian: 0, Carrier: 0 };
    for (const e of s.enemies) roster[e.tier]++;
    expect(s.waveStats.combat.spawned).toEqual(roster);
  });

  it("adds the Carrier's reinforcements as Grunts, matching runStats.reinforced", () => {
    const s0 = arena();
    let gone = 0;
    const enemies = s0.enemies.map((e) =>
      e.tier === "Grunt" && gone++ < 6 ? { ...e, isAlive: false, hp: 0 } : e
    );
    const before = s0.waveStats.combat.spawned.Grunt;
    const s = tick({ ...s0, enemies, reinforceTimer: 0 }, 16, NO_INPUT);
    const launched = s.runStats.reinforced - s0.runStats.reinforced;
    expect(launched).toBeGreaterThan(0);
    expect(s.waveStats.combat.spawned.Grunt).toBe(before + launched);
  });
});

describe("combat.kills[tier][method]", () => {
  it.each(ENEMY_TIERS.map((t) => [t] as const))("%s: shot in formation", (tier) => {
    const { state, ship } = lone(arena(), tier, { hp: 1 });
    const out = collide({ ...state, playerBullets: [shot(ship.x, ship.y)] });
    expect(killsOf(out, tier)).toMatchObject({ shot: 1 });
    expect(out.waveStats.buddy.kills[tier]).toBe(0);
  });

  it.each(SHIPS.map((t) => [t] as const))("%s: shot while diving", (tier) => {
    const { state, ship } = lone(arena(), tier, { hp: 1, phase: "Diving" });
    const out = collide({ ...state, playerBullets: [shot(ship.x, ship.y)] });
    expect(killsOf(out, tier).dive).toBe(1);
  });

  it("Grunt: shot while fleeing the rout", () => {
    const { state, ship } = lone(arena(), "Grunt", { hp: 1, phase: "Fleeing" });
    const out = collide({ ...state, playerBullets: [shot(ship.x, ship.y)] });
    expect(killsOf(out, "Grunt").rout).toBe(1);
  });

  it.each(ENEMY_TIERS.map((t) => [t] as const))("%s: Smart Bomb", (tier) => {
    const { state } = lone(arena(), tier, { hp: 1 });
    const out = collide({ ...state, powerUps: [pickupOnShip(state, "bomb")] });
    expect(killsOf(out, tier).bomb).toBe(1);
  });

  it("the dev panel's bomb counts its kills too", () => {
    const { state } = lone(arena(), "Elite", { hp: 1 });
    expect(killsOf(applyPowerUp(state, "bomb"), "Elite").bomb).toBe(1);
  });

  it.each(SHIPS.map((t) => [t] as const))("%s: rammed the ship", (tier) => {
    const out = collide(rammer(tier));
    expect(killsOf(out, tier).ram).toBe(1);
    expect(out.waveStats.damage.hits.ram.life).toBe(1);
  });

  it.each(ENEMY_TIERS.map((t) => [t] as const))("%s: Buddy's shot", (tier) => {
    const { state, ship } = lone(arena(), tier, { hp: 1, phase: "Diving" });
    const out = collide({ ...state, playerBullets: [buddyShot(ship.x, ship.y)] });
    expect(killsOf(out, tier).buddy).toBe(1);
    expect(killsOf(out, tier).dive).toBe(0);
    expect(out.waveStats.buddy.kills[tier]).toBe(1);
    // the kill still scores under the shot's ledger source
    expect(out.score).toBeGreaterThan(state.score);
  });

  it("a non-lethal hit and a field deflect kill nothing", () => {
    const { state, ship } = lone(arena(), "Carrier", {}, true);
    const out = collide({ ...state, playerBullets: [shot(ship.x, ship.y)] });
    for (const m of KILL_METHODS) expect(killsOf(out, "Carrier")[m]).toBe(0);
  });
});

describe("combat.shotsFired / shotsHit / shotsOnRocks", () => {
  it("shotsFired counts every bullet a trigger pull spawns", () => {
    const s = arena();
    const out = tick({ ...s, player: { ...s.player, guns: 3, shootCooldown: 0 } }, 16, FIRE_INPUT);
    expect(out.playerBullets).toHaveLength(4);
    expect(out.waveStats.combat.shotsFired).toBe(4);
  });

  it("shotsHit: a shot that damages a ship, lethal or not", () => {
    const { state, ship } = lone(arena(), "Guardian", { hp: 5 });
    const out = collide({ ...state, playerBullets: [shot(ship.x, ship.y)] });
    expect(out.waveStats.combat.shotsHit).toBe(1);
  });

  it("shotsHit: a piercing shot counts once, however many ships it goes through", () => {
    const s = arena();
    const [a, b] = s.enemies.filter((e) => e.isAlive && e.tier === "Grunt");
    const wide = shot((a!.x + b!.x) / 2, a!.y, {
      width: Math.abs(a!.x - b!.x) + 10,
      height: 4,
      piercing: true,
      armorPiercing: true,
      damage: 5,
    });
    if (a!.y !== b!.y) throw new Error("expected two grunts on one row");
    const once = collide({ ...s, playerBullets: [wide] });
    expect(
      once.enemies.filter((e) => !e.isAlive && (e.id === a!.id || e.id === b!.id))
    ).toHaveLength(2);
    expect(once.waveStats.combat.shotsHit).toBe(1);
    // the same shot, already counted, adds nothing on a later ship
    const later = collide({ ...s, playerBullets: [{ ...wide, hitEnemyIds: [999] }] });
    expect(later.waveStats.combat.shotsHit).toBe(0);
  });

  it("a field deflect is not a hit; Buddy's shots aren't the player's", () => {
    const { state, ship } = lone(arena(), "Carrier", {}, true);
    const deflected = collide({ ...state, playerBullets: [shot(ship.x, ship.y)] });
    expect(deflected.waveStats.combat.shotsHit).toBe(0);
    const g = lone(arena(), "Grunt", { hp: 5 });
    const buddys = collide({ ...g.state, playerBullets: [buddyShot(g.ship.x, g.ship.y)] });
    expect(buddys.waveStats.combat.shotsHit).toBe(0);
  });

  it("shotsOnRocks: the player's shots spent on rocks (not Buddy's)", () => {
    const s = arena();
    const a = rock("large", OPEN.x, OPEN.y);
    const out = collide({
      ...s,
      asteroids: [a],
      playerBullets: [shot(a.x, a.y), shot(a.x, a.y), buddyShot(a.x, a.y)],
    });
    expect(out.waveStats.combat.shotsOnRocks).toBe(2);
    expect(out.waveStats.combat.shotsHit).toBe(0);
  });
});

describe("damage.hits[cause][result]", () => {
  const hitWith = (patch: (s: StarSwarmState) => Partial<StarSwarmState>, setup = arena()) =>
    collide({ ...setup, ...patch(setup) });
  const bullet = (s: StarSwarmState) => ({ enemyBullets: [enemyShot(s.player.x, s.player.y)] });
  const rockOn = (s: StarSwarmState) => ({ asteroids: [rock("small", s.player.x, s.player.y)] });
  const beam = (s: StarSwarmState) => ({ carrierBeams: [makeBeam(s.player.x, s.player.y)] });
  const shielded = (s: StarSwarmState) => ({ ...s, activePowerUp: SHIELD });
  const plated = (s: StarSwarmState) => ({ ...s, player: { ...s.player, hull: 1 as const } });

  it.each([
    ["bullet", bullet],
    ["rock", rockOn],
    ["beam", beam],
  ] as const)("%s: shield, plating, life", (cause, what) => {
    expect(hitWith(what, shielded(arena())).waveStats.damage.hits[cause]).toEqual({
      life: 0,
      plating: 0,
      shield: 1,
    });
    expect(hitWith(what, plated(arena())).waveStats.damage.hits[cause]).toEqual({
      life: 0,
      plating: 1,
      shield: 0,
    });
    const bare = hitWith(what);
    expect(bare.waveStats.damage.hits[cause]).toEqual({ life: 1, plating: 0, shield: 0 });
    expect(bare.player.lives).toBe(2);
  });

  it("ram: plating or life — the shield never takes a ram", () => {
    expect(collide(plated(rammer("Grunt"))).waveStats.damage.hits.ram).toEqual({
      life: 0,
      plating: 1,
      shield: 0,
    });
    expect(collide(shielded(rammer("Grunt"))).waveStats.damage.hits.ram).toEqual({
      life: 1,
      plating: 0,
      shield: 0,
    });
  });

  it("multi-hit: everything landing on one tick costs one life, charged beam > rock > bullet", () => {
    const s = arena();
    const all = {
      ...s,
      // the shots left of centre, the rock right of it, so neither is spent on the other
      enemyBullets: [enemyShot(s.player.x - 5, s.player.y), enemyShot(s.player.x - 3, s.player.y)],
      asteroids: [rock("small", s.player.x + 15, s.player.y)],
      carrierBeams: [makeBeam(s.player.x, s.player.y)],
    };
    const bare = collide(all);
    expect(bare.player.lives).toBe(2);
    const hits = bare.waveStats.damage.hits;
    expect([hits.beam.life, hits.rock.life, hits.bullet.life]).toEqual([1, 0, 0]);
    expect(bare.waveStats.rocks.playerHits.life).toBe(0); // the rock shattered, but cost nothing
    expect(bare.waveStats.rocks.broken.contact).toBe(1);

    const noBeam = collide({ ...all, carrierBeams: [] });
    expect([
      noBeam.waveStats.damage.hits.rock.life,
      noBeam.waveStats.damage.hits.bullet.life,
    ]).toEqual([1, 0]);

    // the shield takes each projectile: one shield hit per bullet, rock and beam
    const kept = collide(shielded(all));
    expect(kept.player.lives).toBe(3);
    const k = kept.waveStats.damage.hits;
    expect([k.bullet.shield, k.rock.shield, k.beam.shield]).toEqual([2, 1, 1]);
    expect(kept.activePowerUp!.shieldAbsorbed).toBe(3); // bullets and the rock, not the beam
  });

  it("an invincible ship takes no hits", () => {
    const s = arena();
    const out = collide({ ...s, ...bullet(s), player: { ...s.player, invincibleTimer: 500 } });
    expect(out.waveStats.damage.hits.bullet).toEqual({ life: 0, plating: 0, shield: 0 });
  });
});

describe("damage.deathCause", () => {
  it.each([
    ["rock", (s: StarSwarmState) => ({ asteroids: [rock("small", s.player.x, s.player.y)] })],
    ["beam", (s: StarSwarmState) => ({ carrierBeams: [makeBeam(s.player.x, s.player.y)] })],
  ] as const)("%s took the last life: the died wave says so", (cause, what) => {
    const s = arena();
    const last = { ...s, ...what(s), player: { ...s.player, lives: 1 } };
    const over = tick(last, 16, NO_INPUT);
    expect(over.phase).toBe("GameOver");
    expect(over.lastClosedWave!.outcome).toBe("died");
    expect(over.lastClosedWave!.damage.deathCause).toBe(cause);
  });

  it("ram took the last life", () => {
    const s = rammer("Grunt");
    const over = collide({ ...s, player: { ...s.player, lives: 1 } });
    expect(over.waveStats.damage.deathCause).toBe("ram");
  });

  it("a life lost that isn't the last leaves it null", () => {
    const s = arena();
    expect(
      collide({ ...s, enemyBullets: [enemyShot(s.player.x, s.player.y)] }).waveStats.damage
        .deathCause
    ).toBeNull();
  });

  it("a same-tick bonus life that rescues the ship clears it again", () => {
    const { state, ship } = lone(arena(), "Grunt", { hp: 1 });
    const threshold = bonusLifeThreshold(state.difficulty);
    const s: StarSwarmState = {
      ...state,
      score: threshold - 1,
      bonusLivesAwarded: 0,
      player: { ...state.player, lives: 1 },
      playerBullets: [shot(ship.x, ship.y)],
      enemyBullets: [enemyShot(state.player.x, state.player.y)],
    };
    const out = tick(s, 16, NO_INPUT);
    expect(out.phase).not.toBe("GameOver");
    expect(out.waveStats.damage.hits.bullet.life).toBe(1);
    expect(out.waveStats.damage.deathCause).toBeNull();
  });
});

describe("buddy counters", () => {
  it("launched: a collected pickup and the dev panel's launch", () => {
    const s = arena();
    const picked = collide({ ...s, powerUps: [pickupOnShip(s, "buddy")] });
    expect(picked.waveStats.buddy.launched).toBe(1);
    expect(applyPowerUp(picked, "buddy").waveStats.buddy.launched).toBe(2);
  });

  it("resolveBuddyHits reports hits by cause and charges a loss to the cause that finished it", () => {
    const s = arena();
    const b = buddyAt(s, OPEN.x, OPEN.y, 9);
    const shots = [enemyShot(OPEN.x, OPEN.y), enemyShot(OPEN.x + 1, OPEN.y)];
    const beam = makeBeam(OPEN.x, OPEN.y);
    const rocks = [rock("small", OPEN.x, OPEN.y)];
    // 2 shots (2) + a beam (3) + a rock (2) = 7 < 9: hit by all three, not lost
    const hit = resolveBuddyHits([b], shots, [beam], [...rocks], []);
    expect(hit.hits).toEqual({ bullet: 2, beam: 1, rock: 1 });
    expect(hit.destroyed).toEqual({ bullet: 0, beam: 0, rock: 0 });
    expect(hit.lost).toBe(0);
    // with 4 HP the shots (2) don't finish it; the beam (2 + 3 >= 4) does
    const byBeam = resolveBuddyHits([{ ...b, hp: 4 }], shots, [beam], [...rocks], []);
    expect(byBeam.destroyed).toEqual({ bullet: 0, beam: 1, rock: 0 });
    expect(byBeam.lost).toBe(1);
    const byShots = resolveBuddyHits([{ ...b, hp: 2 }], shots, [beam], [...rocks], []);
    expect(byShots.destroyed).toEqual({ bullet: 1, beam: 0, rock: 0 });
    const byRock = resolveBuddyHits([{ ...b, hp: 2 }], [], [], [...rocks], []);
    expect(byRock.destroyed).toEqual({ bullet: 0, beam: 0, rock: 1 });
  });

  it.each([
    ["bullet", () => ({ enemyBullets: [enemyShot(OPEN.x, OPEN.y, { damage: 1 })] }), 1],
    ["beam", () => ({ carrierBeams: [makeBeam(OPEN.x, OPEN.y)] }), BUDDY_BEAM_DAMAGE],
    ["rock", () => ({ asteroids: [rock("large", OPEN.x, OPEN.y)] }), 2],
  ] as const)("%s: hit, and destroyed when it takes the last HP", (cause, what, dmg) => {
    const s = arena();
    const hit = collide({ ...s, ...what(), buddyShips: [buddyAt(s, OPEN.x, OPEN.y, dmg + 1)] });
    expect(hit.waveStats.buddy.hits[cause]).toBe(1);
    expect(hit.waveStats.buddy.destroyed[cause]).toBe(0);
    const lost = collide({ ...s, ...what(), buddyShips: [buddyAt(s, OPEN.x, OPEN.y, dmg)] });
    expect(lost.waveStats.buddy.destroyed[cause]).toBe(1);
    expect(lost.runStats.buddyLost).toBe(1);
    expect(lost.buddyShips).toHaveLength(0);
  });

  it("shotsDrawn: the enemy shots diverted at Buddy, matching runStats.buddyShotsDrawn", () => {
    let s: StarSwarmState = { ...arena(3), enemyFireDisabled: false, nextDiveTimer: 400 };
    s = applyPowerUp(s, "buddy");
    for (let i = 0; i < 900 && s.buddyShips.length > 0; i++) {
      s = tick(s, 16, NO_INPUT);
      s = { ...s, player: { ...s.player, invincibleTimer: 1e9 } };
    }
    expect(s.runStats.buddyShotsDrawn).toBeGreaterThan(0);
    expect(s.waveStats.buddy.shotsDrawn).toBe(s.runStats.buddyShotsDrawn);
  });
});

// ---------------------------------------------------------------------------
// Seeded multi-wave invariants
// ---------------------------------------------------------------------------

interface WaveDeaths {
  readonly wave: number;
  readonly deaths: Record<EnemyTier, number>;
}

/**
 * A seeded run of several waves: the ship fires constantly and sweeps the screen, is kept alive
 * (lives topped up) so the run goes on, launches a Buddy and throws a rock now and then. Returns
 * every closed snapshot, the final state, and each wave's ship deaths by tier (alive → dead
 * between ticks, less the routed grunts that escaped).
 */
function seededRun(seed: number, waves: number) {
  let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, seed, "Commander");
  const closed: WaveStatsSnapshot[] = [];
  const deaths: WaveDeaths[] = [
    { wave: 1, deaths: { Grunt: 0, Elite: 0, Guardian: 0, Carrier: 0 } },
  ];
  const rosters: number[] = [s.enemies.length];
  for (let i = 0; i < 120_000 && closed.length < waves; i++) {
    const input: StarSwarmInput = {
      playerX: CANVAS_W / 2 + Math.sin(i / 90) * (CANVAS_W / 2 - 30),
      fire: true,
    };
    let prev = s;
    if (s.phase === "Playing" && i % 1500 === 750) prev = applyPowerUp(prev, "buddy");
    if (s.phase === "Playing" && i % 700 === 350) prev = throwAsteroid(prev);
    if (prev.player.lives < 2) prev = { ...prev, player: { ...prev.player, lives: 3 } };
    s = tick(prev, 16, input);
    const snap = waveJustClosed(prev, s);
    if (snap) closed.push(snap);
    if (s.wave !== prev.wave) {
      deaths.push({ wave: s.wave, deaths: { Grunt: 0, Elite: 0, Guardian: 0, Carrier: 0 } });
      rosters.push(s.enemies.length);
      continue;
    }
    const was = new Map(prev.enemies.map((e) => [e.id, e.isAlive] as const));
    const tally = deaths[deaths.length - 1]!.deaths;
    for (const e of s.enemies) if (was.get(e.id) && !e.isAlive) tally[e.tier]++;
    tally.Grunt -= s.runStats.routEscaped - prev.runStats.routEscaped;
    if (s.phase === "GameOver") break;
  }
  return { closed, end: s, deaths, rosters };
}

describe("seeded multi-wave invariants (#3247/#3248)", () => {
  const { closed, end, deaths, rosters } = seededRun(7, 3);
  const all: WaveStats[] = [...closed, end.waveStats];
  const sum = (f: (w: WaveStats) => number) => all.reduce((t, w) => t + f(w), 0);

  it("closes several waves", () => {
    expect(closed.length).toBe(3);
  });

  it("kills by method sum to the ships of each tier that died on the wave", () => {
    all.forEach((w, i) => {
      for (const tier of ENEMY_TIERS) {
        const byMethod = KILL_METHODS.reduce((t, m) => t + w.combat.kills[tier][m], 0);
        expect(byMethod).toBe(deaths[i]!.deaths[tier]);
      }
    });
    expect(sum((w) => w.combat.kills.Grunt.shot)).toBeGreaterThan(0);
  });

  it("shotsHit never exceeds shotsFired", () => {
    for (const w of all) expect(w.combat.shotsHit).toBeLessThanOrEqual(w.combat.shotsFired);
    expect(sum((w) => w.combat.shotsHit)).toBeGreaterThan(0);
  });

  it("the waves sum to the run-wide counters", () => {
    const rs = end.runStats;
    expect(sum((w) => w.rocks.spawned.large + w.rocks.spawned.small)).toBe(rs.rocksSpawned);
    expect(sum((w) => w.rocks.broken.player)).toBe(rs.rocksBrokenByPlayer);
    expect(sum((w) => w.rocks.broken.enemy)).toBe(rs.rocksBrokenByEnemy);
    expect(sum((w) => w.buddy.launched)).toBe(rs.buddyLaunched);
    expect(
      sum((w) => w.buddy.destroyed.bullet + w.buddy.destroyed.beam + w.buddy.destroyed.rock)
    ).toBe(rs.buddyLost);
    expect(sum((w) => w.buddy.shotsDrawn)).toBe(rs.buddyShotsDrawn);
    const spawned = sum((w) => ENEMY_TIERS.reduce((t, tier) => t + w.combat.spawned[tier], 0));
    expect(spawned).toBe(rosters.reduce((t, n) => t + n, 0) + rs.reinforced);
    const zero = emptyTierStats();
    for (const tier of ENEMY_TIERS) {
      const t = end.tierStats[tier];
      expect(sum((w) => w.rocks.enemiesStruck[tier])).toBe(t.struck - zero[tier].struck);
      for (const f of ["rolls", "dodged", "pathRolls", "pathDodged", "flak"] as const) {
        expect(sum((w) => w.rocks.dodge[tier][f])).toBe(t[f]);
      }
    }
    expect(rs.rocksSpawned).toBeGreaterThan(0);
    expect(rs.buddyLaunched).toBeGreaterThan(0);
  });
});

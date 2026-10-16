/**
 * Wave-stats contract rows: `rocks` (#3247) — spawns, who broke each rock, ships struck and
 * destroyed by tier, rocks on the player and on Buddy, the per-wave dodge table. See
 * ./contract.ts; the full unit tests are `waveStats.rocks.test.ts`.
 */
import { BUDDY_ROCK_DAMAGE, throwAsteroid, tick } from "../../engine";
import type { EnemyTier, StarSwarmState } from "../../types";
import { NO_INPUT } from "../helpers/engineFixtures";
import {
  OPEN,
  arena,
  buddyAt,
  collide,
  enemyShot,
  lone,
  pickupOnShip,
  rock,
  shot,
  snap,
} from "../helpers/waveStatsScenarios";
import { field, key, type ContractRow, type SectionContract } from "./contract";

/** A small rock on a lone ship of `tier` with 1 HP: struck and destroyed. */
function rockKill(tier: EnemyTier): ContractRow {
  return {
    id: `a rock that kills a ${tier} counts it struck and destroyed`,
    covers: [key("ENEMY_TIERS", tier)],
    scenario: () => {
      const { state, ship } = lone(arena(), tier, { hp: 1 });
      return snap(collide({ ...state, asteroids: [rock("small", ship.x, ship.y)] }));
    },
    expect: (s) => {
      expect(s.rocks.enemiesStruck[tier]).toBe(1);
      expect(s.rocks.enemiesDestroyed[tier]).toBe(1);
      expect(s.combat.kills[tier].rock).toBe(1);
    },
  };
}

const onHull = (s: StarSwarmState) =>
  collide({ ...s, asteroids: [rock("small", s.player.x, s.player.y)] });

export const contract: SectionContract<"rocks"> = {
  section: "rocks",
  pending: null,
  rows: [
    {
      id: "spawned counts each kind; devSpawned the dev throws among them",
      covers: [
        key("ASTEROID_KINDS", "large"),
        key("ASTEROID_KINDS", "small"),
        field("rocks", "spawned"),
        field("rocks", "devSpawned"),
      ],
      scenario: () => snap(throwAsteroid(throwAsteroid(arena(), "large"), "small")),
      expect: (s) => {
        expect(s.rocks.spawned).toEqual({ large: 1, small: 1 });
        expect(s.rocks.devSpawned).toBe(2);
      },
    },
    {
      id: "broken: a player shot, an enemy shot, a bomb, and a rock on the hull",
      covers: [
        key("ROCK_BREAKERS", "player"),
        key("ROCK_BREAKERS", "enemy"),
        key("ROCK_BREAKERS", "bomb"),
        key("ROCK_BREAKERS", "contact"),
        field("rocks", "broken"),
      ],
      scenario: () => {
        const s = arena();
        const a = rock("large", OPEN.x, OPEN.y, { hp: 1 });
        const b = rock("small", OPEN.x + 300, OPEN.y, { hp: 1 });
        let out = collide({
          ...s,
          asteroids: [a, b, rock("small", s.player.x, s.player.y)],
          playerBullets: [shot(a.x, a.y)],
          enemyBullets: [enemyShot(b.x, b.y)],
        });
        out = collide({
          ...out,
          player: { ...out.player, invincibleTimer: 0 },
          powerUps: [pickupOnShip(out, "bomb")],
          asteroids: [rock("large", OPEN.x, OPEN.y)],
        });
        return snap(out);
      },
      expect: (s) => expect(s.rocks.broken).toEqual({ player: 1, enemy: 1, bomb: 1, contact: 1 }),
    },
    {
      id: "enemiesStruck counts a strike the ship survives; enemiesDestroyed doesn't",
      covers: [field("rocks", "enemiesStruck"), field("rocks", "enemiesDestroyed")],
      scenario: () => {
        const { state, ship } = lone(arena(), "Guardian", { hp: 5 });
        return snap(collide({ ...state, asteroids: [rock("large", ship.x, ship.y)] }));
      },
      expect: (s) => {
        expect(s.rocks.enemiesStruck.Guardian).toBe(1);
        expect(s.rocks.enemiesDestroyed.Guardian).toBe(0);
      },
    },
    rockKill("Grunt"),
    rockKill("Elite"),
    rockKill("Guardian"),
    rockKill("Carrier"),
    {
      id: "playerHits: a rock on the hull by what it cost — shield, plating, life",
      covers: [
        key("HIT_RESULTS", "shield"),
        key("HIT_RESULTS", "plating"),
        key("HIT_RESULTS", "life"),
        field("rocks", "playerHits"),
      ],
      scenario: () => {
        let s = arena();
        s = onHull({
          ...s,
          activePowerUp: { type: "shield", remainingMs: 5000, shieldAbsorbed: 0 },
        });
        s = onHull({ ...s, activePowerUp: null, player: { ...s.player, hull: 1 } });
        s = onHull({ ...s, player: { ...s.player, invincibleTimer: 0 } });
        return snap(s);
      },
      expect: (s) => expect(s.rocks.playerHits).toEqual({ life: 1, plating: 1, shield: 1 }),
    },
    {
      id: "buddyHits / buddyDestroyed: a rock Buddy survives, then one that destroys it",
      covers: [field("rocks", "buddyHits"), field("rocks", "buddyDestroyed")],
      scenario: () => {
        let s = arena();
        const hp = BUDDY_ROCK_DAMAGE * 2;
        s = collide({
          ...s,
          buddyShips: [buddyAt(s, OPEN.x, OPEN.y, hp)],
          asteroids: [rock("large", OPEN.x, OPEN.y)],
        });
        s = collide({ ...s, asteroids: [rock("large", OPEN.x, OPEN.y)] });
        return snap(s);
      },
      expect: (s) => {
        expect(s.rocks.buddyHits).toBe(2);
        expect(s.rocks.buddyDestroyed).toBe(1);
      },
    },
    {
      id: "dodge: the wave's own copy of the tier dodge table",
      covers: [field("rocks", "dodge")],
      scenario: () => {
        let s: StarSwarmState = arena(3);
        s = { ...s, player: { ...s.player, invincibleTimer: 1e9 } };
        for (let i = 0; i < 600; i++) {
          if (s.asteroids.length < 2) s = throwAsteroid(s);
          s = tick(s, 16, NO_INPUT);
        }
        return snap(s);
      },
      expect: (s) => {
        const rolls = Object.values(s.rocks.dodge).reduce((t, d) => t + d.rolls, 0);
        expect(rolls).toBeGreaterThan(0);
      },
    },
  ],
};

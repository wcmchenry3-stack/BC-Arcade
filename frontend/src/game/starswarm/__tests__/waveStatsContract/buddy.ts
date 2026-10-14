/**
 * Wave-stats contract rows: `buddy` (#3248) — launches, hits and losses by cause, enemy shots
 * drawn, and kills by tier. See ./contract.ts; the full unit tests are `waveStats.combat.test.ts`.
 */
import { BUDDY_BEAM_DAMAGE, BUDDY_ROCK_DAMAGE, applyPowerUp, tick } from "../../engine";
import type { BuddyHitCause, EnemyTier, StarSwarmState } from "../../types";
import { NO_INPUT, makeBeam } from "../helpers/engineFixtures";
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
  snap,
} from "../helpers/waveStatsScenarios";
import { field, key, type ContractRow, type SectionContract } from "./contract";

/** What hits Buddy for each cause, and the damage it does. */
const HAZARD: Readonly<
  Record<BuddyHitCause, { readonly put: () => Partial<StarSwarmState>; readonly damage: number }>
> = {
  bullet: { put: () => ({ enemyBullets: [enemyShot(OPEN.x, OPEN.y)] }), damage: 1 },
  beam: { put: () => ({ carrierBeams: [makeBeam(OPEN.x, OPEN.y)] }), damage: BUDDY_BEAM_DAMAGE },
  rock: { put: () => ({ asteroids: [rock("large", OPEN.x, OPEN.y)] }), damage: BUDDY_ROCK_DAMAGE },
};

/** Buddy hit by `cause` and survives, then hit again by it and destroyed. */
function causeRow(cause: BuddyHitCause): ContractRow {
  return {
    id: `hits[${cause}] and destroyed[${cause}]`,
    covers: [key("BUDDY_HIT_CAUSES", cause), field("buddy", "hits"), field("buddy", "destroyed")],
    scenario: () => {
      const { put, damage } = HAZARD[cause];
      const s = arena();
      const hit = collide({ ...s, ...put(), buddyShips: [buddyAt(s, OPEN.x, OPEN.y, damage * 2)] });
      return snap(collide({ ...hit, ...put() }));
    },
    expect: (s) => {
      expect(s.buddy.hits[cause]).toBe(2);
      expect(s.buddy.destroyed[cause]).toBe(1);
    },
  };
}

function killRow(tier: EnemyTier): ContractRow {
  return {
    id: `kills[${tier}]: one of Buddy's shots kills a ${tier}`,
    covers: [key("ENEMY_TIERS", tier), field("buddy", "kills")],
    scenario: () => {
      const { state, ship } = lone(arena(), tier, { hp: 1 });
      return snap(collide({ ...state, playerBullets: [buddyShot(ship.x, ship.y)] }));
    },
    expect: (s) => expect(s.buddy.kills[tier]).toBe(1),
  };
}

export const contract: SectionContract<"buddy"> = {
  section: "buddy",
  pending: null,
  rows: [
    causeRow("bullet"),
    causeRow("beam"),
    causeRow("rock"),
    killRow("Grunt"),
    killRow("Elite"),
    killRow("Guardian"),
    killRow("Carrier"),
    {
      id: "launched counts a collected Buddy pickup and a dev-panel launch",
      covers: [field("buddy", "launched")],
      scenario: () => {
        const s = arena();
        return snap(applyPowerUp(collide({ ...s, powerUps: [pickupOnShip(s, "buddy")] }), "buddy"));
      },
      expect: (s) => expect(s.buddy.launched).toBe(2),
    },
    {
      id: "shotsDrawn counts the enemy shots diverted at Buddy",
      covers: [field("buddy", "shotsDrawn")],
      scenario: () => {
        let s: StarSwarmState = { ...arena(3), enemyFireDisabled: false, nextDiveTimer: 400 };
        s = applyPowerUp(s, "buddy");
        for (let i = 0; i < 900 && s.buddyShips.length > 0; i++) {
          s = tick(s, 16, NO_INPUT);
          s = { ...s, player: { ...s.player, invincibleTimer: 1e9 } };
        }
        return snap(s);
      },
      expect: (s) => expect(s.buddy.shotsDrawn).toBeGreaterThan(0),
    },
  ],
};

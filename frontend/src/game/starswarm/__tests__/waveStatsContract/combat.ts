/**
 * Wave-stats contract rows: `combat` (#3248) — ships spawned, kills by tier × method, and the
 * player's shots fired / hit / spent on rocks. See ./contract.ts; the full unit tests are
 * `waveStats.combat.test.ts`.
 *
 * Every tier × method combination the engine can produce has a row. The rest can't happen, and
 * are listed in UNREACHABLE with the reason (the harness only needs each registry value counted
 * once; this list says why the grid has holes).
 */
import { tick, type KillMethod } from "../../engine";
import type { Enemy, EnemyTier, StarSwarmState } from "../../types";
import { FIRE_INPUT } from "../helpers/engineFixtures";
import {
  OPEN,
  arena,
  buddyShot,
  collide,
  lone,
  pickupOnShip,
  rock,
  shot,
  snap,
} from "../helpers/waveStatsScenarios";
import { field, key, type ContractRow, type SectionContract } from "./contract";

/** Tier × method pairs no scenario can reach, and why. */
export const UNREACHABLE: readonly { tier: EnemyTier; method: KillMethod; why: string }[] = [
  {
    tier: "Carrier",
    method: "dive",
    why: "the Carrier never dives; its attack run scores as a plain shot",
  },
  { tier: "Carrier", method: "rout", why: "only Grunts flee a rout" },
  { tier: "Carrier", method: "ram", why: "the Carrier never leaves formation to ram (#2484)" },
  { tier: "Elite", method: "rout", why: "only Grunts flee a rout" },
  { tier: "Guardian", method: "rout", why: "only Grunts flee a rout" },
];

/** How each kill method is set up on a lone ship of `tier`. */
const KILLERS: Readonly<Record<KillMethod, (tier: EnemyTier) => StarSwarmState>> = {
  shot: (tier) => {
    const { state, ship } = lone(arena(), tier, { hp: 1 });
    return collide({ ...state, playerBullets: [shot(ship.x, ship.y)] });
  },
  dive: (tier) => {
    const { state, ship } = lone(arena(), tier, { hp: 1, phase: "Diving" });
    return collide({ ...state, playerBullets: [shot(ship.x, ship.y)] });
  },
  rout: (tier) => {
    const { state, ship } = lone(arena(), tier, { hp: 1, phase: "Fleeing" });
    return collide({ ...state, playerBullets: [shot(ship.x, ship.y)] });
  },
  bomb: (tier) => {
    const { state } = lone(arena(), tier, { hp: 1 });
    return collide({ ...state, powerUps: [pickupOnShip(state, "bomb")] });
  },
  ram: (tier) => {
    const base = arena();
    const { state } = lone(base, tier, {
      phase: "Diving",
      x: base.player.x,
      y: base.player.y,
    } as Partial<Enemy>);
    return collide({
      ...state,
      guardianThresholdCrossed: true,
      guardianDeepThresholdCrossed: true,
    });
  },
  rock: (tier) => {
    const { state, ship } = lone(arena(), tier, { hp: 1 });
    return collide({ ...state, asteroids: [rock("small", ship.x, ship.y)] });
  },
  buddy: (tier) => {
    const { state, ship } = lone(arena(), tier, { hp: 1 });
    return collide({ ...state, playerBullets: [buddyShot(ship.x, ship.y)] });
  },
};

const TIERS = ["Grunt", "Elite", "Guardian", "Carrier"] as const;
const METHODS = ["shot", "dive", "rout", "bomb", "ram", "rock", "buddy"] as const;

function killRow(tier: EnemyTier, method: KillMethod): ContractRow {
  return {
    id: `kills[${tier}][${method}]`,
    covers: [key("ENEMY_TIERS", tier), key("KILL_METHODS", method), field("combat", "kills")],
    scenario: () => snap(KILLERS[method](tier)),
    expect: (s) => {
      expect(s.combat.kills[tier][method]).toBe(1);
      const total = METHODS.reduce((t, m) => t + s.combat.kills[tier][m], 0);
      expect(total).toBe(1);
    },
  };
}

const unreachable = (tier: EnemyTier, method: KillMethod) =>
  UNREACHABLE.some((u) => u.tier === tier && u.method === method);

export const contract: SectionContract<"combat"> = {
  section: "combat",
  pending: null,
  rows: [
    ...TIERS.flatMap((tier) =>
      METHODS.filter((m) => !unreachable(tier, m)).map((m) => killRow(tier, m))
    ),
    {
      id: "spawned counts the roster the wave opened with, by tier",
      covers: [field("combat", "spawned")],
      scenario: () => snap(arena()),
      expect: (s) => {
        expect(s.combat.spawned).toEqual({ Grunt: 16, Elite: 16, Guardian: 4, Carrier: 1 });
      },
    },
    {
      id: "shotsFired, shotsHit and shotsOnRocks",
      covers: [
        field("combat", "shotsFired"),
        field("combat", "shotsHit"),
        field("combat", "shotsOnRocks"),
      ],
      scenario: () => {
        const s = arena();
        let out = tick(
          { ...s, player: { ...s.player, guns: 2, shootCooldown: 0 } },
          16,
          FIRE_INPUT
        );
        const { state, ship } = lone(out, "Guardian", { hp: 5 });
        const a = rock("large", OPEN.x, OPEN.y);
        out = collide({
          ...state,
          playerBullets: [shot(ship.x, ship.y)],
          asteroids: [a],
        });
        out = collide({ ...out, playerBullets: [shot(a.x, a.y)] });
        return snap(out);
      },
      expect: (s) => {
        expect(s.combat.shotsFired).toBe(2);
        expect(s.combat.shotsHit).toBe(1);
        expect(s.combat.shotsOnRocks).toBe(1);
      },
    },
  ],
};

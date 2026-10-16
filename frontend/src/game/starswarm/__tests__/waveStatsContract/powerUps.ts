/**
 * Wave-stats contract rows: `powerUps` (#3246). See ./contract.ts.
 *
 * Some type x source pairs can't happen (a bomb never comes from the Carrier); each registry
 * value is proved at least once, which is what the harness asks.
 */
import { CANVAS_H, applyPowerUp, tick } from "../../engine";
import {
  NO_INPUT,
  advanceMs,
  clearedSnapshot,
  diedSnapshot,
  shotOnShip,
} from "../helpers/engineFixtures";
import {
  dropDue,
  lastCarrier,
  parked,
  pickup,
  playingWave,
  rockSalvage,
  spawnedOf,
  withCentredDrops,
} from "../helpers/powerUpFixtures";
import { field, key, type SectionContract } from "./contract";

export const contract: SectionContract<"powerUps"> = {
  section: "powerUps",
  pending: null,
  rows: [
    {
      id: "a dev-panel power-up of every type is spawned from dev and collected on the spot",
      covers: [
        key("POWERUP_TYPES", "lightning"),
        key("POWERUP_TYPES", "shield"),
        key("POWERUP_TYPES", "buddy"),
        key("POWERUP_TYPES", "bomb"),
        key("POWERUP_TYPES", "salvage"),
        key("POWERUP_TYPES", "hull"),
        key("POWERUP_SOURCES", "dev"),
        field("powerUps", "spawned"),
        field("powerUps", "collected"),
      ],
      scenario: () => {
        let s = playingWave();
        for (const t of ["salvage", "hull", "bomb", "buddy", "lightning", "shield"] as const) {
          s = applyPowerUp(s, t);
        }
        return clearedSnapshot(s);
      },
      expect: (snap) => {
        for (const t of ["lightning", "shield", "buddy", "bomb", "salvage", "hull"] as const) {
          expect(snap.powerUps.spawned[t].dev).toBe(1);
          expect(snap.powerUps.collected[t]).toBeGreaterThanOrEqual(1); // plus any kill drop the bomb earned
        }
        expect(snap.dev).toBe(true);
      },
    },
    {
      id: "a kill drop is spawned from kill",
      covers: [key("POWERUP_SOURCES", "kill")],
      scenario: () =>
        withCentredDrops(() => clearedSnapshot(tick(dropDue(playingWave()), 16, NO_INPUT))),
      expect: (snap) => {
        const kills = (["lightning", "shield", "buddy", "bomb"] as const).reduce(
          (n, t) => n + snap.powerUps.spawned[t].kill,
          0
        );
        expect(kills).toBe(1);
        // it falls onto the waiting ship, which collects it before the wave extracts
        expect(
          snap.powerUps.collected.lightning + snap.powerUps.collected.shield
        ).toBeLessThanOrEqual(1);
      },
    },
    {
      id: "salvage from a broken rock is spawned from rock",
      covers: [key("POWERUP_SOURCES", "rock")],
      scenario: () => clearedSnapshot(rockSalvage(playingWave())),
      expect: (snap) => {
        expect(snap.powerUps.spawned.salvage.rock).toBeGreaterThanOrEqual(1);
        expect(snap.powerUps.spawned.salvage.kill).toBe(0);
        expect(spawnedOf(snap.powerUps.spawned, "salvage")).toBe(
          snap.powerUps.collected.salvage +
            snap.powerUps.missed.salvage +
            snap.powerUps.leftover.salvage
        );
      },
    },
    {
      id: "hull plating from a dying Carrier is spawned from carrier",
      covers: [key("POWERUP_SOURCES", "carrier")],
      scenario: () => clearedSnapshot(applyPowerUp(lastCarrier(playingWave()), "bomb")),
      expect: (snap) => {
        expect(snap.powerUps.spawned.hull.carrier).toBe(1);
        expect(snap.powerUps.spawned.hull.dev).toBe(0);
        expect(snap.powerUps.spawned.bomb.dev).toBe(1);
      },
    },
    {
      id: "a pickup that despawns or falls off the screen is missed",
      covers: [field("powerUps", "missed")],
      scenario: () => {
        const s0 = playingWave();
        const timedOut = { ...parked("bomb"), despawnTimer: 10 };
        const fell = pickup("buddy", "kill", 40, CANVAS_H + 40, { vy: 0.1 });
        return clearedSnapshot(advanceMs({ ...s0, powerUps: [timedOut, fell] }, 32));
      },
      expect: (snap) => {
        expect(snap.powerUps.missed.bomb).toBe(1);
        expect(snap.powerUps.missed.buddy).toBe(1);
        expect(snap.powerUps.leftover.bomb + snap.powerUps.leftover.buddy).toBe(0);
      },
    },
    {
      id: "a pickup on screen when a cleared wave closes is leftover",
      covers: [field("powerUps", "leftover")],
      scenario: () => clearedSnapshot({ ...playingWave(), powerUps: [parked("lightning")] }),
      expect: (snap) => {
        expect(snap.outcome).toBe("cleared");
        expect(snap.powerUps.leftover.lightning).toBe(1);
      },
    },
    {
      id: "a pickup on screen when the run ends is leftover",
      covers: [field("powerUps", "leftover")],
      scenario: () => diedSnapshot({ ...playingWave(), powerUps: [parked("hull", "carrier")] }),
      expect: (snap) => {
        expect(snap.outcome).toBe("died");
        expect(snap.powerUps.leftover.hull).toBe(1);
      },
    },
    {
      id: "a timed buff that runs out is expired, and its live ms are counted",
      covers: [field("powerUps", "expired"), field("powerUps", "activeMs")],
      scenario: () => {
        const s0 = playingWave();
        const buffed = {
          ...s0,
          activePowerUp: { type: "lightning" as const, remainingMs: 100, shieldAbsorbed: 0 },
        };
        return clearedSnapshot(advanceMs(buffed, 200));
      },
      expect: (snap) => {
        expect(snap.powerUps.expired.lightning).toBe(1);
        expect(snap.powerUps.activeMs.lightning).toBe(100);
      },
    },
    {
      id: "shieldAbsorbed counts the shots the shield soaked",
      covers: [field("powerUps", "shieldAbsorbed")],
      scenario: () => {
        const s0 = playingWave();
        const shielded = {
          ...s0,
          player: { ...s0.player, invincibleTimer: 0 },
          activePowerUp: { type: "shield" as const, remainingMs: 5000, shieldAbsorbed: 0 },
          enemyBullets: [shotOnShip(s0)],
        };
        return clearedSnapshot(tick(shielded, 16, NO_INPUT));
      },
      expect: (snap) => {
        expect(snap.powerUps.shieldAbsorbed).toBe(1);
      },
    },
  ],
};

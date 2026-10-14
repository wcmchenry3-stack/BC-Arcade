/**
 * Wave-stats contract rows: `damage` (#3248) — hits on the player by cause × result, and the
 * cause of the hit that ended the run. See ./contract.ts; the full unit tests (the multi-hit rule
 * included) are `waveStats.combat.test.ts`.
 *
 * Every cause × result combination the engine can produce has a row; UNREACHABLE lists the rest.
 */
import { tick, type HitCause, type HitResult } from "../../engine";
import type { StarSwarmState } from "../../types";
import { NO_INPUT, makeBeam } from "../helpers/engineFixtures";
import { arena, collide, enemyShot, lone, rock, snap } from "../helpers/waveStatsScenarios";
import { field, key, type ContractRow, type SectionContract } from "./contract";

/** Cause × result pairs no scenario can reach, and why. */
export const UNREACHABLE: readonly { cause: HitCause; result: HitResult; why: string }[] = [
  {
    cause: "ram",
    result: "shield",
    why: "the shield absorbs projectiles, never a ram (#1033/#2533)",
  },
];

/** The ship, with `result`'s protection, about to be hit by `cause`. */
function setUp(cause: HitCause, result: HitResult): StarSwarmState {
  let s = arena();
  if (cause === "ram") {
    s = lone(s, "Grunt", { phase: "Diving", x: s.player.x, y: s.player.y }).state;
  }
  const { x, y } = s.player;
  const hazard: Partial<StarSwarmState> =
    cause === "bullet"
      ? { enemyBullets: [enemyShot(x, y)] }
      : cause === "rock"
        ? { asteroids: [rock("small", x, y)] }
        : cause === "beam"
          ? { carrierBeams: [makeBeam(x, y)] }
          : {};
  return {
    ...s,
    ...hazard,
    activePowerUp:
      result === "shield" ? { type: "shield", remainingMs: 5000, shieldAbsorbed: 0 } : null,
    player: { ...s.player, hull: result === "plating" ? 1 : 0 },
  };
}

const CAUSES = ["bullet", "rock", "beam", "ram"] as const;
const RESULTS = ["life", "plating", "shield"] as const;

function hitRow(cause: HitCause, result: HitResult): ContractRow {
  return {
    id: `hits[${cause}][${result}]`,
    covers: [key("HIT_CAUSES", cause), key("HIT_RESULTS", result), field("damage", "hits")],
    scenario: () => snap(collide(setUp(cause, result))),
    expect: (s) => {
      expect(s.damage.hits[cause][result]).toBe(1);
      let total = 0;
      for (const c of CAUSES) for (const r of RESULTS) total += s.damage.hits[c][r];
      expect(total).toBe(1);
    },
  };
}

export const contract: SectionContract<"damage"> = {
  section: "damage",
  pending: null,
  rows: [
    ...CAUSES.flatMap((c) =>
      RESULTS.filter((r) => !UNREACHABLE.some((u) => u.cause === c && u.result === r)).map((r) =>
        hitRow(c, r)
      )
    ),
    {
      id: "deathCause is the cause of the hit that took the last life",
      covers: [field("damage", "deathCause")],
      scenario: () => {
        const s = setUp("beam", "life");
        const over = tick({ ...s, player: { ...s.player, lives: 1 } }, 16, NO_INPUT);
        if (!over.lastClosedWave) throw new Error("the run didn't end");
        return over.lastClosedWave;
      },
      expect: (s) => {
        expect(s.outcome).toBe("died");
        expect(s.damage.deathCause).toBe("beam");
      },
    },
  ],
};

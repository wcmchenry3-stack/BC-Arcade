/**
 * Star Swarm engine tests: the Buddy ship.
 *
 * One file per planned `engine/` module (#2988): this file follows `engine/buddy.ts`. Split out of
 * the former monolithic `engine.test.ts` (#2955) with describe blocks moved whole; shared fixtures
 * live in `helpers/engineFixtures.ts`.
 */
import {
  initStarSwarm,
  tick,
  seedRng,
  _resetIds,
  CANVAS_W,
  CANVAS_H,
  applyPowerUp,
} from "../engine";
import { NO_INPUT, advanceMs } from "./helpers/engineFixtures";

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

// ---------------------------------------------------------------------------
// #1035 — Buddy Ship: spawns, traverses, fires burst
// ---------------------------------------------------------------------------

describe("#1035 Buddy Ship", () => {
  it("buddyShips initialises empty", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.buddyShips).toEqual([]);
  });

  it("applyPowerUp(buddy) adds one buddy ship to state", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = applyPowerUp(s, "buddy");
    expect(s.buddyShips.length).toBe(1);
  });

  it("buddy ship fires player bullets, then peels off once its bursts are spent", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = applyPowerUp(s, "buddy");
    expect(s.buddyShips.length).toBe(1);
    // #2845: Buddy draws fire now — keep the player alive, and Buddy untouchable, for the sortie
    s = { ...s, player: { ...s.player, invincibleTimer: 999_999 }, enemyFireDisabled: true };
    let buddyShots = 0;
    const seen = new Set<number>();
    for (let t = 0; t < 14_000 && s.buddyShips.length > 0; t += 16) {
      s = tick(s, 16, NO_INPUT);
      for (const b of s.playerBullets) {
        if (b.source === "buddy" && !seen.has(b.id)) {
          seen.add(b.id);
          buddyShots++;
        }
      }
    }
    expect(s.buddyShips.length).toBe(0);
    expect(buddyShots).toBeGreaterThanOrEqual(3);
  });
});

/** #3526: the loop conditions fire only on their edges. */
import { CANVAS_H, CANVAS_W, fleeingCount, initStarSwarm } from "../engine";
import { newLoopFlags, updateLoops, type StarSwarmLoop } from "../soundLoops";
import type { BuddyShip, StarSwarmState } from "../types";

const base = (): StarSwarmState => ({
  ...initStarSwarm(CANVAS_W, CANVAS_H, 1, 42),
  activePowerUp: null,
  buddyShips: [],
});
const shielded = (s: StarSwarmState): StarSwarmState => ({
  ...s,
  activePowerUp: { type: "shield", remainingMs: 4000, shieldAbsorbed: 0 },
});
const withBuddy = (s: StarSwarmState): StarSwarmState => ({
  ...s,
  buddyShips: [{ id: 1, phase: "OnStation" } as unknown as BuddyShip],
});
// #3562: the loop is the beam's, so it needs a phase the guns fire in (base() is the swoop-in)
const lightning = (s: StarSwarmState): StarSwarmState => ({
  ...s,
  phase: "Playing",
  activePowerUp: { type: "lightning", remainingMs: 4000, shieldAbsorbed: 0 },
});
const fleeing = (s: StarSwarmState, n = 1): StarSwarmState => ({
  ...s,
  enemies: s.enemies.map((e, i) =>
    i < n ? { ...e, isAlive: true, phase: "Fleeing" as const } : e
  ),
});

function run(states: StarSwarmState[]) {
  const flags = newLoopFlags();
  const calls: [StarSwarmLoop, boolean][] = [];
  for (const s of states) updateLoops(s, flags, (l, on) => calls.push([l, on]));
  return calls;
}

describe("updateLoops", () => {
  it("reports nothing while no condition holds, however many ticks", () => {
    expect(run([base(), base(), base()])).toEqual([]);
  });

  it("starts a loop on the rising edge and stops it on the falling edge, once each", () => {
    const s = base();
    expect(run([s, shielded(s), shielded(s), shielded(s), s, s])).toEqual([
      ["shield", true],
      ["shield", false],
    ]);
    expect(run([s, withBuddy(s), withBuddy(s), s])).toEqual([
      ["buddy", true],
      ["buddy", false],
    ]);
  });

  it("the rout loop runs while any grunt is Fleeing: the ROUT! banner's condition", () => {
    const s = base();
    const two = fleeing(s, 2);
    expect(fleeingCount(two)).toBe(2);
    // one escapes or dies: still fleeing, no edge; the last one goes: stop
    const one = fleeing(s, 1);
    expect(run([s, two, one, one, s])).toEqual([
      ["rout", true],
      ["rout", false],
    ]);
  });

  it("a dead fleeing grunt does not count", () => {
    const s = base();
    const dead = {
      ...s,
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, phase: "Fleeing" as const })),
    };
    expect(run([dead])).toEqual([]);
  });

  it("reports several loops changing on one tick", () => {
    const s = base();
    expect(run([withBuddy(shielded(s))])).toEqual([
      ["shield", true],
      ["buddy", true],
    ]);
  });

  it("the buddy loop runs only while a Buddy is on station (#3560)", () => {
    const s = base();
    const buddy = (phase: BuddyShip["phase"]): StarSwarmState => ({
      ...s,
      buddyShips: [{ id: 1, phase } as unknown as BuddyShip],
    });
    expect(run([buddy("Entering"), buddy("Entering")])).toEqual([]);
    expect(run([buddy("Entering"), buddy("OnStation"), buddy("Leaving")])).toEqual([
      ["buddy", true],
      ["buddy", false],
    ]);
    // a second Buddy still on station keeps it running when the first leaves
    const two: StarSwarmState = {
      ...s,
      buddyShips: [
        { id: 1, phase: "Leaving" },
        { id: 2, phase: "OnStation" },
      ] as unknown as BuddyShip[],
    };
    expect(run([buddy("OnStation"), two, s])).toEqual([
      ["buddy", true],
      ["buddy", false],
    ]);
  });

  it("the lightning loop runs while Lightning is active, and a Shield replacing it swaps loops (#3560)", () => {
    const s = base();
    expect(run([s, lightning(s), lightning(s), s])).toEqual([
      ["lightning", true],
      ["lightning", false],
    ]);
    expect(run([shielded(s), lightning(s), shielded(s)])).toEqual([
      ["shield", true],
      ["shield", false],
      ["lightning", true],
      ["shield", true],
      ["lightning", false],
    ]);
  });

  it("the lightning loop starts and stops with the beam (#3562)", () => {
    const s = { ...base(), phase: "Playing" as const };
    const lit = lightning(s);
    // on in combat and the pickup wait; off when the extraction takes the ship, while Lightning
    // still runs to the wave boundary; off with the dev panel's "Player missiles off"
    expect(
      run([s, lit, { ...lit, phase: "ClearAwaitingPickups" }, { ...lit, phase: "Extraction" }])
    ).toEqual([
      ["lightning", true],
      ["lightning", false],
    ]);
    expect(run([lit, { ...lit, playerFireDisabled: true }, lit])).toEqual([
      ["lightning", true],
      ["lightning", false],
      ["lightning", true],
    ]);
    // banked Lightning (#3512) has no beam and no loop
    expect(run([{ ...s, bankedPowerUp: "lightning" as const }])).toEqual([]);
  });
});

/** #3560: the Shield and Buddy one-shot cues fire only on their edges. */
import { CANVAS_H, CANVAS_W, initStarSwarm } from "../engine";
import {
  SHIELD_WARN_MS,
  buddyJustEntered,
  buddyJustLeft,
  emitSoundCues,
  rockBreakCount,
  rockBreakKind,
  shieldJustOff,
  shieldJustOn,
  shieldWarnCrossed,
  type StarSwarmCue,
} from "../soundCues";
import type { Asteroid, BuddyPhase, BuddyShip, StarSwarmState } from "../types";

const base = (): StarSwarmState => ({
  ...initStarSwarm(CANVAS_W, CANVAS_H, 1, 42),
  activePowerUp: null,
  buddyShips: [],
});
const buff = (s: StarSwarmState, type: "shield" | "lightning", remainingMs: number) => ({
  ...s,
  activePowerUp: { type, remainingMs, shieldAbsorbed: 0 },
});
const buddies = (s: StarSwarmState, ...phases: BuddyPhase[]): StarSwarmState => ({
  ...s,
  buddyShips: phases.map((phase, i) => ({ id: i + 1, phase }) as unknown as BuddyShip),
});
const launched = (s: StarSwarmState): StarSwarmState => ({
  ...s,
  runStats: { ...s.runStats, buddyLaunched: s.runStats.buddyLaunched + 1 },
});

/** Walk a sequence of ticks, collecting every cue. */
function run(states: StarSwarmState[]): StarSwarmCue[] {
  const out: StarSwarmCue[] = [];
  for (let i = 1; i < states.length; i++) {
    emitSoundCues(states[i - 1]!, states[i]!, (c) => out.push(c));
  }
  return out;
}

describe("Shield cues", () => {
  it("the warning threshold is 1 s", () => {
    expect(SHIELD_WARN_MS).toBe(1000);
  });

  it("on fires once, on the tick the Shield becomes active, however it got there", () => {
    const s = base();
    expect(run([s, buff(s, "shield", 5000), buff(s, "shield", 4984)])).toEqual(["shieldOn"]);
    expect(shieldJustOn(s, buff(s, "shield", 5000))).toBe(true);
    // replacing Lightning
    expect(shieldJustOn(buff(s, "lightning", 2000), buff(s, "shield", 5000))).toBe(true);
    expect(shieldJustOn(buff(s, "shield", 4000), buff(s, "shield", 3984))).toBe(false);
    expect(shieldJustOn(s, buff(s, "lightning", 5000))).toBe(false);
  });

  it("warn fires once, when the time crosses from above 1 s to 1 s or less", () => {
    const s = base();
    expect(
      run([
        buff(s, "shield", 5000),
        buff(s, "shield", 1016),
        buff(s, "shield", 1000),
        buff(s, "shield", 984),
        buff(s, "shield", 500),
      ])
    ).toEqual(["shieldWarn"]);
    // landing exactly on the threshold from above counts; staying below does not re-fire
    expect(shieldWarnCrossed(buff(s, "shield", 1001), buff(s, "shield", 1000))).toBe(true);
    expect(shieldWarnCrossed(buff(s, "shield", 1000), buff(s, "shield", 984))).toBe(false);
  });

  it("warn does not fire when the Shield ends or is replaced before the threshold", () => {
    const s = base();
    expect(run([buff(s, "shield", 3000), s])).toEqual(["shieldOff"]);
    expect(run([buff(s, "shield", 3000), buff(s, "lightning", 5000)])).toEqual(["shieldOff"]);
    expect(shieldWarnCrossed(buff(s, "lightning", 1016), buff(s, "lightning", 1000))).toBe(false);
    // a Shield replaced by Lightning on the very tick the time would cross: no warning
    expect(shieldWarnCrossed(buff(s, "shield", 1016), buff(s, "lightning", 5000))).toBe(false);
  });

  it("a re-collected Shield restarts the time, so it can warn again for the new activation", () => {
    const s = base();
    expect(
      run([
        buff(s, "shield", 1016),
        buff(s, "shield", 1000),
        buff(s, "shield", 5000),
        buff(s, "shield", 1016),
        buff(s, "shield", 1000),
      ])
    ).toEqual(["shieldWarn", "shieldWarn"]);
  });

  it("off fires once when an active Shield stops: expiry, Lightning, or the wave boundary", () => {
    const s = base();
    expect(shieldJustOff(buff(s, "shield", 16), s)).toBe(true);
    expect(shieldJustOff(buff(s, "shield", 3000), buff(s, "lightning", 5000))).toBe(true);
    expect(shieldJustOff(s, s)).toBe(false);
    expect(shieldJustOff(buff(s, "shield", 3000), buff(s, "shield", 2984))).toBe(false);
    expect(shieldJustOff(buff(s, "lightning", 3000), s)).toBe(false);
  });

  it("off is silent at game over (the loops are just silenced)", () => {
    const s = base();
    expect(shieldJustOff(buff(s, "shield", 3000), { ...s, phase: "GameOver" })).toBe(false);
  });

  it("a new run (a fresh state, never ticked from the old one) produces no off cue", () => {
    // the canvas replaces its state on a reset; the first tick compares the new state to itself
    const fresh = base();
    expect(run([fresh, fresh])).toEqual([]);
  });
});

describe("Buddy cues", () => {
  it("in fires on the tick a Buddy is launched, again for a re-launch", () => {
    const s = base();
    const b1 = buddies(launched(s), "Entering");
    expect(run([s, b1, buddies(b1, "OnStation")])).toEqual(["buddyIn"]);
    expect(buddyJustEntered(s, b1)).toBe(true);
    // the first Buddy left and a new one launches
    const gone = buddies(b1);
    expect(run([gone, buddies(launched(gone), "Entering")])).toEqual(["buddyIn"]);
  });

  it("out fires once when a Buddy turns to Leaving, not while it stays Leaving", () => {
    const s = base();
    expect(
      run([
        buddies(s, "OnStation"),
        buddies(s, "Leaving"),
        buddies(s, "Leaving"),
        buddies(s), // it flew off screen: nothing
      ])
    ).toEqual(["buddyOut"]);
    expect(buddyJustLeft(buddies(s, "Entering"), buddies(s, "Leaving"))).toBe(true);
  });

  it("a Buddy shot down is not an out cue (the engine's buddyJustLost covers it)", () => {
    const s = base();
    expect(run([buddies(s, "OnStation"), buddies(s)])).toEqual([]);
    expect(buddyJustLeft(buddies(s, "Leaving"), buddies(s))).toBe(false);
  });

  it("with two Buddies, one peeling off cues out while the other stays", () => {
    const s = base();
    expect(run([buddies(s, "OnStation", "OnStation"), buddies(s, "Leaving", "OnStation")])).toEqual(
      ["buddyOut"]
    );
  });
});

describe("rock break sounds (#3560)", () => {
  const rock = (id: number, kind: "large" | "small", over: Partial<Asteroid> = {}): Asteroid =>
    ({ id, kind, x: 100, y: 100, vx: 0, vy: 0.1, radius: 10, hp: 1, ...over }) as Asteroid;
  const withRocks = (s: StarSwarmState, ...rocks: Asteroid[]): StarSwarmState => ({
    ...s,
    asteroids: rocks,
  });
  /** `n` more rocks counted as broken this wave. */
  const broke = (s: StarSwarmState, n: number): StarSwarmState => ({
    ...s,
    waveStats: {
      ...s.waveStats,
      rocks: {
        ...s.waveStats.rocks,
        broken: { ...s.waveStats.rocks.broken, player: s.waveStats.rocks.broken.player + n },
      },
    },
  });

  it("a large rock breaking is large (its two halves do not matter)", () => {
    const prev = withRocks(base(), rock(1, "large"));
    const next = broke(withRocks(base(), rock(8, "small"), rock(9, "small")), 1);
    expect(rockBreakKind(prev, next)).toBe("large");
    expect(rockBreakCount(prev, next)).toBe(1);
  });

  it("a small rock breaking is small", () => {
    const prev = withRocks(base(), rock(1, "small"));
    expect(rockBreakKind(prev, broke(withRocks(base()), 1))).toBe("small");
  });

  it("a large and a small break on one tick play the large one", () => {
    const prev = withRocks(base(), rock(1, "small"), rock(2, "large"));
    const next = broke(withRocks(base()), 2);
    expect(rockBreakKind(prev, next)).toBe("large");
    expect(rockBreakCount(prev, next)).toBe(2);
  });

  it("a rock leaving the screen is not a break, and one the counter cannot attribute is small", () => {
    const gone = rock(1, "large", { y: CANVAS_H + 100, vy: 0.1 });
    const prev = withRocks(base(), gone);
    expect(rockBreakKind(prev, withRocks(base()))).toBeNull();
    // a counted break while another large rock merely left: small
    expect(rockBreakKind(prev, broke(withRocks(base()), 1))).toBe("small");
  });

  it("a wave boundary (counters restart) and an unchanged state are null", () => {
    const prev = broke(withRocks(base(), rock(1, "large")), 3);
    const next = { ...withRocks(base()), wave: prev.wave + 1 };
    expect(rockBreakKind(prev, next)).toBeNull();
    expect(rockBreakCount(prev, next)).toBe(0);
    expect(rockBreakKind(prev, prev)).toBeNull();
  });
});

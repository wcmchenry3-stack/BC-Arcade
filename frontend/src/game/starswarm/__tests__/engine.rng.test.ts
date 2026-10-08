/**
 * Star Swarm engine tests: the seeded rng and the id counters (`engine/rng.ts`, #2988).
 *
 * The counters are the run's replay state outside `StarSwarmState`: a seed, the entity id
 * counter and Buddy's separate id range (#2880). `engineCounters()` / `restoreEngineCounters()`
 * carry them across a pause/resume (#2645).
 */
import {
  BUDDY_ID_BASE,
  _resetIds,
  engineCounters,
  isEngineCounters,
  nextBuddyId,
  nextId,
  peekNextId,
  restoreEngineCounters,
  rng,
  seedBuddyIdRange,
  seedRng,
} from "../engine";

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

describe("seeded rng (engine/rng.ts)", () => {
  it("replays the same stream for the same seed, in [0, 1)", () => {
    seedRng(7);
    const a = Array.from({ length: 50 }, () => rng());
    seedRng(7);
    const b = Array.from({ length: 50 }, () => rng());
    expect(b).toEqual(a);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    seedRng(8);
    expect(rng()).not.toBe(a[0]);
  });

  it("seeds are 32-bit: a seed above 2^32 wraps, a negative one is taken unsigned", () => {
    seedRng(2 ** 32 + 5);
    const wrapped = rng();
    seedRng(5);
    expect(rng()).toBe(wrapped);
    seedRng(-1);
    expect(engineCounters().seed).toBe(0xffffffff);
  });
});

describe("id counters (engine/rng.ts)", () => {
  it("nextId counts up from 1 after a reset, and peekNextId reads without allocating", () => {
    expect(peekNextId()).toBe(1);
    expect(nextId()).toBe(1);
    expect(nextId()).toBe(2);
    expect(peekNextId()).toBe(3);
    expect(peekNextId()).toBe(3);
  });

  it("Buddy ids come from their own range, far above the main stream (#2880)", () => {
    expect(nextBuddyId()).toBe(BUDDY_ID_BASE);
    expect(nextBuddyId()).toBe(BUDDY_ID_BASE + 1);
    expect(nextId()).toBe(1); // the main stream did not move
  });

  it("seedBuddyIdRange lifts Buddy's range by the main counter's position, forward only", () => {
    for (let i = 0; i < 10; i++) nextId(); // main counter at 11
    seedBuddyIdRange();
    expect(nextBuddyId()).toBe(BUDDY_ID_BASE + 11 * 100);
    // a later seed from a lower position never moves the range back
    _resetIds();
    expect(engineCounters().buddyNextId).toBe(BUDDY_ID_BASE);
    for (let i = 0; i < 3; i++) nextId();
    seedBuddyIdRange();
    const first = nextBuddyId();
    seedBuddyIdRange();
    expect(nextBuddyId()).toBe(first + 1);
  });
});

describe("engine counters (#2645)", () => {
  it("engineCounters snapshots the seed, the id counter and Buddy's counter", () => {
    seedRng(99);
    nextId();
    nextId();
    nextBuddyId();
    expect(engineCounters()).toEqual({
      nextId: 3,
      seed: 99,
      buddyNextId: BUDDY_ID_BASE + 1,
    });
  });

  it("isEngineCounters accepts a save's counters and rejects malformed ones", () => {
    expect(isEngineCounters({ nextId: 1, seed: 0 })).toBe(true);
    expect(isEngineCounters({ nextId: 500, seed: 0xffffffff, buddyNextId: BUDDY_ID_BASE })).toBe(
      true
    );
    expect(isEngineCounters(null)).toBe(false);
    expect(isEngineCounters({ nextId: 0, seed: 1 })).toBe(false);
    expect(isEngineCounters({ nextId: 1.5, seed: 1 })).toBe(false);
    expect(isEngineCounters({ nextId: 1, seed: -1 })).toBe(false);
    expect(isEngineCounters({ nextId: 1, seed: 2 ** 32 })).toBe(false);
    expect(isEngineCounters({ nextId: 1, seed: 1, buddyNextId: "x" })).toBe(false);
  });

  it("restoreEngineCounters moves ids forward only and takes the seed as given", () => {
    for (let i = 0; i < 20; i++) nextId(); // this process already issued 1..20
    restoreEngineCounters({ nextId: 5, seed: 123 });
    expect(engineCounters()).toEqual({ nextId: 21, seed: 123, buddyNextId: BUDDY_ID_BASE });
    restoreEngineCounters({ nextId: 40, seed: 7, buddyNextId: BUDDY_ID_BASE + 50 });
    expect(engineCounters()).toEqual({ nextId: 40, seed: 7, buddyNextId: BUDDY_ID_BASE + 50 });
    // invalid counters change nothing
    restoreEngineCounters({ nextId: 0, seed: 1 });
    expect(engineCounters()).toEqual({ nextId: 40, seed: 7, buddyNextId: BUDDY_ID_BASE + 50 });
  });

  it("a restored seed continues the rng stream exactly where the save left it", () => {
    seedRng(2024);
    rng();
    rng();
    const saved = engineCounters();
    const expected = [rng(), rng(), rng()];
    seedRng(1);
    restoreEngineCounters(saved);
    expect([rng(), rng(), rng()]).toEqual(expected);
  });
});

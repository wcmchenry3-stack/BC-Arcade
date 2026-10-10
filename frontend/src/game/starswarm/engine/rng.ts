/**
 * Star Swarm engine — seeded RNG and id counters (#2988).
 *
 * The run's replay counters: the LCG seed (stepped with the shared `lcgNext`, #2985), the
 * entity id counter and Buddy's separate id range (#2880). `engineCounters()` /
 * `restoreEngineCounters()` carry them across a pause/resume (#2645); `seedRng` and
 * `_resetIds` pin them in tests and the balance simulator.
 */
import { LCG_MODULUS, lcgNext } from "../../_shared/seededRng";

// ---------------------------------------------------------------------------
// LCG RNG — deterministic and seedable for tests
// ---------------------------------------------------------------------------

let _seed = 42;

export function seedRng(seed: number): void {
  _seed = seed >>> 0;
}

export function rng(): number {
  _seed = lcgNext(_seed);
  return _seed / LCG_MODULUS;
}

// ---------------------------------------------------------------------------
// ID counter
// ---------------------------------------------------------------------------

let _nextId = 1;

export function nextId(): number {
  return _nextId++;
}

/**
 * #2880: Buddy's own entities (the ship, its shots, its wreck's explosion) draw ids from a
 * separate range, so launching a Buddy never shifts the main id stream. Carrier targeting and
 * Buddy/pilot hazard-notice hashes are keyed on ids, and the balance sim's with/without-Buddy
 * counterfactual needs both branches to see the same keys for the same world. Gameplay is
 * otherwise unchanged. The range sits far above any id a run reaches.
 */
export const BUDDY_ID_BASE = 1_000_000_000;
let _nextBuddyId = BUDDY_ID_BASE;

export function nextBuddyId(): number {
  return _nextBuddyId++;
}

/** The id the next entity will get — a deterministic, rng-free key (#2845 Carrier volley roll). */
export function peekNextId(): number {
  return _nextId;
}

/**
 * #2880: seed Buddy's id range from where the main stream is at launch (read-only: nothing is
 * allocated from it), so Buddy's id — which keys its side, fan size and noticing — still differs
 * run to run instead of being the same 1e9 every time. Only ever moves forward, so ids stay unique.
 */
export function seedBuddyIdRange(): void {
  _nextBuddyId = Math.max(_nextBuddyId, BUDDY_ID_BASE + _nextId * 100);
}

/**
 * Reset for testing only.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export function _resetIds(): void {
  _nextId = 1;
  _nextBuddyId = BUDDY_ID_BASE;
}

/**
 * The module-level counters a run depends on (#2645). A new process starts them over — ids
 * from 1, the rng from the default seed — so a run restored after a cold start carries them.
 */
export interface EngineCounters {
  readonly nextId: number;
  readonly seed: number;
  /** #2880: Buddy's separate id counter. Absent in saves from before it existed. */
  readonly buddyNextId?: number;
}

export function engineCounters(): EngineCounters {
  return { nextId: _nextId, seed: _seed, buddyNextId: _nextBuddyId };
}

/** Counters a save may carry: a positive integer id counter and a 32-bit seed. */
export function isEngineCounters(v: unknown): v is EngineCounters {
  if (v === null || typeof v !== "object") return false;
  const { nextId, seed } = v as Record<string, unknown>;
  return (
    Number.isSafeInteger(nextId) &&
    (nextId as number) >= 1 &&
    Number.isInteger(seed) &&
    (seed as number) >= 0 &&
    (seed as number) <= 0xffffffff &&
    ((v as Record<string, unknown>).buddyNextId === undefined ||
      Number.isSafeInteger((v as Record<string, unknown>).buddyNextId))
  );
}

/**
 * Continue a restored run's counters. Ids only move forward: never back onto an id this
 * process has already issued, nor onto one the restored run holds. Counters that aren't
 * valid change nothing.
 */
export function restoreEngineCounters(counters: EngineCounters): void {
  if (!isEngineCounters(counters)) return;
  _nextId = Math.max(_nextId, counters.nextId);
  _nextBuddyId = Math.max(_nextBuddyId, counters.buddyNextId ?? BUDDY_ID_BASE);
  _seed = counters.seed >>> 0;
}

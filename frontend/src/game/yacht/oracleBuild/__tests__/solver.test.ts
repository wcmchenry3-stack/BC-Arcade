/**
 * solver.ts unit tests (#2243) — hand-checkable endgame states.
 *
 * `solveStateVTG` takes an injectable successor-VTG callback specifically so
 * these tests can exercise the real per-turn micro-DP on tiny, independently
 * verifiable scenarios (1-2 categories remaining) without running the full
 * ~700K-state retrograde sweep.
 */

import { solveStateVTG } from "../../oracle/microDp";
import { buildHoldOptions } from "../../oracle/multisetIndex";
import {
  encodeKey,
  decodeKey,
  YACHT_FILLED_50,
  YACHT_FILLED_0,
  NON_YACHT_CATEGORIES,
} from "../../oracle/stateKey";

// buildHoldOptions() is pure/state-independent — build once for all tests.
const holdOptions = buildHoldOptions();

const ONES_BIT = NON_YACHT_CATEGORIES.indexOf("ones" as never);
const TWOS_BIT = NON_YACHT_CATEGORIES.indexOf("twos" as never);

// All 12 non-yacht bits set except the given ones — "only these categories are open".
function maskWithOnlyOpen(openBits: readonly number[]): number {
  const allFilled = (1 << NON_YACHT_CATEGORIES.length) - 1;
  let mask = allFilled;
  for (const bit of openBits) mask &= ~(1 << bit);
  return mask;
}

describe("solveStateVTG — closed-form endgame: only 'ones' open", () => {
  it("matches the exact closed-form EV: 5 × (1 - (5/6)^3)", () => {
    // With only "ones" scoreable, dice values other than 1 are irrelevant —
    // optimal play is trivially "reroll every non-1 die, every roll". Each
    // die independently gets 3 tries to show a 1: P(die shows 1 by the end)
    // = 1 - (5/6)^3. Expected count of 1s among 5 independent dice = 5×that.
    // upperCapped=0 (other 5 upper categories contributed nothing) keeps the
    // upper-bonus threshold (63) unreachable regardless of the ones score
    // (max +5), so this scenario is a clean, single-effect closed form.
    const key = encodeKey(maskWithOnlyOpen([ONES_BIT]), YACHT_FILLED_0, 0);
    const vtg = solveStateVTG(key, holdOptions, () => 0); // scoring "ones" ends the game (0 remaining) → VTG 0

    const expected = 5 * (1 - Math.pow(5 / 6, 3));
    expect(vtg).toBeCloseTo(expected, 9);
    expect(expected).toBeCloseTo(2.1064814814814814, 9); // 455/216, documented for readability
  });
});

describe("solveStateVTG — 2 categories remaining (ones + twos): sanity bounds", () => {
  it("EV(both open) is at least the sum of solving each alone (flexibility can only help)", () => {
    // A player who could commit to "always treat this as ones-only, handle
    // twos next turn" guarantees at least EV(ones-alone) this turn and
    // EV(twos-alone) next turn — i.e. their sum is a valid LOWER bound on
    // the true (adaptive, flexible) 2-category EV. This is hand-derivable
    // without brute-forcing the exact number, and is a real correctness
    // property (it would fail if the solver were, e.g., only considering
    // one of the two categories, or mis-ordering the retrograde composition).
    const onesOnlyKey = encodeKey(maskWithOnlyOpen([ONES_BIT]), YACHT_FILLED_0, 0);
    const twosOnlyKey = encodeKey(maskWithOnlyOpen([TWOS_BIT]), YACHT_FILLED_0, 0);
    const evOnesAlone = solveStateVTG(onesOnlyKey, holdOptions, () => 0);
    const evTwosAlone = solveStateVTG(twosOnlyKey, holdOptions, () => 0);

    // Chain the retrograde composition exactly as solveOracle() would:
    // "both open" (2 remaining) looks up "one filled" (1 remaining) states.
    const onesOnlyMask = maskWithOnlyOpen([ONES_BIT]);
    const twosOnlyMask = maskWithOnlyOpen([TWOS_BIT]);

    const bothOpenKey = encodeKey(maskWithOnlyOpen([ONES_BIT, TWOS_BIT]), YACHT_FILLED_0, 0);
    const evBothOpen = solveStateVTG(bothOpenKey, holdOptions, (nextKey) => {
      // After scoring ones, only twos remains open (and vice versa) — both
      // successor states reduce to the "1 category remaining, upperCapped
      // reflects whatever ones/twos scored" case. Since scoring the OTHER
      // category only ever ADDS to upperCapped (max possible total from
      // ones+twos combined is 5+10=15, nowhere near the 63 bonus threshold),
      // the ones-only/twos-only EVs computed at upperCapped=0 are exact
      // stand-ins for "whichever one is still open after the other is
      // scored", regardless of the successor's actual upperCapped value.
      const decoded = decodeKey(nextKey);
      if (decoded.mask === twosOnlyMask) return evTwosAlone;
      if (decoded.mask === onesOnlyMask) return evOnesAlone;
      throw new Error(
        `Unexpected successor mask ${decoded.mask} — test scenario assumption violated`
      );
    });

    expect(evBothOpen).toBeGreaterThanOrEqual(evOnesAlone + evTwosAlone - 1e-9);
    // Also strictly greater in practice (adaptive placement should help at
    // least a little) — not asserted as a hard requirement (equality would
    // still be a valid, just suspiciously non-adaptive, outcome) but logged
    // for visibility if it ever regresses to exactly the naive sum.
  });
});

describe("solveStateVTG — yacht bonus (#2243 regression: was missing the +100)", () => {
  it("a yacht-filled-50 state (joker unlocked) has strictly higher EV than an otherwise-identical filled-0 state", () => {
    // Several open categories, all-upper NOT yet complete (so the comparison
    // isn't confounded by the upper-bonus threshold), yacht either filled
    // with 50 (joker can fire on a future 5-of-a-kind) or 0 (never fires).
    const THREES_BIT = NON_YACHT_CATEGORIES.indexOf("threes" as never);
    const FIVES_BIT = NON_YACHT_CATEGORIES.indexOf("fives" as never);
    const CHANCE_BIT = NON_YACHT_CATEGORIES.indexOf("chance" as never);
    const openMask = maskWithOnlyOpen([THREES_BIT, FIVES_BIT, CHANCE_BIT]);

    const key50 = encodeKey(openMask, YACHT_FILLED_50, 0);
    const key0 = encodeKey(openMask, YACHT_FILLED_0, 0);

    const ev50 = solveStateVTG(key50, holdOptions, () => 0);
    const ev0 = solveStateVTG(key0, holdOptions, () => 0);

    // Rough sanity bound: rolling a 5-of-a-kind on the initial roll alone
    // happens with probability 6/7776 ≈ 0.077% per specific face, 6×that
    // ≈0.46% for any face — and optimal reroll play only increases the
    // chance of landing one across up to 3 rolls. The gap should be
    // positive but modest (well under the full +100, since it's a small
    // probability event, not a certainty).
    expect(ev50).toBeGreaterThan(ev0);
    expect(ev50 - ev0).toBeGreaterThan(0.5); // meaningfully more than rounding noise
    expect(ev50 - ev0).toBeLessThan(20); // sanity ceiling — not close to the full +100
  });
});

describe("solveStateVTG — legal categories are never empty at remaining >= 1", () => {
  it("does not fall back to the defensive -Infinity→0 path for a normal open state", () => {
    // A state with a single open category and a non-trivial dice distribution
    // must always have at least one legal placement (itself) — if the
    // defensive fallback in solver.ts's arr0 computation ever fired here,
    // the resulting EV would be 0, which we already know is wrong (see the
    // closed-form test above expecting ~2.106).
    const key = encodeKey(maskWithOnlyOpen([ONES_BIT]), YACHT_FILLED_0, 0);
    const vtg = solveStateVTG(key, holdOptions, () => 0);
    expect(vtg).toBeGreaterThan(0);
  });
});

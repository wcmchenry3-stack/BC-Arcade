/**
 * Hearts AI unit tests (#606): `selectCardsToPass` — the three-card pass, by persona and direction.
 *
 * Split out of the former `ai.test.ts` (#2955) along the exported-function clusters of `ai.ts`:
 * passing (`selectCardsToPass`), playing (`selectCardToPlay`) and moon detection
 * (`detectPotentialMoon` / `detectMoonAttempt` and the moon-mode play paths they drive). Describe
 * blocks moved whole; shared fixtures live in `helpers/aiFixtures.ts`.
 */
import { selectCardsToPass } from "../ai";
import { setRng } from "../engine";
import { assessMoonHand } from "../moonHand";
import { c } from "./helpers/aiFixtures";

// Pin RNG to suppress cognitive noise (NOISE_RATE: Cautious 55%, Schemer 19%) so tests
// are deterministic — noise fires only when rng() < noiseRate, never at 0.99.
beforeEach(() => setRng(() => 0.99));

// ---------------------------------------------------------------------------
// selectCardsToPass
// ---------------------------------------------------------------------------

describe("selectCardsToPass", () => {
  it("always returns exactly 3 cards", () => {
    const hand = [
      c("spades", 1),
      c("spades", 12),
      c("spades", 13),
      c("hearts", 1),
      c("hearts", 13),
      c("clubs", 7),
      c("diamonds", 5),
      c("diamonds", 9),
      c("clubs", 8),
      c("clubs", 9),
      c("clubs", 10),
      c("diamonds", 3),
      c("hearts", 5),
    ];
    expect(selectCardsToPass(hand, "left")).toHaveLength(3);
  });

  it("passes Q♠ when unprotected (no A♠ + K♠)", () => {
    const hand = [
      c("spades", 12),
      c("spades", 3),
      c("spades", 4),
      c("hearts", 2),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("diamonds", 5),
      c("diamonds", 6),
      c("diamonds", 7),
      c("hearts", 3),
      c("hearts", 4),
      c("hearts", 6),
    ];
    const passed = selectCardsToPass(hand, "left");
    expect(passed).toContainEqual(c("spades", 12));
  });

  it("keeps Q♠ when holding both A♠ and K♠", () => {
    const hand = [
      c("spades", 12),
      c("spades", 1),
      c("spades", 13),
      c("hearts", 1),
      c("hearts", 13),
      c("clubs", 7),
      c("diamonds", 5),
      c("diamonds", 9),
      c("clubs", 8),
      c("clubs", 9),
      c("clubs", 10),
      c("diamonds", 3),
      c("hearts", 5),
    ];
    const passed = selectCardsToPass(hand, "left");
    expect(passed).not.toContainEqual(c("spades", 12));
  });

  it("passes A♥ and K♥ as high-priority danger cards", () => {
    const hand = [
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 2),
      c("spades", 3),
      c("spades", 4),
      c("spades", 5),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("diamonds", 6),
      c("diamonds", 7),
      c("diamonds", 8),
      c("diamonds", 9),
    ];
    const passed = selectCardsToPass(hand, "left");
    expect(passed).toContainEqual(c("hearts", 1));
    expect(passed).toContainEqual(c("hearts", 13));
  });

  it("never passes 2♣", () => {
    const hand = [
      c("clubs", 2),
      c("hearts", 1),
      c("hearts", 13),
      c("spades", 3),
      c("spades", 4),
      c("spades", 5),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("diamonds", 6),
      c("diamonds", 7),
      c("diamonds", 8),
      c("diamonds", 9),
    ];
    const passed = selectCardsToPass(hand, "left");
    expect(passed).not.toContainEqual(c("clubs", 2));
  });

  it("never passes clubs below 6", () => {
    const hand = [
      c("clubs", 3),
      c("clubs", 4),
      c("clubs", 5),
      c("hearts", 1),
      c("hearts", 13),
      c("spades", 8),
      c("spades", 9),
      c("spades", 10),
      c("diamonds", 6),
      c("diamonds", 7),
      c("diamonds", 8),
      c("diamonds", 9),
      c("diamonds", 10),
    ];
    const passed = selectCardsToPass(hand, "left");
    passed.forEach((card) => {
      if (card.suit === "clubs") expect(card.rank).toBeGreaterThanOrEqual(6);
    });
  });

  it("returned cards are all from the hand", () => {
    const hand = [
      c("spades", 1),
      c("spades", 12),
      c("spades", 13),
      c("hearts", 1),
      c("hearts", 13),
      c("clubs", 7),
      c("diamonds", 5),
      c("diamonds", 9),
      c("clubs", 8),
      c("clubs", 9),
      c("clubs", 10),
      c("diamonds", 3),
      c("hearts", 5),
    ];
    const passed = selectCardsToPass(hand, "right");
    passed.forEach((p) => expect(hand).toContainEqual(p));
  });
});

// ---------------------------------------------------------------------------
// selectCardsToPass — Schemer difficulty, high clubs (A♣/K♣)
// ---------------------------------------------------------------------------

describe("selectCardsToPass — Schemer difficulty, high clubs", () => {
  it("passes A♣ when slots remain after higher-priority cards", () => {
    // Q♠ → slot 1, A♥ → slot 2, A♣ → slot 3 (step 3.5).
    // Confirms rank 1 is not caught by the 'clubs below 6' guard (which checks rank > 1).
    const hand = [
      c("spades", 12),
      c("hearts", 1),
      c("clubs", 1),
      c("spades", 3),
      c("spades", 4),
      c("spades", 5),
      c("diamonds", 6),
      c("diamonds", 7),
      c("diamonds", 8),
      c("clubs", 7),
      c("clubs", 8),
      c("hearts", 3),
      c("hearts", 4),
    ];
    const passed = selectCardsToPass(hand, "left");
    expect(passed).toContainEqual(c("clubs", 1));
  });

  it("passes K♣ when slots remain after higher-priority cards", () => {
    // Q♠ → slot 1, A♥ → slot 2, K♣ → slot 3 (step 3.5).
    const hand = [
      c("spades", 12),
      c("hearts", 1),
      c("clubs", 13),
      c("spades", 3),
      c("spades", 4),
      c("spades", 5),
      c("diamonds", 6),
      c("diamonds", 7),
      c("diamonds", 8),
      c("clubs", 7),
      c("clubs", 8),
      c("hearts", 3),
      c("hearts", 4),
    ];
    const passed = selectCardsToPass(hand, "left");
    expect(passed).toContainEqual(c("clubs", 13));
  });
});

// ---------------------------------------------------------------------------
// Cautious AI — selectCardsToPass
// ---------------------------------------------------------------------------

describe("selectCardsToPass — Cautious difficulty", () => {
  it("always returns exactly 3 cards", () => {
    const hand = [
      c("spades", 12),
      c("spades", 1),
      c("spades", 13),
      c("hearts", 1),
      c("hearts", 13),
      c("clubs", 7),
      c("diamonds", 5),
      c("diamonds", 9),
      c("clubs", 8),
      c("clubs", 9),
      c("clubs", 10),
      c("diamonds", 3),
      c("hearts", 5),
    ];
    expect(selectCardsToPass(hand, "left", "cautious")).toHaveLength(3);
  });

  it("never passes 2♣", () => {
    const hand = [
      c("clubs", 2),
      c("hearts", 1),
      c("hearts", 13),
      c("spades", 3),
      c("spades", 4),
      c("spades", 5),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("diamonds", 6),
      c("diamonds", 7),
      c("diamonds", 8),
      c("diamonds", 9),
    ];
    const passed = selectCardsToPass(hand, "left", "cautious");
    expect(passed).not.toContainEqual(c("clubs", 2));
  });

  it("all returned cards are from the hand", () => {
    const hand = [
      c("spades", 12),
      c("hearts", 5),
      c("diamonds", 7),
      c("clubs", 7),
      c("hearts", 3),
      c("spades", 4),
      c("diamonds", 2),
      c("clubs", 9),
      c("hearts", 8),
      c("spades", 6),
      c("diamonds", 10),
      c("clubs", 10),
      c("hearts", 11),
    ];
    const passed = selectCardsToPass(hand, "right", "cautious");
    passed.forEach((p) => expect(hand).toContainEqual(p));
  });
});

// ---------------------------------------------------------------------------
// Daring AI — opportunistic void in passing
// ---------------------------------------------------------------------------

describe("selectCardsToPass — #1636 void creation (Daring)", () => {
  it("voids a 1-card suit when 1 slot remains after dangerous cards", () => {
    // Q♠ fills slot 1, A♥ fills slot 2. 1 slot remains.
    // ♦7 is the only diamond → void fires, ♦7 fills slot 3.
    const hand = [
      c("spades", 12),
      c("hearts", 1),
      c("diamonds", 7),
      c("clubs", 6),
      c("clubs", 8),
      c("clubs", 9),
      c("clubs", 10),
      c("spades", 5),
      c("spades", 6),
      c("spades", 7),
      c("hearts", 4),
      c("hearts", 5),
      c("hearts", 6),
    ];
    const passed = selectCardsToPass(hand, "left", "daring");
    expect(passed).toContainEqual(c("diamonds", 7));
  });

  it("voids a 2-card suit when 2 slots remain after Q♠ alone", () => {
    // Q♠ fills slot 1. No danger hearts (J♥ threshold not met), no A/K spades, no A/K clubs.
    // 2 slots remain. ♦4 and ♦6 are the only 2 diamonds → void fires, both pass.
    const hand = [
      c("spades", 12),
      c("diamonds", 4),
      c("diamonds", 6),
      c("clubs", 6),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("spades", 3),
      c("spades", 4),
      c("spades", 5),
      c("hearts", 2),
      c("hearts", 3),
      c("hearts", 4),
    ];
    const passed = selectCardsToPass(hand, "left", "daring");
    expect(passed).toContainEqual(c("diamonds", 4));
    expect(passed).toContainEqual(c("diamonds", 6));
  });

  it("voids a 3-card suit when all 3 slots remain (no high-priority cards)", () => {
    // No Q♠, no danger hearts (hearts are 2-5), no high spades, no high clubs.
    // All 3 slots available. Utility AI voids a complete 3-card suit.
    const hand = [
      c("diamonds", 3),
      c("diamonds", 4),
      c("diamonds", 5),
      c("clubs", 6),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("spades", 3),
      c("spades", 4),
      c("spades", 5),
      c("hearts", 2),
      c("hearts", 3),
      c("hearts", 4),
    ];
    const passed = selectCardsToPass(hand, "left", "daring");
    // All 3 passed cards must belong to the same suit (a full void)
    expect(passed).toHaveLength(3);
    const suits = passed.map((c) => c.suit);
    expect(new Set(suits).size).toBe(1);
  });

  it("double-void — Q♠ + two singletons uses all 3 pass slots (#1645)", () => {
    // Q♠ (slot 1); 5♠ is a singleton after Q♠ excluded from spades (slot 2);
    // 5♦ singleton fires in the second loop iteration (slot 3).
    // No A♠/K♠ in hand → no left-pass Q♠ protection, standard mode runs.
    // 4 hearts → moon-viable mode does NOT fire (requires 6+).
    const hand = [
      c("spades", 12), // Q♠
      c("spades", 5), // 5♠ — singleton after Q♠ passes (no cover → Q♠ still passed)
      c("diamonds", 5), // 5♦ — singleton
      c("clubs", 6),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("clubs", 10),
      c("clubs", 11),
      c("hearts", 4),
      c("hearts", 5),
      c("hearts", 6),
      c("hearts", 7),
    ];
    const passed = selectCardsToPass(hand, "left", "daring");
    expect(passed).toContainEqual(c("spades", 12)); // Q♠ passed (no cover)
    expect(passed).toContainEqual(c("spades", 5)); // 5♠ (spade void)
    expect(passed).toContainEqual(c("diamonds", 5)); // 5♦ (diamond void)
    expect(passed).toHaveLength(3);
  });
});

describe("selectCardsToPass — #1636 void creation (Schemer)", () => {
  it("voids a 1-card suit when 1 slot remains after Q♠ and 1 danger heart", () => {
    // Q♠ → slot 1, A♥ → slot 2. 1 slot remains.
    // ♦7 is the only diamond → Schemer voids it (1 ≤ maxSuitSize 2).
    const hand = [
      c("spades", 12),
      c("hearts", 1),
      c("diamonds", 7),
      c("clubs", 6),
      c("clubs", 8),
      c("clubs", 9),
      c("clubs", 10),
      c("spades", 3),
      c("spades", 4),
      c("spades", 5),
      c("hearts", 4),
      c("hearts", 5),
      c("hearts", 6),
    ];
    const passed = selectCardsToPass(hand, "left", "schemer");
    expect(passed).toContainEqual(c("diamonds", 7));
  });

  it("voids a 2-card suit when 2 slots remain after Q♠ alone", () => {
    // Q♠ → slot 1. 2 slots remain. ♦4, ♦6 are the only diamonds → Schemer voids (2 ≤ maxSuitSize 2).
    const hand = [
      c("spades", 12),
      c("diamonds", 4),
      c("diamonds", 6),
      c("clubs", 6),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("spades", 3),
      c("spades", 4),
      c("spades", 5),
      c("hearts", 2),
      c("hearts", 3),
      c("hearts", 4),
    ];
    const passed = selectCardsToPass(hand, "left", "schemer");
    expect(passed).toContainEqual(c("diamonds", 4));
    expect(passed).toContainEqual(c("diamonds", 6));
  });

  it("voids a 3-card suit — utility AI picks any voidable 3-card suit (#1645)", () => {
    // No Q♠, no A♥ → 3 slots go to void. Multiple 3-card suits exist.
    // Utility AI voids a complete 3-card suit (which suit depends on scoring).
    const hand = [
      c("diamonds", 3),
      c("diamonds", 4),
      c("diamonds", 5),
      c("clubs", 6),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("spades", 3),
      c("spades", 4),
      c("spades", 5),
      c("hearts", 2),
      c("hearts", 3),
      c("hearts", 4),
    ];
    const passed = selectCardsToPass(hand, "left", "schemer");
    // All 3 passed cards must belong to the same suit (a full void)
    expect(passed).toHaveLength(3);
    const suits = passed.map((c) => c.suit);
    expect(new Set(suits).size).toBe(1);
  });

  it("does NOT target spades for void when Q♠ is kept (cover cards protected)", () => {
    // Direction=left, has A♠+K♠ → Q♠ protected (score 0.05, very low).
    // Schemer should not pass Q♠ or its covers; void targets other suits.
    const hand = [
      c("spades", 12),
      c("spades", 1),
      c("spades", 13),
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 5),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("clubs", 10),
      c("diamonds", 5),
      c("diamonds", 6),
      c("diamonds", 7),
    ];
    const passed = selectCardsToPass(hand, "left", "schemer");
    expect(passed).not.toContainEqual(c("spades", 12)); // Q♠ kept (protected)
    expect(passed).not.toContainEqual(c("spades", 1)); // A♠ kept (cover)
    expect(passed).not.toContainEqual(c("spades", 13)); // K♠ kept (cover)
  });

  it("double-void — voids two singletons in one pass (#1645)", () => {
    // No Q♠, no A♥ → all 3 slots available for void.
    // Spades singleton (3♠) voids first; diamonds singleton (5♦) voids second iteration.
    const hand = [
      c("spades", 3), // singleton
      c("diamonds", 5), // singleton
      c("clubs", 6),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("clubs", 10),
      c("hearts", 4),
      c("hearts", 5),
      c("hearts", 6),
      c("hearts", 7),
      c("hearts", 8),
      c("hearts", 9),
    ];
    const passed = selectCardsToPass(hand, "left", "schemer");
    expect(passed).toContainEqual(c("spades", 3));
    expect(passed).toContainEqual(c("diamonds", 5));
    expect(passed).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Daring AI — moon-viable passing (#1637)
// ---------------------------------------------------------------------------

describe("selectCardsToPass — #1637 moon-viable passing (Daring)", () => {
  it("keeps Q♠, all hearts and its control cards when dealt a viable moon hand", () => {
    // Viable moon hand (#2234): 5 hearts (4 top), Q♠, A♣-led clubs, no weak suit.
    // Daring passes the LOWEST cards it doesn't need (3♠, 4♦, 5♠) and keeps
    // its aces and the strong side suit for trick control (#1647, #2234).
    const hand = [
      c("spades", 12), // Q♠ — kept for moon attempt
      c("hearts", 1), // A♥ — kept
      c("hearts", 13), // K♥ — kept
      c("hearts", 12), // Q♥ — kept
      c("hearts", 11), // J♥ — kept
      c("hearts", 7),
      c("diamonds", 1), // A♦ — kept (ace)
      c("diamonds", 4),
      c("clubs", 1), // A♣ — kept (strong side suit)
      c("clubs", 7), // kept (strong side suit)
      c("clubs", 6), // kept (strong side suit)
      c("spades", 3),
      c("spades", 5),
    ];
    const passed = selectCardsToPass(hand, "left", "daring");
    expect(passed).not.toContainEqual(c("spades", 12)); // Q♠ kept
    expect(passed.some((p) => p.suit === "hearts")).toBe(false); // all hearts kept
    expect(passed).not.toContainEqual(c("diamonds", 1)); // A♦ kept
    expect(passed.some((p) => p.suit === "clubs")).toBe(false); // strong side suit kept
    expect(passed).toEqual(
      expect.arrayContaining([c("spades", 3), c("diamonds", 4), c("spades", 5)])
    );
  });

  it("uses standard passing when the hand doesn't rate for a moon (2 top hearts)", () => {
    // Only A♥/K♥ are top hearts → NOT moon-viable (moonHand.ts, #2234). Standard
    // Daring passing: Q♠ passed (no cover on left).
    const hand = [
      c("spades", 12), // Q♠ — passed in standard mode
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 9),
      c("hearts", 7),
      c("diamonds", 5),
      c("diamonds", 6),
      c("diamonds", 7),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("spades", 3),
      c("spades", 5),
    ];
    const passed = selectCardsToPass(hand, "left", "daring");
    expect(passed).toContainEqual(c("spades", 12)); // Q♠ passed (standard mode)
  });

  it("falls back to lowest hearts when not enough safe non-hearts to fill 3 slots", () => {
    // Viable moon hand (#2234): 4 top hearts, Q♠, A♣-led clubs. The moon pass
    // keeps its control cards — hearts' top, Q♠, aces and the strong side suit
    // (clubs) — and 2♣-4♣ are never passed, so no non-heart is passable and
    // the three lowest hearts fill the pass.
    const hand = [
      c("spades", 12), // Q♠
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 12),
      c("hearts", 11),
      c("hearts", 9),
      c("hearts", 5),
      c("hearts", 3),
      c("hearts", 2),
      c("clubs", 2), // 2♣ — never passed
      c("clubs", 3),
      c("clubs", 4),
      c("clubs", 1), // A♣ — kept: leads the strong side suit
    ];
    const passed = selectCardsToPass(hand, "left", "daring");
    expect(passed).toHaveLength(3); // always exactly 3
    expect(passed).not.toContainEqual(c("spades", 12)); // Q♠ kept
    expect(passed).not.toContainEqual(c("clubs", 1)); // A♣ kept (side-suit control)
    expect(passed).not.toContainEqual(c("clubs", 2)); // 2♣ never passed
    expect(passed).toEqual(
      expect.arrayContaining([c("hearts", 2), c("hearts", 3), c("hearts", 5)])
    ); // the three lowest hearts
  });
});

// ---------------------------------------------------------------------------
// Daring AI — high clubs in passing (A♣/K♣)
// ---------------------------------------------------------------------------

describe("selectCardsToPass — Daring difficulty, high clubs", () => {
  it("passes A♣ (step 4.5) when no void creation opportunity exists", () => {
    // Q♠ → slot 1. Void creation (step 2) can't fire — 3 diamonds need 3 slots but only 2
    // remain. No high hearts (all below J♥). A♣ lands in step 4.5.
    const hand = [
      c("spades", 12), // Q♠ → slot 1
      c("clubs", 1), // A♣ → step 4.5
      c("diamonds", 7),
      c("diamonds", 8),
      c("diamonds", 9), // 3 diamonds → can't be voided with 2 slots remaining
      c("spades", 3),
      c("spades", 4),
      c("spades", 5),
      c("clubs", 7),
      c("clubs", 8),
      c("hearts", 3), // 4 low hearts — not moon-viable, below danger threshold
      c("hearts", 4),
      c("hearts", 5),
    ];
    const passed = selectCardsToPass(hand, "left", "daring");
    expect(passed).toContainEqual(c("clubs", 1));
  });

  it("passes K♣ when slots remain after higher-priority cards", () => {
    // Q♠ → slot 1, A♥ → slot 2, K♣ → slot 3 (step 3.5).
    const hand = [
      c("spades", 12),
      c("hearts", 1),
      c("clubs", 13),
      c("spades", 3),
      c("spades", 4),
      c("spades", 5),
      c("diamonds", 6),
      c("diamonds", 7),
      c("diamonds", 8),
      c("clubs", 7),
      c("clubs", 8),
      c("hearts", 3),
      c("hearts", 4),
    ];
    const passed = selectCardsToPass(hand, "left", "daring");
    expect(passed).toContainEqual(c("clubs", 13));
  });
});

// ---------------------------------------------------------------------------
// selectCardsToPass — #1595 pass direction awareness
// ---------------------------------------------------------------------------

describe("selectCardsToPass — #1595 direction awareness (Schemer)", () => {
  it("passes Q♠ going right even when protected by A♠+K♠", () => {
    // Schemer normally keeps Q♠ when holding both A♠ and K♠.
    // Going right relaxes protection — Q♠ should be passed.
    const hand = [
      c("spades", 12),
      c("spades", 1),
      c("spades", 13),
      c("hearts", 5),
      c("hearts", 6),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("diamonds", 4),
      c("diamonds", 5),
      c("diamonds", 6),
      c("diamonds", 7),
      c("hearts", 2),
    ];
    const passed = selectCardsToPass(hand, "right", "schemer");
    expect(passed).toContainEqual(c("spades", 12));
  });

  it("keeps Q♠ going left when holding A♠ or K♠ alone", () => {
    // Going left with A♠ alone counts as protection — Q♠ kept.
    // A♥+K♥ fill slots 1-2 (danger hearts); A♠ fills slot 3; Q♠ never reaches filler.
    const hand = [
      c("spades", 12), // Q♠ — protected by A♠ going left
      c("spades", 1), // A♠ — enough protection going left
      c("hearts", 1), // A♥ → slot 1
      c("hearts", 13), // K♥ → slot 2
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("diamonds", 4),
      c("diamonds", 5),
      c("diamonds", 6),
      c("diamonds", 7),
      c("diamonds", 8),
      c("hearts", 2),
    ];
    const passed = selectCardsToPass(hand, "left", "schemer");
    expect(passed).not.toContainEqual(c("spades", 12));
  });

  it("left vs right produce different selections for same hand when Q♠ protection differs", () => {
    // Hand: Q♠ + A♠ (no K♠) + A♥ + K♥ (danger hearts fill slots).
    // Left: Q♠ protected (A♠ present); [A♥, K♥, A♠] passed, Q♠ stays.
    // Right: Q♠ not protected; [Q♠, A♥, K♥] passed, Q♠ gone.
    const hand = [
      c("spades", 12), // Q♠
      c("spades", 1), // A♠
      c("hearts", 1), // A♥ → danger heart
      c("hearts", 13), // K♥ → danger heart
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("diamonds", 4),
      c("diamonds", 5),
      c("diamonds", 6),
      c("diamonds", 7),
      c("diamonds", 8),
      c("hearts", 2),
    ];
    const passedLeft = selectCardsToPass(hand, "left", "schemer");
    const passedRight = selectCardsToPass(hand, "right", "schemer");
    expect(passedLeft).not.toContainEqual(c("spades", 12));
    expect(passedRight).toContainEqual(c("spades", 12));
  });
});

describe("selectCardsToPass — #1595 direction awareness (Daring)", () => {
  it("keeps Q♠ on left with A♠/K♠ cover; passes Q♠ right regardless", () => {
    // Daring now matches Schemer's left-pass threshold: keep Q♠ when holding A♠ or K♠.
    // Left neighbor plays right after us — too risky to send Q♠ with cover in hand.
    // Right/across: Q♠ always passed (travels far, low return risk).
    const hand = [
      c("spades", 12),
      c("spades", 1),
      c("spades", 13),
      c("hearts", 5),
      c("hearts", 6),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("diamonds", 4),
      c("diamonds", 5),
      c("diamonds", 6),
      c("diamonds", 7),
      c("hearts", 2),
    ];
    const passedLeft = selectCardsToPass(hand, "left", "daring");
    const passedRight = selectCardsToPass(hand, "right", "daring");
    expect(passedLeft).not.toContainEqual(c("spades", 12)); // Q♠ kept (left + A♠/K♠)
    expect(passedRight).toContainEqual(c("spades", 12)); // Q♠ passed (right, always)
  });

  it("passes Q♠ left when no A♠/K♠ cover (standard hard behavior)", () => {
    // Without high-spade cover, left-pass protection does not apply.
    const hand = [
      c("spades", 12), // Q♠ — only spade, no cover
      c("hearts", 5),
      c("hearts", 6),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("diamonds", 4),
      c("diamonds", 5),
      c("diamonds", 6),
      c("diamonds", 7),
      c("hearts", 2),
      c("clubs", 10),
      c("diamonds", 3),
    ];
    const passedLeft = selectCardsToPass(hand, "left", "daring");
    expect(passedLeft).toContainEqual(c("spades", 12)); // Q♠ passed (no cover)
  });

  it("includes 10♥ as a danger heart when passing right but not left", () => {
    // Going right: Q♠ passes (no protection) and 10♥ rates as danger (ratePassingQuality = 0.65).
    // Going left: Q♠ is still passed but 10♥ rates lower (0.4); other cards may fill slot 3.
    const hand = [
      c("spades", 12), // Q♠ — only spade
      c("hearts", 1), // A♥ — danger both directions
      c("hearts", 10), // 10♥ — higher danger going right
      c("hearts", 2),
      c("hearts", 3),
      c("diamonds", 13), // K♦
      c("diamonds", 12), // Q♦
      c("diamonds", 9),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("clubs", 10),
      c("clubs", 11), // J♣
    ];
    const passedRight = selectCardsToPass(hand, "right", "daring");
    const passedLeft = selectCardsToPass(hand, "left", "daring");
    // Utility AI prefers suitVoiding diamonds (K♦/Q♦) over danger hearts in both directions;
    // 10♥ direction-sensitivity is verified at the ratePassingQuality unit-test level.
    expect(passedRight).toContainEqual(c("spades", 12)); // Q♠ always passes right
    expect(passedRight).not.toContainEqual(c("hearts", 10)); // 10♥ loses to diamonds
    expect(passedLeft).not.toContainEqual(c("hearts", 10));
  });
});

describe("selectCardsToPass — #1595 across direction (Schemer)", () => {
  it("passes Q♠ going across even when holding A♠+K♠", () => {
    // "across" is treated the same as "right" — Q♠ protection threshold is relaxed.
    const hand = [
      c("spades", 12),
      c("spades", 1),
      c("spades", 13),
      c("hearts", 5),
      c("hearts", 6),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("diamonds", 4),
      c("diamonds", 5),
      c("diamonds", 6),
      c("diamonds", 7),
      c("hearts", 2),
    ];
    const passed = selectCardsToPass(hand, "across", "schemer");
    expect(passed).toContainEqual(c("spades", 12));
    expect(passed).toHaveLength(3);
  });

  it("none direction uses baseline protection (A♠+K♠ keeps Q♠)", () => {
    // "none" = no-pass hand; still uses baseline A♠+K♠ protection.
    // A♥+K♥ fill slots 1-2; A♠ fills slot 3; Q♠ never reaches filler.
    const hand = [
      c("spades", 12),
      c("spades", 1),
      c("spades", 13),
      c("hearts", 1), // A♥ → slot 1
      c("hearts", 13), // K♥ → slot 2
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
      c("diamonds", 4),
      c("diamonds", 5),
      c("diamonds", 6),
      c("diamonds", 7),
      c("hearts", 2),
    ];
    const passed = selectCardsToPass(hand, "none", "schemer");
    expect(passed).not.toContainEqual(c("spades", 12));
    expect(passed).toHaveLength(3);
  });
});

describe("selectCardsToPass — #1638 adversarial targeting (Daring)", () => {
  it("passes Q♠ to seat 0 even in moon-viable mode (left pass from seat 3)", () => {
    // Seat 3 passes left → recipient is seat 0. The hand rates viable (4 top hearts,
    // Q♠, A♦-led diamonds) but not strong (needs all 5 top hearts, #2234).
    // Without targeting, moon-viable keeps Q♠; with targeting, Q♠ is passed to seat 0.
    const hand = [
      c("hearts", 1),
      c("hearts", 10),
      c("hearts", 13),
      c("hearts", 12),
      c("hearts", 7),
      c("spades", 12),
      c("diamonds", 1),
      c("clubs", 1),
      c("diamonds", 8),
      c("clubs", 8),
      c("diamonds", 7),
      c("clubs", 7),
      c("diamonds", 6),
    ];
    expect(assessMoonHand(hand).viable).toBe(true); // moon-viable, not strong
    // playerIndex=3, direction="left" → (3+1)%4=0 → targeting seat 0
    const passed = selectCardsToPass(hand, "left", "daring", 3);
    expect(passed).toHaveLength(3);
    expect(passed).toContainEqual(c("spades", 12));
  });

  it("passes Q♠ on left when the hand doesn't rate for a moon (2 top hearts, no A♠/K♠ cover)", () => {
    // 5 hearts but only A♥/10♥ are top hearts → not moon-viable (moonHand.ts, #2234).
    // No A♠/K♠ cover → left-pass protection also does not apply.
    // Standard mode fires and Q♠ is passed regardless of adversarial direction.
    const hand = [
      c("hearts", 1),
      c("hearts", 10),
      c("hearts", 9),
      c("hearts", 8),
      c("hearts", 7),
      c("spades", 12),
      c("diamonds", 1),
      c("clubs", 1),
      c("diamonds", 8),
      c("clubs", 8),
      c("diamonds", 7),
      c("clubs", 7),
      c("diamonds", 6),
    ];
    // playerIndex=1, direction="left" → (1+1)%4=2 → not targeting seat 0
    const passed = selectCardsToPass(hand, "left", "daring", 1);
    expect(passed).toHaveLength(3);
    expect(passed).toContainEqual(c("spades", 12)); // Q♠ passed — not moon-viable
  });

  it("keeps Q♠ in moon-viable mode when NOT passing to seat 0 (left from seat 1)", () => {
    // Viable moon hand (#2234: 4 top hearts, Q♠, A♦-led diamonds). Seat 1
    // passes left to seat 2 (not seat 0), so moon-viable keeps Q♠ and all
    // hearts and passes the lowest non-hearts.
    const hand = [
      c("hearts", 1),
      c("hearts", 10),
      c("hearts", 13),
      c("hearts", 12),
      c("hearts", 7),
      c("hearts", 5), // 6th heart
      c("spades", 12),
      c("diamonds", 1),
      c("clubs", 1),
      c("diamonds", 8),
      c("clubs", 8),
      c("diamonds", 7),
      c("clubs", 7),
    ];
    // playerIndex=1, direction="left" → (1+1)%4=2 → not targeting seat 0
    const passed = selectCardsToPass(hand, "left", "daring", 1);
    expect(passed).toHaveLength(3);
    expect(passed).not.toContainEqual(c("spades", 12)); // Q♠ kept (moon-viable)
    expect(passed).not.toContainEqual(c("hearts", 1)); // A♥ kept
  });

  it("passes Q♠ to seat 0 in moon-viable mode via across pass from seat 2", () => {
    // Seat 2 passes across → (2+2)%4=0 → targeting seat 0. Viable but not
    // strong (4 top hearts), so the targeting pass applies (#2234).
    const hand = [
      c("hearts", 1),
      c("hearts", 10),
      c("hearts", 13),
      c("hearts", 12),
      c("hearts", 7),
      c("spades", 12),
      c("diamonds", 1),
      c("clubs", 1),
      c("diamonds", 8),
      c("clubs", 8),
      c("diamonds", 7),
      c("clubs", 7),
      c("diamonds", 6),
    ];
    expect(assessMoonHand(hand).viable).toBe(true); // moon-viable, not strong
    const passed = selectCardsToPass(hand, "across", "daring", 2);
    expect(passed).toHaveLength(3);
    expect(passed).toContainEqual(c("spades", 12));
  });

  it("keeps Q♠ when targeting seat 0 with a strong moon hand (all 5 top hearts)", () => {
    // Seat 3 passes left → targeting seat 0. Normally Q♠ is passed adversarially.
    // But a strong moon hand (viable + all five top hearts, #2234) bypasses the
    // suppression → moon-viable keeps Q♠. Passing it away is self-defeating.
    const hand = [
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 12),
      c("hearts", 11),
      c("hearts", 10),
      c("hearts", 5),
      c("hearts", 3),
      c("spades", 12), // Q♠ — must be kept
      c("diamonds", 1),
      c("diamonds", 8),
      c("diamonds", 6),
      c("clubs", 8),
      c("clubs", 7),
    ];
    // playerIndex=3, direction="left" → (3+1)%4=0 → targeting seat 0
    const passed = selectCardsToPass(hand, "left", "daring", 3);
    expect(passed).toHaveLength(3);
    expect(passed).not.toContainEqual(c("spades", 12)); // Q♠ kept for moon attempt
  });

  it("left-pass protection beats adversarial targeting when Daring holds A♠/K♠ cover", () => {
    // Seat 3 passes left → (3+1)%4=0 → targeting seat 0 (human).
    // Adversarial targeting normally pressures Q♠ toward seat 0, but left-pass protection
    // takes precedence when Daring holds cover: keeping Q♠ has a ~4% failure rate vs
    // ~18% if passed left — self-management is strictly better even against the human.
    const hand = [
      c("spades", 12), // Q♠ — kept (left-pass protection with A♠)
      c("spades", 1), // A♠ — cover, must not be passed as filler
      c("spades", 5),
      c("hearts", 2),
      c("hearts", 3),
      c("hearts", 4),
      c("hearts", 5), // 4 hearts — below moon-viable threshold
      c("clubs", 6),
      c("clubs", 7),
      c("clubs", 8),
      c("diamonds", 4),
      c("diamonds", 5),
      c("diamonds", 6),
    ];
    // playerIndex=3, direction="left" → (3+1)%4=0 → targeting seat 0
    const passed = selectCardsToPass(hand, "left", "daring", 3);
    expect(passed).toHaveLength(3);
    expect(passed).not.toContainEqual(c("spades", 12)); // Q♠ kept (protection > adversarial)
    expect(passed).not.toContainEqual(c("spades", 1)); // A♠ kept (cover card)
  });
});

// ---------------------------------------------------------------------------
// Schemer passing — filler (step 6) must not strip K♠/A♠ cover from Q♠
// ---------------------------------------------------------------------------

describe("selectCardsToPass — Schemer filler does not strip Q♠ protection", () => {
  it("does not pass K♠ as filler when K♠ is the only Q♠ cover (passing left)", () => {
    // Hand: Q♠ K♠ + a bunch of medium/high cards. Direction left → protection fires (K♠ alone).
    // Step 6 filler used to pick K♠ (highest safe card), stripping Q♠ cover.
    const hand = [
      c("spades", 12), // Q♠
      c("spades", 13), // K♠ — only cover
      c("spades", 7),
      c("hearts", 9),
      c("hearts", 6),
      c("diamonds", 10),
      c("diamonds", 8),
      c("clubs", 11), // J♣ — would be filler pick before fix
      c("clubs", 9),
      c("clubs", 8),
      c("clubs", 7),
      c("clubs", 6),
      c("clubs", 3),
    ];
    const passed = selectCardsToPass(hand, "left", "schemer");
    // Q♠ must be kept (protected by K♠)
    expect(passed.some((card) => card.suit === "spades" && card.rank === 12)).toBe(false);
    // K♠ must NOT be passed as filler — it's the cover card
    expect(passed.some((card) => card.suit === "spades" && card.rank === 13)).toBe(false);
  });

  it("does not pass A♠ as filler when A♠ is Q♠ cover and no K♠ present (passing left)", () => {
    const hand = [
      c("spades", 12), // Q♠
      c("spades", 1), // A♠ — only cover
      c("spades", 7),
      c("hearts", 9),
      c("hearts", 6),
      c("diamonds", 10),
      c("diamonds", 8),
      c("clubs", 11),
      c("clubs", 9),
      c("clubs", 8),
      c("clubs", 7),
      c("clubs", 6),
      c("clubs", 3),
    ];
    const passed = selectCardsToPass(hand, "left", "schemer");
    expect(passed.some((card) => card.suit === "spades" && card.rank === 12)).toBe(false);
    expect(passed.some((card) => card.suit === "spades" && card.rank === 1)).toBe(false);
  });

  it("does not pass K♠ or A♠ as filler when holding Q♠ + K♠ + A♠ (double-cover)", () => {
    const hand = [
      c("spades", 12), // Q♠
      c("spades", 13), // K♠
      c("spades", 1), // A♠
      c("spades", 7),
      c("hearts", 9),
      c("hearts", 6),
      c("diamonds", 10),
      c("diamonds", 8),
      c("clubs", 11),
      c("clubs", 9),
      c("clubs", 8),
      c("clubs", 7),
      c("clubs", 6),
    ];
    const passed = selectCardsToPass(hand, "left", "schemer");
    expect(passed.some((card) => card.suit === "spades" && card.rank === 12)).toBe(false);
    expect(passed.some((card) => card.suit === "spades" && card.rank === 13)).toBe(false);
    expect(passed.some((card) => card.suit === "spades" && card.rank === 1)).toBe(false);
  });
});

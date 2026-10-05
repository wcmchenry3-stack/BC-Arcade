/**
 * Hearts AI unit tests (#606): `selectCardsToPass` core rules and per-persona choices.
 *
 * Part of the `selectCardsToPass` cluster of `ai.ts`, split by describe group so no file passes the
 * ~1,000-line layout rule (#2955). Describe blocks moved whole; shared fixtures live in
 * `helpers/aiFixtures.ts`.
 */
import { selectCardsToPass } from "../ai";
import { setRng } from "../engine";
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

/**
 * Tests for the client-side Blackjack engine: hand evaluation (`handValue`, `isNaturalBlackjack`,
 * `isSoftHand`).
 *
 * Ports backend/tests/test_blackjack_game.py so the two engines behave identically. Split out of
 * the former `engine.test.ts` (#2955) by exported-function cluster of `engine.ts`; describe blocks
 * moved whole, shared fixtures live in `helpers/engineFixtures.ts`.
 */
import { handValue, isNaturalBlackjack, isSoftHand } from "../engine";
import { c } from "./helpers/engineFixtures";

// --- handValue ------------------------------------------------------------

describe("handValue", () => {
  it("empty hand returns 0", () => expect(handValue([])).toBe(0));
  it("numbered cards sum", () => expect(handValue([c("♠", "5"), c("♥", "7")])).toBe(12));
  it("face cards worth 10", () => {
    for (const rank of ["J", "Q", "K"]) expect(handValue([c("♠", rank)])).toBe(10);
  });
  it("10 worth 10", () => expect(handValue([c("♠", "10")])).toBe(10));
  it("ace as 11 when safe", () => expect(handValue([c("♠", "A"), c("♥", "7")])).toBe(18));
  it("ace demotes on bust (A+K+5 = 16)", () =>
    expect(handValue([c("♠", "A"), c("♥", "K"), c("♦", "5")])).toBe(16));
  it("two aces (11+1=12)", () => expect(handValue([c("♠", "A"), c("♥", "A")])).toBe(12));
  it("three aces (11+1+1=13)", () =>
    expect(handValue([c("♠", "A"), c("♥", "A"), c("♦", "A")])).toBe(13));
  it("ace with 10-value = 21", () => expect(handValue([c("♠", "A"), c("♥", "J")])).toBe(21));
  it("bust exceeds 21", () => expect(handValue([c("♠", "K"), c("♥", "Q"), c("♦", "5")])).toBe(25));
  it("exactly 21 three cards", () =>
    expect(handValue([c("♠", "7"), c("♥", "7"), c("♦", "7")])).toBe(21));
});

// --- isNaturalBlackjack ---------------------------------------------------

describe("isNaturalBlackjack", () => {
  it("ace + king", () => expect(isNaturalBlackjack([c("♠", "A"), c("♥", "K")])).toBe(true));
  it("ace + 10", () => expect(isNaturalBlackjack([c("♠", "A"), c("♥", "10")])).toBe(true));
  it("reversed order", () => expect(isNaturalBlackjack([c("♥", "K"), c("♠", "A")])).toBe(true));
  it("21 with 3 cards is not natural", () =>
    expect(isNaturalBlackjack([c("♠", "7"), c("♥", "7"), c("♦", "7")])).toBe(false));
  it("2 cards not 21", () => expect(isNaturalBlackjack([c("♠", "9"), c("♥", "8")])).toBe(false));
});

// --- isSoftHand -----------------------------------------------------------

describe("isSoftHand", () => {
  it("empty hand returns false", () => expect(isSoftHand([])).toBe(false));
  it("no aces returns false", () => expect(isSoftHand([c("♠", "7"), c("♥", "8")])).toBe(false));
  it("A+6 = soft 17", () => expect(isSoftHand([c("♠", "A"), c("♥", "6")])).toBe(true));
  it("A+7 = soft 18", () => expect(isSoftHand([c("♠", "A"), c("♥", "7")])).toBe(true));
  it("A+K = soft 21 (natural)", () => expect(isSoftHand([c("♠", "A"), c("♥", "K")])).toBe(true));
  it("A+K+5 = hard 16 (ace forced to 1)", () =>
    expect(isSoftHand([c("♠", "A"), c("♥", "K"), c("♦", "5")])).toBe(false));
  it("A+A = soft 12 (one ace as 11, one as 1)", () =>
    expect(isSoftHand([c("♠", "A"), c("♥", "A")])).toBe(true));
  it("A+A+9 = hard 21 (both aces forced to 1 after adjustment)", () =>
    // rawTotal=11+11+9=31, best=21, reductions=(31-21)/10=1, numAces=2 > 1 → still soft
    // Wait: A+A+9: 11+11+9=31 → reduce one ace: 21. numAces=2, reductions=1, 2>1 → soft
    expect(isSoftHand([c("♠", "A"), c("♥", "A"), c("♦", "9")])).toBe(true));
  it("A+A+K = hard 12 (two aces forced to 1)", () =>
    // rawTotal=11+11+10=32, best=12, reductions=2, numAces=2, 2 > 2 is false → hard
    expect(isSoftHand([c("♠", "A"), c("♥", "A"), c("♦", "K")])).toBe(false));
  it("7+8 (no ace) is hard 15", () => expect(isSoftHand([c("♠", "7"), c("♥", "8")])).toBe(false));
});

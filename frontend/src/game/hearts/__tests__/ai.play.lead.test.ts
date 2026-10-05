/**
 * Hearts AI unit tests (#606): `selectCardToPlay` leads (`chooseLead` / `chooseLeadHard`) and
 * persona-wide play rules.
 *
 * Part of the `selectCardToPlay` cluster of `ai.ts`, split by describe group so no file passes the
 * ~1,000-line layout rule (#2955). Describe blocks moved whole; shared fixtures live in
 * `helpers/aiFixtures.ts`.
 */
import { selectCardToPlay } from "../ai";
import { getValidPlays, setRng } from "../engine";
import type { Rank, TrickCard } from "../types";
import { c, mkState } from "./helpers/aiFixtures";

// Pin RNG to suppress cognitive noise (NOISE_RATE: Cautious 55%, Schemer 19%) so tests
// are deterministic — noise fires only when rng() < noiseRate, never at 0.99.
beforeEach(() => setRng(() => 0.99));

// ---------------------------------------------------------------------------
// selectCardToPlay — always returns a valid card
// ---------------------------------------------------------------------------

describe("selectCardToPlay — always valid", () => {
  it("returns a card that passes getValidPlays (first trick lead)", () => {
    const hand = [c("clubs", 2), c("hearts", 5), c("spades", 7)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      tricksPlayedInHand: 0,
      heartsBroken: false,
      currentTrick: [],
      currentPlayerIndex: 0,
    });
    const pick = selectCardToPlay(hand, [], state, 0);
    const valid = getValidPlays(state, 0);
    expect(valid).toContainEqual(pick);
  });

  it("returns a card that passes getValidPlays (following, must follow suit)", () => {
    const hand = [c("hearts", 3), c("hearts", 7), c("clubs", 9)];
    const trick: TrickCard[] = [{ card: c("hearts", 2), playerIndex: 0 }];
    const state = mkState({
      playerHands: [[], [hand[0]!, hand[1]!, hand[2]!], [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
    });
    const pick = selectCardToPlay(hand, trick, state, 1);
    const valid = getValidPlays(state, 1);
    expect(valid).toContainEqual(pick);
  });

  it("returns the only valid card when just one option", () => {
    const hand = [c("clubs", 2)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      tricksPlayedInHand: 0,
      currentTrick: [],
      currentPlayerIndex: 0,
    });
    const pick = selectCardToPlay(hand, [], state, 0);
    expect(pick).toEqual(c("clubs", 2));
  });
});

// ---------------------------------------------------------------------------
// Ace-high regression tests (issue #1166)
// ---------------------------------------------------------------------------

describe("selectCardToPlay — ace treated as high card", () => {
  it("chooseLead: does not lead ace when Q♠ is still live", () => {
    // A♠ risks having Q♠ discarded onto us; utility AI avoids leading it.
    const hand = [c("spades", 1), c("spades", 3)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 3,
      heartsBroken: true,
      currentPlayerIndex: 0,
    });
    const pick = selectCardToPlay(hand, [], state, 0);
    expect(pick).not.toEqual(c("spades", 1));
  });

  it("chooseDiscard: discards ace as highest heart when void in led suit", () => {
    const hand = [c("hearts", 1), c("hearts", 3), c("diamonds", 5)];
    const trick: TrickCard[] = [
      { card: c("clubs", 8), playerIndex: 0 },
      { card: c("clubs", 9), playerIndex: 1 },
      { card: c("clubs", 10), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      heartsBroken: true,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    expect(pick).toEqual(c("hearts", 1));
  });

  it("chooseDiscard: discards a club when void in spades (all clubs are non-point)", () => {
    const hand = [c("clubs", 1), c("clubs", 4), c("clubs", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 5), playerIndex: 0 },
      { card: c("spades", 6), playerIndex: 1 },
      { card: c("spades", 7), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    expect(pick.suit).toBe("clubs");
  });

  it("moon blocking: dumps ace of hearts before lower hearts", () => {
    const allHearts5 = Array.from({ length: 5 }, (_, i) => c("hearts", (i + 2) as Rank));
    const hand = [c("hearts", 1), c("hearts", 3), c("diamonds", 4)];
    const trick: TrickCard[] = [
      { card: c("spades", 4), playerIndex: 0 },
      { card: c("spades", 5), playerIndex: 1 },
      { card: c("spades", 6), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 5,
      handScores: [5, 0, 0, 0],
      wonCards: [allHearts5, [], [], []],
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    expect(pick).toEqual(c("hearts", 1));
  });
});

// ---------------------------------------------------------------------------
// Cautious AI — selectCardToPlay
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Cautious difficulty", () => {
  it("leads the lowest valid card", () => {
    const hand = [c("spades", 1), c("spades", 3), c("diamonds", 5)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 3,
      heartsBroken: true,
      currentPlayerIndex: 0,
    });
    const pick = selectCardToPlay(hand, [], state, 0, "cautious");
    // Lowest card (ace-high, so spades 3 is lowest)
    expect(pick).toEqual(c("spades", 3));
  });

  it("discards the lowest card when void in led suit", () => {
    const hand = [c("spades", 12), c("hearts", 11), c("diamonds", 3)];
    const trick: TrickCard[] = [
      { card: c("clubs", 3), playerIndex: 0 },
      { card: c("clubs", 7), playerIndex: 1 },
      { card: c("clubs", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3, "cautious");
    // Utility AI rates Q♠ off-suit void dump at 1.0 vs 0.8 for other cards while holding Q♠
    expect(pick).toEqual(c("spades", 12));
  });

  it("follows suit with the highest card that still loses (duck high, #1500, #2236)", () => {
    // 10♠ is winning with A♥ in the trick. 5♠ and 9♠ are beaten; J♠ could
    // still take the trick (and the heart). Shed 9♠ — the higher liability.
    const hand = [c("spades", 5), c("spades", 9), c("spades", 11)];
    const trick: TrickCard[] = [
      { card: c("spades", 10), playerIndex: 0 },
      { card: c("hearts", 1), playerIndex: 1 },
    ];
    const state = mkState({
      playerHands: [[], [], [hand[0]!, hand[1]!, hand[2]!], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 2,
    });
    const pick = selectCardToPlay(hand, trick, state, 2, "cautious");
    expect(pick).toEqual(c("spades", 9));
  });
});

// ---------------------------------------------------------------------------
// Daring AI — card counting (leading)
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Daring difficulty, card counting", () => {
  it("avoids leading K♠ when Q♠ is still live", () => {
    const hand = [c("spades", 13), c("spades", 2), c("clubs", 7)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 3,
      heartsBroken: true,
      currentPlayerIndex: 0,
      wonCards: [[], [], [], []], // Q♠ not seen
    });
    const pick = selectCardToPlay(hand, [], state, 0, "daring");
    // Should not lead K♠ since Q♠ might be discarded onto it
    expect(pick).not.toEqual(c("spades", 13));
  });

  it("leads a safe card when Q♠ is already in wonCards (K♠ no longer avoided)", () => {
    const hand = [c("spades", 13), c("spades", 2), c("clubs", 7)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 6,
      heartsBroken: true,
      currentPlayerIndex: 0,
      wonCards: [[c("spades", 12)], [], [], []], // Q♠ already taken
    });
    const pick = selectCardToPlay(hand, [], state, 0, "daring");
    // Q♠ is gone — K♠/A♠ risk no longer applies; any card is a safe lead.
    // Utility AI picks lowest of a safe suit (2♠ or 7♣ are expected candidates).
    expect([c("spades", 2), c("clubs", 7), c("spades", 13)]).toContainEqual(pick);
  });
});

// ---------------------------------------------------------------------------
// Regression: #1501 — medium AI avoids leading K♠/A♠ when Q♠ still live
// ---------------------------------------------------------------------------
describe("chooseLead — medium AI avoids risky spade leads (#1501)", () => {
  it("does not lead K♠ when Q♠ has not been seen", () => {
    const hand = [c("spades", 13), c("clubs", 5), c("diamonds", 7)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      currentPlayerIndex: 0,
      heartsBroken: false,
      wonCards: [[], [], [], []], // Q♠ not in wonCards
    });
    const pick = selectCardToPlay(hand, [], state, 0, "schemer");
    expect(pick).not.toEqual(c("spades", 13));
  });

  it("does not lead A♠ when Q♠ has not been seen", () => {
    const hand = [c("spades", 1), c("clubs", 4), c("diamonds", 6)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      currentPlayerIndex: 0,
      heartsBroken: false,
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, [], state, 0, "schemer");
    expect(pick).not.toEqual(c("spades", 1));
  });

  it("leads K♠ freely once Q♠ is in wonCards", () => {
    // Only K♠ is safe to lead (other cards are hearts); Q♠ already won → K♠ is safe.
    const hand = [c("spades", 13), c("hearts", 2), c("hearts", 3)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      currentPlayerIndex: 0,
      heartsBroken: true,
      wonCards: [[c("spades", 12)], [], [], []], // Q♠ has been played
    });
    const pick = selectCardToPlay(hand, [], state, 0, "schemer");
    expect(pick).toEqual(c("spades", 13));
  });
});

// ---------------------------------------------------------------------------
// #1594 — Daring AI: chooseLeadHard never leads Q♠ as fallback
// ---------------------------------------------------------------------------

describe("chooseLeadHard — Q♠ last-resort fallback (#1594) + shortest-suit lead when holding Q♠ (#1646)", () => {
  it("leads 2♥ (not Q♠ or K♠) when holding Q♠ — avoids spades to create void for dump (#1646)", () => {
    // valid = [Q♠, K♠, 2♥]: hearts broken. holdingQ=true → exclude spades from lead pool.
    // Only non-spade non-Q♠ option is 2♥ → lead 2♥ to void hearts and get a Q♠ dump opportunity.
    const hand = [c("spades", 12), c("spades", 13), c("hearts", 2)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 8,
      heartsBroken: true,
      currentPlayerIndex: 0,
      wonCards: [[], [], [], []], // Q♠ not yet played
    });
    const pick = selectCardToPlay(hand, [], state, 0, "daring");
    expect(pick).not.toEqual(c("spades", 12));
    expect(pick).toEqual(c("hearts", 2)); // only non-spade option when holding Q♠
  });

  it("leads Q♠ only when it is the sole remaining card", () => {
    const hand = [c("spades", 12)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 12,
      heartsBroken: true,
      currentPlayerIndex: 0,
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, [], state, 0, "daring");
    expect(pick).toEqual(c("spades", 12));
  });

  it("leads a non-Q♠ card when hearts outnumber other unsafe cards in fallback pool", () => {
    // valid = [Q♠, K♠, 3♥, 5♥]: K♠ has Q♠ risk (score 0.25); hearts safer.
    const hand = [c("spades", 12), c("spades", 13), c("hearts", 3), c("hearts", 5)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 5,
      heartsBroken: true,
      currentPlayerIndex: 0,
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, [], state, 0, "daring");
    expect(pick).not.toEqual(c("spades", 12)); // never leads Q♠
  });

  it("leads a non-spade card when holding Q♠ — Hard (#1646)", () => {
    // hand = [Q♠, K♦, 2♦, 7♣, 8♣, 9♣]: holdingQ → avoids spade lead.
    // Utility AI leads a diamond or club (shortest non-spade is diamonds).
    const hand = [
      c("spades", 12),
      c("diamonds", 13),
      c("diamonds", 2),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
    ];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 3,
      heartsBroken: false,
      currentPlayerIndex: 0,
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, [], state, 0, "daring");
    expect(pick).not.toEqual(c("spades", 12));
    expect(pick.suit).not.toBe("spades");
  });

  it("leads a non-spade card when holding Q♠ — Medium (#1646)", () => {
    const hand = [
      c("spades", 12),
      c("diamonds", 13),
      c("diamonds", 2),
      c("clubs", 7),
      c("clubs", 8),
      c("clubs", 9),
    ];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 3,
      heartsBroken: false,
      currentPlayerIndex: 0,
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, [], state, 0, "schemer");
    expect(pick).not.toEqual(c("spades", 12));
    expect(pick.suit).not.toBe("spades");
  });

  it("leads a non-heart safe card when NOT holding Q♠ — longest path (#1646)", () => {
    // Without Q♠: no special restriction. Utility AI leads a safe non-heart card.
    const hand = [c("diamonds", 13), c("diamonds", 2), c("clubs", 7), c("clubs", 8), c("clubs", 9)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 3,
      heartsBroken: false,
      currentPlayerIndex: 0,
      wonCards: [[], [], [], []],
    });
    const pickDaring = selectCardToPlay(hand, [], state, 0, "daring");
    const pickSchemer = selectCardToPlay(hand, [], state, 0, "schemer");
    expect(pickDaring.suit).not.toBe("hearts");
    expect(pickSchemer.suit).not.toBe("hearts");
  });
});

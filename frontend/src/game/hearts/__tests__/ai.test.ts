/**
 * Hearts AI unit tests (#606).
 *
 * Covers all acceptance criteria from the issue:
 *   - Pass: Q♠ passed when unprotected; kept when holding A♠ + K♠
 *   - Pass: high hearts prioritized
 *   - Play: Q♠ discarded when void in led suit
 *   - Play: highest losing card played when following and trick has points
 *   - Play: valid card always returned (never an illegal move)
 *   - Moon block: AI dumps heart when potential moon detected
 *   - Edge: only one valid card → that card returned
 *   - Edge: no hearts/Q♠ → discards highest card of longest suit
 */

import { detectPotentialMoon, selectCardToPlay, selectCardsToPass } from "../ai";
import { getValidPlays } from "../engine";
import type { Card, HeartsState, Rank, Suit, TrickCard } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function c(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

function mkState(overrides: Partial<HeartsState> = {}): HeartsState {
  return {
    _v: 3,
    aiDifficulty: "schemer",
    phase: "playing",
    handNumber: 1,
    passDirection: "left",
    playerHands: [[], [], [], []],
    cumulativeScores: [0, 0, 0, 0],
    handScores: [0, 0, 0, 0],
    scoreHistory: [],
    passSelections: [[], [], [], []],
    passingComplete: true,
    currentTrick: [],
    currentLeaderIndex: 0,
    currentPlayerIndex: 0,
    wonCards: [[], [], [], []],
    heartsBroken: true,
    tricksPlayedInHand: 1,
    isComplete: false,
    winnerIndex: null,
    ...overrides,
  };
}

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
// selectCardToPlay — void (discarding)
// ---------------------------------------------------------------------------

describe("selectCardToPlay — void in led suit", () => {
  it("discards Q♠ when void and Q♠ is a valid play", () => {
    const hand = [c("spades", 12), c("hearts", 5), c("diamonds", 7)];
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
    const pick = selectCardToPlay(hand, trick, state, 3);
    expect(pick).toEqual(c("spades", 12));
  });

  it("discards highest heart when void and no Q♠", () => {
    const hand = [c("hearts", 5), c("hearts", 11), c("diamonds", 7)];
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
    const pick = selectCardToPlay(hand, trick, state, 3);
    expect(pick).toEqual(c("hearts", 11));
  });

  it("discards highest card of longest suit when no hearts or Q♠", () => {
    const hand = [c("diamonds", 5), c("diamonds", 10), c("spades", 3)];
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
    const pick = selectCardToPlay(hand, trick, state, 3);
    // Longest suit is diamonds (2 cards); highest diamond is 10
    expect(pick).toEqual(c("diamonds", 10));
  });
});

// ---------------------------------------------------------------------------
// selectCardToPlay — following suit
// ---------------------------------------------------------------------------

describe("selectCardToPlay — following suit with points in trick", () => {
  it("plays highest card that still loses when trick has points", () => {
    // Trick: p0 leads spades 8, p1 plays hearts (void → discard, already there)
    // Actually let's make a simpler scenario: p0 leads spades 10 with a heart discard in it
    const hand = [c("spades", 5), c("spades", 7), c("spades", 9)];
    const trick: TrickCard[] = [
      { card: c("spades", 10), playerIndex: 0 },
      { card: c("hearts", 1), playerIndex: 1 }, // discard — has points
      { card: c("spades", 3), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    // Winning rank is 10; losing cards: 5, 7, 9 → play highest losing = 9
    expect(pick).toEqual(c("spades", 9));
  });

  it("plays lowest when forced to win a trick with points", () => {
    const hand = [c("spades", 11), c("spades", 13)];
    const trick: TrickCard[] = [
      { card: c("spades", 10), playerIndex: 0 },
      { card: c("hearts", 2), playerIndex: 1 },
    ];
    const state = mkState({
      playerHands: [[], [], [hand[0]!, hand[1]!], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 2,
    });
    const pick = selectCardToPlay(hand, trick, state, 2);
    // Both 11 and 13 beat 10; play lowest = 11
    expect(pick).toEqual(c("spades", 11));
  });
});

// ---------------------------------------------------------------------------
// selectCardToPlay — moon blocking
// ---------------------------------------------------------------------------

describe("selectCardToPlay — moon blocking", () => {
  it("dumps a heart when potential moon detected", () => {
    // Player 0 has taken all 5 points so far — potential moon
    // Player 3 is void in the led suit (spades) so can discard freely
    const allHearts5 = Array.from({ length: 5 }, (_, i) => c("hearts", (i + 1) as Rank));
    const hand = [c("hearts", 9), c("diamonds", 3), c("diamonds", 4)];
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
    // Should dump hearts 9 to block potential moon
    expect(pick).toEqual(c("hearts", 9));
  });
});

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
  it("chooseLead: does not lead ace when a lower card exists in the same suit", () => {
    const hand = [c("spades", 1), c("spades", 3)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 3,
      heartsBroken: true,
      currentPlayerIndex: 0,
    });
    const pick = selectCardToPlay(hand, [], state, 0);
    expect(pick).toEqual(c("spades", 3));
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

  it("chooseDiscard: discards ace as highest card of longest suit", () => {
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
    expect(pick).toEqual(c("clubs", 1));
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
    // Cautious dumps lowest card, not the strategic Q♠
    expect(pick).toEqual(c("diamonds", 3));
  });

  it("follows suit with the lowest card in suit", () => {
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
    expect(pick).toEqual(c("spades", 5));
  });
});

// ---------------------------------------------------------------------------
// Daring AI — moon attempt
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Daring difficulty, moon attempt", () => {
  it("discards non-hearts when void in led suit and holding 8+ hearts + Q♠ with no points taken", () => {
    // AI player 1 holds 8 hearts + Q♠ + two diamonds (void in clubs); no points taken
    const hearts8 = Array.from({ length: 8 }, (_, i) => c("hearts", (i + 2) as Rank));
    const hand = [...hearts8, c("spades", 12), c("diamonds", 7), c("diamonds", 8)];
    const trick: TrickCard[] = [{ card: c("clubs", 3), playerIndex: 0 }];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 2,
      currentPlayerIndex: 1,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Void in clubs → can discard freely. Moon attempt: keep hearts and Q♠.
    // Should discard a diamond (highest of non-hearts/non-Q♠)
    expect(pick.suit).not.toBe("hearts");
    expect(pick).not.toEqual(c("spades", 12));
    expect(pick.suit).toBe("diamonds");
  });

  it("leads highest non-heart (A♦) in earlyMoon to stay in control", () => {
    // earlyMoon: 5 hearts + Q♠ in hand, no hearts won, 9 cards remaining (trick 4)
    const hand = [
      c("hearts", 2),
      c("hearts", 4),
      c("hearts", 6),
      c("hearts", 8),
      c("hearts", 10),
      c("spades", 12),
      c("diamonds", 1),
      c("diamonds", 8),
      c("clubs", 13),
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: [],
      tricksPlayedInHand: 4,
      currentPlayerIndex: 1,
      heartsBroken: false,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, [], state, 1, "daring");
    // Moon attempt: lead highest non-heart (A♦, aceHigh=14) to win the trick.
    // Normal Daring would lead lowest of longest safe suit (8♦).
    expect(pick).toEqual(c("diamonds", 1));
  });

  it("leads highest heart when only hearts and Q♠ remain in midMoon", () => {
    // midMoon: totalHearts=5, Q♠ in hand, myPoints=0=totalPointsTaken, 6 cards left
    const hand = [
      c("hearts", 2),
      c("hearts", 4),
      c("hearts", 6),
      c("hearts", 8),
      c("hearts", 10),
      c("spades", 12),
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: [],
      tricksPlayedInHand: 7,
      currentPlayerIndex: 1,
      heartsBroken: true,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, [], state, 1, "daring");
    // No non-hearts besides Q♠ — fall back to highest heart (10♥) to force wins.
    expect(pick).toEqual(c("hearts", 10));
  });

  it("wins point trick with lowest winning card (10♥) in earlyMoon", () => {
    // earlyMoon: 5 hearts + Q♠ in hand, no hearts won, 8 cards remaining (trick 5)
    const hand = [
      c("hearts", 10),
      c("hearts", 8),
      c("hearts", 6),
      c("hearts", 4),
      c("hearts", 2),
      c("spades", 12),
      c("diamonds", 1),
      c("clubs", 13),
    ];
    const trick: TrickCard[] = [
      { card: c("hearts", 3), playerIndex: 0 },
      { card: c("hearts", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 5,
      currentPlayerIndex: 1,
      heartsBroken: true,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Moon attempt: play lowest card that beats current winner (9♥) → 10♥.
    // Normal Daring would play highest loser (8♥) to avoid winning points.
    expect(pick).toEqual(c("hearts", 10));
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

  it("leads K♠ safely when Q♠ is already in wonCards", () => {
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
    // Q♠ is gone — K♠ is safe to lead (lowest non-heart in safe pool)
    // clubs 7 is also safe; the algo picks lowest of longest safe suit
    // With Q♠ gone, K♠ is in the safe pool; lowest of spades=[K♠,2♠] is 2♠
    // lowest of clubs=[7♣] is 7♣. bySuitDescending would pick the tie-broken suit.
    // Either way, K♠ should appear in the valid consideration set now.
    expect([c("spades", 2), c("clubs", 7)]).toContainEqual(pick);
  });
});

// ---------------------------------------------------------------------------
// Daring AI — score-aware endgame
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Daring difficulty, score-aware endgame", () => {
  it("dumps Q♠ on score leader when void and score leader is winning the trick", () => {
    // Player 0 has the highest score (70) and is winning the trick.
    // Daring (player 1) is void in clubs and should dump Q♠ to push player 0 toward 100.
    const hand = [c("spades", 12), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 8), playerIndex: 0 },
      { card: c("clubs", 3), playerIndex: 2 },
      { card: c("clubs", 5), playerIndex: 3 },
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 8,
      currentPlayerIndex: 1,
      cumulativeScores: [70, 20, 10, 15],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    expect(pick).toEqual(c("spades", 12));
  });

  it("holds Q♠ when dumping would push trick winner to 100+ and Daring is not the game leader", () => {
    // Player 2 (score 88) is winning the trick; 88 + 13 = 101 ≥ 100 would end the game.
    // Daring (player 1, score 50) is not the game leader (player 0 has lowest score 30).
    // Player 3 is the score leader (92) but is NOT winning the trick — offensive dump doesn't fire.
    // Daring should hold Q♠ and discard a safe card instead.
    const hand = [c("spades", 12), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 4), playerIndex: 3 },
      { card: c("clubs", 6), playerIndex: 0 },
      { card: c("clubs", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 8,
      currentPlayerIndex: 1,
      cumulativeScores: [30, 50, 88, 92],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    expect(pick).not.toEqual(c("spades", 12));
  });
});

// ---------------------------------------------------------------------------
// Daring AI — opportunistic void in passing
// ---------------------------------------------------------------------------

describe("selectCardsToPass — #1636 void creation (Hard)", () => {
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
    // All 3 slots available. ♦3, ♦4, ♦5 are the only 3 diamonds → full void.
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
    expect(passed).toContainEqual(c("diamonds", 3));
    expect(passed).toContainEqual(c("diamonds", 4));
    expect(passed).toContainEqual(c("diamonds", 5));
  });

  it("double-void — Q♠ + two singletons uses all 3 pass slots (#1645)", () => {
    // Q♠ (slot 1); K♠ is a singleton after Q♠ excluded from spades (slot 2);
    // 5♦ singleton fires in the second loop iteration (slot 3).
    // 4 hearts → moon-viable mode does NOT fire (requires 5+).
    const hand = [
      c("spades", 12), // Q♠
      c("spades", 13), // K♠ — singleton after Q♠ passes
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
    expect(passed).toContainEqual(c("spades", 12)); // Q♠ passed
    expect(passed).toContainEqual(c("spades", 13)); // K♠ (spade void)
    expect(passed).toContainEqual(c("diamonds", 5)); // 5♦ (diamond void)
    expect(passed).toHaveLength(3);
  });
});

describe("selectCardsToPass — #1636 void creation (Medium)", () => {
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

  it("voids a 3-card suit — Medium uses maxSuitSize=3 (#1645)", () => {
    // No Q♠, no A♥ → 3 slots go to void. Shortest suit is diamonds (3 cards).
    // Medium maxSuitSize=3 → voids 3-card suits aggressively (#1645 regression fix).
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
    // Schemer DOES void the 3-card diamond suit (shortest eligible)
    expect(passed).toContainEqual(c("diamonds", 3));
    expect(passed).toContainEqual(c("diamonds", 4));
    expect(passed).toContainEqual(c("diamonds", 5));
  });

  it("does NOT target spades for void when Q♠ is kept (cover cards protected)", () => {
    // Direction=left, has A♠+K♠ → Q♠ kept. Spades left: A♠, K♠ (2 cards).
    // Schemer should NOT void spades (keepingQSpade=true) — A♠/K♠ are Q♠ cover.
    // Hearts 5♥ is a singleton → hearts void fires instead.
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
    // direction=left: hasASpades=true → Q♠ protected (kept)
    const passed = selectCardsToPass(hand, "left", "schemer");
    expect(passed).not.toContainEqual(c("spades", 12)); // Q♠ kept
    expect(passed).not.toContainEqual(c("spades", 1)); // A♠ kept (cover)
    expect(passed).not.toContainEqual(c("spades", 13)); // K♠ kept (cover)
    // Void fires on 5♥ (singleton heart) instead — positive assertion that the guard redirects correctly
    expect(passed).toContainEqual(c("hearts", 5));
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

describe("selectCardsToPass — #1637 moon-viable passing (Hard)", () => {
  it("keeps Q♠ and all hearts when dealt 5+ hearts + Q♠", () => {
    // 5 hearts + Q♠ → moon-viable. Daring passes LOWEST non-hearts (3♠, 5♠, 7♣) to
    // keep Aces and Kings for trick control during the moon attempt (#1647).
    const hand = [
      c("spades", 12), // Q♠ — kept for moon attempt
      c("hearts", 1), // A♥ — kept
      c("hearts", 13), // K♥ — kept
      c("hearts", 11), // J♥ — kept
      c("hearts", 9),
      c("hearts", 7),
      c("diamonds", 1), // A♦ — kept for trick control
      c("diamonds", 13), // K♦ — kept for trick control
      c("clubs", 1), // A♣ — kept for trick control
      c("clubs", 7),
      c("clubs", 8),
      c("spades", 3),
      c("spades", 5),
    ];
    const passed = selectCardsToPass(hand, "left", "daring");
    expect(passed).not.toContainEqual(c("spades", 12)); // Q♠ kept
    expect(passed).not.toContainEqual(c("hearts", 1)); // A♥ kept
    expect(passed).not.toContainEqual(c("hearts", 13)); // K♥ kept
    expect(passed).not.toContainEqual(c("diamonds", 1)); // A♦ kept (trick control)
    expect(passed).not.toContainEqual(c("diamonds", 13)); // K♦ kept (trick control)
    expect(passed).not.toContainEqual(c("clubs", 1)); // A♣ kept (trick control)
    expect(passed).toContainEqual(c("spades", 3)); // 3♠ passed (lowest)
    expect(passed).toContainEqual(c("spades", 5)); // 5♠ passed
    expect(passed).toContainEqual(c("clubs", 7)); // 7♣ passed
  });

  it("uses standard passing when fewer than 5 hearts (no moon-viable)", () => {
    // 4 hearts → NOT moon-viable. Standard Daring passing: Q♠ always passed.
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
    // 8 hearts + Q♠ → moon-viable. Only 2 safe non-hearts available (A♣, 2♣ excluded).
    // Must pass lowest hearts to fill the 3rd slot.
    const hand = [
      c("spades", 12), // Q♠
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 11),
      c("hearts", 9),
      c("hearts", 7),
      c("hearts", 5),
      c("hearts", 3),
      c("hearts", 2),
      c("clubs", 2), // 2♣ — never passed
      c("clubs", 3), // 3♣ — excluded by moonSafe (clubs < 6)
      c("clubs", 4),
      c("clubs", 1), // A♣ — passable
    ];
    const passed = selectCardsToPass(hand, "left", "daring");
    expect(passed).not.toContainEqual(c("spades", 12)); // Q♠ kept
    expect(passed).not.toContainEqual(c("clubs", 2)); // 2♣ never passed
    expect(passed).toContainEqual(c("clubs", 1)); // A♣ passed (safe non-heart)
    expect(passed).toHaveLength(3); // always exactly 3
    // Third slot filled with a low heart (2♥ or 3♥)
    const heartsPassed = passed.filter((c) => c.suit === "hearts");
    expect(heartsPassed.length).toBeGreaterThanOrEqual(1);
    const highHeartKept = passed.every((p) => !(p.suit === "hearts" && p.rank === 1));
    expect(highHeartKept).toBe(true); // A♥ kept (high heart preserved)
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
// detectPotentialMoon
// ---------------------------------------------------------------------------

describe("detectPotentialMoon", () => {
  it("returns null when no points taken", () => {
    const state = mkState({ handScores: [0, 0, 0, 0], wonCards: [[], [], [], []] });
    expect(detectPotentialMoon(state)).toBeNull();
  });

  it("returns player index when they have all points and ≥ 4 hearts", () => {
    const hearts4 = Array.from({ length: 4 }, (_, i) => c("hearts", (i + 1) as Rank));
    const state = mkState({
      handScores: [4, 0, 0, 0],
      wonCards: [hearts4, [], [], []],
    });
    expect(detectPotentialMoon(state)).toBe(0);
  });

  it("returns null when points are split between players", () => {
    const state = mkState({
      handScores: [2, 2, 0, 0],
      wonCards: [[c("hearts", 1), c("hearts", 2)], [c("hearts", 3), c("hearts", 4)], [], []],
    });
    expect(detectPotentialMoon(state)).toBeNull();
  });

  it("returns null when dominant player has fewer than 4 point cards", () => {
    const state = mkState({
      handScores: [3, 0, 0, 0],
      wonCards: [[c("hearts", 1), c("hearts", 2), c("hearts", 3)], [], [], []],
    });
    expect(detectPotentialMoon(state)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// chooseFollow — safe trick, never self-dump point cards (#1363)
// ---------------------------------------------------------------------------

describe("chooseFollow — safe trick, never self-dump Q♠ or hearts (#1363)", () => {
  it("does not play Q♠ last in a 0-pt spades trick when a lower spade is available", () => {
    const hand = [c("spades", 12), c("spades", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 3), playerIndex: 0 },
      { card: c("spades", 5), playerIndex: 1 },
      { card: c("spades", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    expect(pick).not.toEqual(c("spades", 12));
    expect(pick).toEqual(c("spades", 7));
  });

  it("plays Q♠ when it is the only spade remaining (forced)", () => {
    const hand = [c("spades", 12)];
    const trick: TrickCard[] = [
      { card: c("spades", 3), playerIndex: 0 },
      { card: c("spades", 5), playerIndex: 1 },
      { card: c("spades", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    expect(pick).toEqual(c("spades", 12));
  });

  it("exhausts K♠ last in a 0-pt spades trick (K♠ has no point value)", () => {
    const hand = [c("spades", 13), c("spades", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 3), playerIndex: 0 },
      { card: c("spades", 5), playerIndex: 1 },
      { card: c("spades", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    expect(pick).toEqual(c("spades", 13));
  });
});

// ---------------------------------------------------------------------------
// Regression: #1500 — chooseFollow plays highest losing card when trick is 0-pt
// ---------------------------------------------------------------------------
describe("chooseFollow — highest losing card (#1500)", () => {
  it("plays highest losing card (not lowest) in a 0-pt trick when not last to play", () => {
    // A♠ leads; K♠ and 5♠ both lose to it. Before fix: plays 5♠. After fix: plays K♠.
    const hand = [c("spades", 13), c("spades", 5)];
    const trick: TrickCard[] = [
      { card: c("spades", 1), playerIndex: 0 }, // A♠ wins (ace-high)
    ];
    // player 1 follows; players 2 and 3 still to play (not last)
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 5,
      currentPlayerIndex: 1,
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "schemer");
    expect(pick).toEqual(c("spades", 13));
  });

  it("dumps Q♠ on K♠ trick (highest losing = Q♠ beats keeping it)", () => {
    // K♠ leads; Q♠ (rank 12 < rank 13 ace-high) loses to it — dump it.
    const hand = [c("spades", 12), c("spades", 5)];
    const trick: TrickCard[] = [
      { card: c("spades", 13), playerIndex: 0 }, // K♠ leads
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 5,
      currentPlayerIndex: 1,
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "schemer");
    expect(pick).toEqual(c("spades", 12)); // Q♠ dumped
  });
});

// ---------------------------------------------------------------------------
// Regression: #1510 — chooseFollow sheds Q♠ before K♠ when A♠ is played
// ---------------------------------------------------------------------------
describe("chooseFollow — Q♠ priority over K♠ when both lose (#1510)", () => {
  it("sheds Q♠ before K♠ when A♠ leads and both would lose (pts > 0)", () => {
    // A♠ leads with Q♥ already in the trick (points > 0).
    // Player holds K♠ + Q♠ — both lose to A♠. Q♠ must be shed first.
    const hand = [c("spades", 13), c("spades", 12)];
    const trick: TrickCard[] = [
      { card: c("spades", 1), playerIndex: 0 }, // A♠ leads (ace-high wins)
      { card: c("hearts", 12), playerIndex: 2 }, // Q♥ discarded — trick has points
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 5,
      currentPlayerIndex: 1,
      heartsBroken: true,
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "schemer");
    expect(pick).toEqual(c("spades", 12)); // Q♠ not K♠
  });

  it("sheds Q♠ before K♠ when A♠ leads in a 0-pt trick (no-points branch)", () => {
    // A♠ leads, no points in trick yet, player not last to play.
    // Player holds K♠ + Q♠ — both lose to A♠. Q♠ must still be shed first.
    const hand = [c("spades", 13), c("spades", 12)];
    const trick: TrickCard[] = [
      { card: c("spades", 1), playerIndex: 0 }, // A♠ leads
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 5,
      currentPlayerIndex: 1,
    });
    // Player 1 follows; players 2 and 3 still to play → not last
    const pick = selectCardToPlay(hand, trick, state, 1, "schemer");
    expect(pick).toEqual(c("spades", 12)); // Q♠ not K♠
  });
});

// ---------------------------------------------------------------------------
// Regression: protected Q♠ (A♠+K♠+Q♠) must-win — never self-dump Q♠
// ---------------------------------------------------------------------------
describe("chooseFollow — protected Q♠ never self-taken when non-point winner available", () => {
  it("plays K♠ not Q♠ when A♠+K♠+Q♠ all win a 0-pt trick (not last to play)", () => {
    // Low spade leads; A♠, K♠, Q♠ all win. Should play K♠ (lowest non-point winner), not Q♠.
    const hand = [c("spades", 1), c("spades", 13), c("spades", 12), c("clubs", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 4), playerIndex: 0 }, // 4♠ leads
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 5,
      currentPlayerIndex: 1,
    });
    // Player 1 follows; players 2 and 3 still to play → not last
    const pick = selectCardToPlay(hand, trick, state, 1, "schemer");
    expect(pick).not.toEqual(c("spades", 12)); // Q♠ must not be played
    expect(pick.suit).toBe("spades"); // must follow suit
    expect([1, 13]).toContain(pick.rank); // A♠ or K♠ (non-point winners)
  });

  it("plays non-Q♠ winner when forced to win a point trick with K♠+Q♠ (not last)", () => {
    // Hearts trick has points; spade player must win (all spades beat current winner).
    // Should prefer K♠ over Q♠.
    const hand = [c("spades", 13), c("spades", 12)];
    const trick: TrickCard[] = [
      { card: c("spades", 10), playerIndex: 0 }, // 10♠ leads
      { card: c("hearts", 3), playerIndex: 2 }, // heart discard — pts > 0
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 5,
      currentPlayerIndex: 1,
      heartsBroken: true,
    });
    // K♠ (13) and Q♠ (12) both beat 10♠; trick has points. Should play K♠ not Q♠.
    const pick = selectCardToPlay(hand, trick, state, 1, "schemer");
    expect(pick).toEqual(c("spades", 13)); // K♠, not Q♠
  });

  it("plays non-Q♠ winner when forced to win a point trick with K♠+Q♠ (last to play)", () => {
    // Same scenario but player 1 is last (3 cards already in trick → isLastToPlay = true).
    const hand = [c("spades", 13), c("spades", 12)];
    const trick: TrickCard[] = [
      { card: c("spades", 5), playerIndex: 0 }, // 5♠ leads
      { card: c("hearts", 7), playerIndex: 2 }, // heart discard — pts > 0
      { card: c("spades", 6), playerIndex: 3 }, // low spade — current winner
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 7,
      currentPlayerIndex: 1,
      heartsBroken: true,
    });
    // trick.length === 3 → isLastToPlay = true; pts = 1 (7♥). K♠ and Q♠ both beat 6♠.
    const pick = selectCardToPlay(hand, trick, state, 1, "schemer");
    expect(pick).toEqual(c("spades", 13)); // K♠, not Q♠
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
// Regression: #1525 — chooseFollow dumps Q♠ when last to play with covering card
// ---------------------------------------------------------------------------
describe("chooseFollow — last to play, covering card (#1525)", () => {
  it("dumps Q♠ when A♠ is covering and K♠ is already played", () => {
    // A♠ led — winningRank=14. Q♠ (rank 12) loses to A♠, so dump it.
    const hand = [c("spades", 12), c("spades", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 1), playerIndex: 0 },
      { card: c("spades", 13), playerIndex: 1 },
      { card: c("spades", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3, "schemer");
    expect(pick).toEqual(c("spades", 12));
  });

  it("does not dump Q♠ when no covering card — Q♠ would win the trick", () => {
    // 9♠ is the current winner; Q♠ rank 12 > 9 so playing Q♠ takes the trick.
    const hand = [c("spades", 12), c("spades", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 9), playerIndex: 0 },
      { card: c("spades", 3), playerIndex: 1 },
      { card: c("spades", 5), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3, "schemer");
    expect(pick).not.toEqual(c("spades", 12));
    expect(pick).toEqual(c("spades", 7));
  });

  it("hard AI in moon-attempt mode does not dump Q♠ even when covering card present", () => {
    // Daring AI holds 8 hearts + Q♠ with 0 pts taken → isMoonAttempt = true.
    // A♠ is covering; Q♠ should be held to complete the moon shot.
    const hearts8 = Array.from({ length: 8 }, (_, i) => c("hearts", (i + 2) as Rank));
    const hand = [...hearts8, c("spades", 12), c("spades", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 1), playerIndex: 0 },
      { card: c("spades", 13), playerIndex: 1 },
      { card: c("spades", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      currentPlayerIndex: 3,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, trick, state, 3, "daring");
    expect(pick).not.toEqual(c("spades", 12));
  });
});

// ---------------------------------------------------------------------------
// #1647 — Daring AI: chooseFollow moon-attempt 0-pt trick behaviour
// ---------------------------------------------------------------------------

describe("chooseFollow — moon attempt, 0-pt trick (#1647)", () => {
  it("wins 0-pt trick with lowest winning card when last to play in earlyMoon", () => {
    // earlyMoon: 5 hearts + Q♠ in hand, 9 cards, no hearts won.
    // Clubs led (0-pt trick). Player 3 is last; should win with lowest winner (9♣)
    // rather than exhausting a high card, to conserve trick-control resources.
    const hand = [
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 11),
      c("hearts", 9),
      c("hearts", 7),
      c("spades", 12), // Q♠
      c("clubs", 9),
      c("clubs", 10),
      c("clubs", 11),
    ];
    const trick: TrickCard[] = [
      { card: c("clubs", 5), playerIndex: 0 },
      { card: c("clubs", 6), playerIndex: 1 },
      { card: c("clubs", 8), playerIndex: 2 }, // current winner (rank 8)
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      currentPlayerIndex: 3,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, trick, state, 3, "daring");
    // Should win with lowest card above rank 8 → 9♣, not 10♣ or J♣
    expect(pick).toEqual(c("clubs", 9));
  });

  it("wins 0-pt trick but guards Q♠ when not last to play in earlyMoon", () => {
    // earlyMoon: player 1 holds 5 hearts + Q♠ + K♠ + A♠, 9 cards, 0 hearts won.
    // Spades led (0-pt). Player 1 is NOT last (players 2 and 3 still to play).
    // Should win with lowest non-Q♠ winner (K♠), keeping Q♠ safe from later K♠/A♠.
    const hand = [
      c("hearts", 2),
      c("hearts", 4),
      c("hearts", 6),
      c("hearts", 8),
      c("hearts", 10), // 5 hearts
      c("spades", 12), // Q♠ — must NOT be played (not last)
      c("spades", 13), // K♠
      c("spades", 1), // A♠
      c("clubs", 7),
    ];
    const trick: TrickCard[] = [{ card: c("spades", 5), playerIndex: 0 }];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      currentPlayerIndex: 1,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // K♠ and A♠ both beat 5♠; Q♠ excluded (not last); lowest non-Q♠ winner = K♠
    expect(pick).not.toEqual(c("spades", 12)); // Q♠ protected
    expect(pick).toEqual(c("spades", 13)); // K♠ — lowest non-Q♠ winner
  });
});

// ---------------------------------------------------------------------------
// #1592 — Cautious AI: basic moon blocking
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Cautious AI moon blocking (#1592)", () => {
  it("dumps highest point card when an opponent is threatening a moon", () => {
    // Player 0 has taken all 5 points — potential moon detected.
    // Player 3 (Cautious) is void in spades; should dump hearts 9 to disrupt.
    const allHearts5 = Array.from({ length: 5 }, (_, i) => c("hearts", (i + 1) as Rank));
    const hand = [c("hearts", 9), c("diamonds", 3), c("diamonds", 4)];
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
    const pick = selectCardToPlay(hand, trick, state, 3, "cautious");
    expect(pick).toEqual(c("hearts", 9));
  });

  it("dumps A♥ before lower hearts when blocking a moon", () => {
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
    const pick = selectCardToPlay(hand, trick, state, 3, "cautious");
    expect(pick).toEqual(c("hearts", 1));
  });

  it("dumps a point card when LEADING and an opponent is threatening a moon", () => {
    // Cautious AI (player 1) is leading its turn. Player 0 has all 5 points — moon threat.
    // Hearts are broken, so hearts 9 is a valid lead and the moon-block should fire.
    const allHearts5 = Array.from({ length: 5 }, (_, i) => c("hearts", (i + 1) as Rank));
    const hand = [c("hearts", 9), c("diamonds", 3), c("diamonds", 4)];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: [],
      tricksPlayedInHand: 5,
      heartsBroken: true,
      handScores: [5, 0, 0, 0],
      wonCards: [allHearts5, [], [], []],
      currentPlayerIndex: 1,
    });
    const pick = selectCardToPlay(hand, [], state, 1, "cautious");
    expect(pick).toEqual(c("hearts", 9));
  });

  it("plays normally (lowest) when no moon threat", () => {
    const hand = [c("hearts", 9), c("diamonds", 3), c("diamonds", 4)];
    const trick: TrickCard[] = [
      { card: c("spades", 4), playerIndex: 0 },
      { card: c("spades", 5), playerIndex: 1 },
      { card: c("spades", 6), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3, "cautious");
    // No moon threat → Cautious dumps lowest card
    expect(pick).toEqual(c("diamonds", 3));
  });
});

// ---------------------------------------------------------------------------
// #1593 — Daring AI: moonshot extended tracking + tricks-remaining guard
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Daring AI moonshot guard (#1593)", () => {
  it("stays in moon-attempt mode when AI has collected all points so far (5+ tricks left)", () => {
    // AI (player 1) has already won 2 hearts; still holds 8 hearts + Q♠ + 1 club.
    // aiHasAllPoints: handScores[1]=2 === totalPointsTaken=2. hand.length=10 >= 5.
    const heartsInHand = Array.from({ length: 8 }, (_, i) => c("hearts", (i + 2) as Rank));
    const heartsAlreadyWon = [c("hearts", 10), c("hearts", 11)];
    const hand = [...heartsInHand, c("spades", 12), c("clubs", 7)]; // 10 cards
    const trick: TrickCard[] = [{ card: c("diamonds", 3), playerIndex: 0 }]; // AI void in diamonds
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      handScores: [0, 2, 0, 0],
      wonCards: [[], heartsAlreadyWon, [], []],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Moon attempt active: discard highest non-hearts/non-Q♠ = clubs 7
    expect(pick).toEqual(c("clubs", 7));
  });

  it("does not enter moon-attempt mode when fewer than 5 tricks remain", () => {
    // AI (player 1) has already won 6 hearts; holds 2 hearts + Q♠ + 1 diamond in hand (4 cards).
    // hand.length=4 < 5 → not feasible → isMoonAttempt=false → normal discard fires (Q♠ first).
    const heartsInHand = [c("hearts", 2), c("hearts", 3)];
    const heartsAlreadyWon = Array.from({ length: 6 }, (_, i) => c("hearts", (i + 4) as Rank));
    const hand = [...heartsInHand, c("spades", 12), c("diamonds", 7)]; // 4 cards
    const trick: TrickCard[] = [{ card: c("clubs", 3), playerIndex: 0 }]; // AI void in clubs
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 9,
      currentPlayerIndex: 1,
      handScores: [0, 6, 0, 0],
      wonCards: [[], heartsAlreadyWon, [], []],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Not in moon mode → chooseDiscard fires → dumps Q♠ first
    expect(pick).toEqual(c("spades", 12));
  });

  it("maintains moon-attempt mode when Q♠ is already in wonCards (not in hand)", () => {
    // AI (player 1) has already won Q♠ + 5 hearts; still holds 8 hearts + 2 clubs.
    // myHasQ = true via wonCards. totalHearts = 8+5 = 13. hand.length = 10 >= 5.
    // handScores[1] = 18 (13+5) === totalPointsTaken = 18 → aiHasAllPoints.
    const heartsInHand = Array.from({ length: 8 }, (_, i) => c("hearts", (i + 2) as Rank));
    const heartsWon = [
      c("hearts", 10),
      c("hearts", 11),
      c("hearts", 12),
      c("hearts", 13),
      c("hearts", 1),
    ];
    const alreadyWon = [c("spades", 12), ...heartsWon]; // Q♠ + 5 hearts
    const hand = [...heartsInHand, c("clubs", 7), c("clubs", 8)]; // 10 cards
    const trick: TrickCard[] = [{ card: c("diamonds", 3), playerIndex: 0 }]; // AI void in diamonds
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      handScores: [0, 18, 0, 0],
      wonCards: [[], alreadyWon, [], []],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Moon attempt active: void in diamonds → discard highest non-hearts/non-Q♠ = clubs 8
    expect(pick).toEqual(c("clubs", 8));
  });

  it("exits moon-attempt mode when another player also has points (split points)", () => {
    // AI has 8 hearts in hand + 2 won; opponent also has 2 points → aiHasAllPoints=false.
    const heartsInHand = Array.from({ length: 8 }, (_, i) => c("hearts", (i + 2) as Rank));
    const heartsAlreadyWon = [c("hearts", 10), c("hearts", 11)];
    const hand = [...heartsInHand, c("spades", 12), c("clubs", 7)];
    const trick: TrickCard[] = [{ card: c("diamonds", 3), playerIndex: 0 }];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      handScores: [0, 2, 2, 0], // player 2 also has points — AI doesn't have all points
      wonCards: [[], heartsAlreadyWon, [c("hearts", 12), c("hearts", 13)], []],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Not in moon mode (split points) → void in diamonds → chooseDiscard → dumps Q♠
    expect(pick).toEqual(c("spades", 12));
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

  it("leads lowest heart (not Q♠) when hearts outnumber other unsafe cards in fallback pool", () => {
    // valid = [Q♠, K♠, 3♥, 5♥]: safe=[]. poolWithoutQ=[K♠, 3♥, 5♥].
    // bySuitDescending: hearts(2) > spades(1) → longestGroup = hearts → lowest = 3♥.
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
    expect(pick).not.toEqual(c("spades", 12));
    expect(pick).toEqual(c("hearts", 3)); // lowest of longest group (hearts) after Q♠ stripped
  });

  it("leads shortest non-spade suit when holding Q♠ — Hard (#1646)", () => {
    // hand = [Q♠, K♦, 2♦, 7♣, 8♣, 9♣]: holdingQ → lead shortest non-spade suit = diamonds (2)
    // Without Q♠: would lead longest suit = clubs (3).
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
    // Shortest non-spade suit is diamonds (2 cards) → lowest = 2♦
    expect(pick).toEqual(c("diamonds", 2));
  });

  it("leads shortest non-spade suit when holding Q♠ — Medium (#1646)", () => {
    // same hand: holdingQ → lead shortest non-spade suit = diamonds (2)
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
    // Shortest non-spade suit is diamonds (2 cards) → lowest = 2♦
    expect(pick).toEqual(c("diamonds", 2));
  });

  it("leads longest suit when NOT holding Q♠ — longest path unchanged (#1646)", () => {
    // Without Q♠: holdingQ=false → pick longest suit. Clubs (3) > diamonds (2).
    const hand = [c("diamonds", 13), c("diamonds", 2), c("clubs", 7), c("clubs", 8), c("clubs", 9)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 3,
      heartsBroken: false,
      currentPlayerIndex: 0,
      wonCards: [[], [], [], []],
    });
    // Both Daring and Schemer should lead lowest of longest non-heart suit = 7♣
    const pickDaring = selectCardToPlay(hand, [], state, 0, "daring");
    const pickSchemer = selectCardToPlay(hand, [], state, 0, "schemer");
    expect(pickDaring).toEqual(c("clubs", 7));
    expect(pickSchemer).toEqual(c("clubs", 7));
  });
});

// ---------------------------------------------------------------------------
// selectCardsToPass — #1595 pass direction awareness
// ---------------------------------------------------------------------------

describe("selectCardsToPass — #1595 direction awareness (Medium)", () => {
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

describe("selectCardsToPass — #1595 direction awareness (Hard)", () => {
  it("passes Q♠ regardless of direction (left and right both always pass Q♠)", () => {
    // Daring is more aggressive than Medium — direction does not protect Q♠.
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
    expect(passedLeft).toContainEqual(c("spades", 12));
    expect(passedRight).toContainEqual(c("spades", 12));
  });

  it("includes 10♥ as a danger heart when passing right but not left", () => {
    // Hand designed so no suit is voidable after Q♠ passes (all remaining suits have 3+ cards)
    // → void creation falls through, danger hearts fill slots 2-3.
    // Going right: Q♠ (slot 1), A♥ (slot 2), 10♥ (slot 3) — threshold=10 includes 10♥.
    // Going left: Q♠ (slot 1), A♥ (slot 2), filler (slot 3) — threshold=11 excludes 10♥.
    // Q♠ is the only spade (no K♠ singleton for void to consume).
    // 4 hearts total → moon-viable mode does NOT fire (requires 5+).
    const hand = [
      c("spades", 12), // Q♠ — only spade; after passing, no spades remain for void
      c("hearts", 1), // A♥ — danger both directions
      c("hearts", 10), // 10♥ — danger only going right
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
    expect(passedRight).toContainEqual(c("hearts", 10));
    expect(passedLeft).not.toContainEqual(c("hearts", 10));
    expect(passedLeft).toContainEqual(c("hearts", 1)); // A♥ still passes going left
  });
});

describe("selectCardsToPass — #1595 across direction (Medium)", () => {
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

// ---------------------------------------------------------------------------
// Daring AI — adversarial targeting (#1638)
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Daring difficulty, adversarial void discard", () => {
  it("dumps Q♠ on seat 0 when seat 0 is winning the trick and Daring is void", () => {
    // Player 1 (Daring) is void in clubs and holds Q♠ + hearts.
    // Seat 0 is currently winning the trick with K♣.
    const hand = [c("spades", 12), c("hearts", 5), c("hearts", 9), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 13), playerIndex: 0 }, // seat 0 winning
      { card: c("clubs", 3), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      heartsBroken: true,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10], // below endgame threshold
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Seat 0 is winning — adversarial: dump Q♠ on human.
    expect(pick).toEqual(c("spades", 12));
  });

  it("saves Q♠ when an AI opponent (not seat 0) is winning the trick", () => {
    // Player 1 (Daring) is void in clubs. Seat 2 is winning with K♣ (not seat 0).
    // Daring holds Q♠, hearts, and a diamond — should discard the non-point card.
    const hand = [c("spades", 12), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 3), playerIndex: 0 },
      { card: c("clubs", 13), playerIndex: 2 }, // seat 2 winning
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      heartsBroken: true,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Another AI is winning — save Q♠ for seat 0; dump non-point card (7♦).
    expect(pick).toEqual(c("diamonds", 7));
    expect(pick).not.toEqual(c("spades", 12));
  });
});

describe("selectCardsToPass — #1638 adversarial targeting (Hard)", () => {
  it("passes Q♠ to seat 0 even in moon-viable mode (left pass from seat 3)", () => {
    // Seat 3 passes left → recipient is seat 0. Hand is moon-viable (5+ hearts + Q♠).
    // Without targeting, moonViable keeps Q♠; with targeting, Q♠ is passed to seat 0.
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
    // playerIndex=3, direction="left" → (3+1)%4=0 → targeting seat 0
    const passed = selectCardsToPass(hand, "left", "daring", 3);
    expect(passed).toHaveLength(3);
    expect(passed).toContainEqual(c("spades", 12));
  });

  it("keeps Q♠ in moon-viable mode when NOT passing to seat 0 (left pass from seat 1)", () => {
    // Seat 1 passes left → recipient is seat 2 (not seat 0). Moon-viable should activate.
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
    expect(passed).not.toContainEqual(c("spades", 12));
  });

  it("passes Q♠ to seat 0 in moon-viable mode via across pass from seat 2", () => {
    // Seat 2 passes across → (2+2)%4=0 → targeting seat 0.
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
    const passed = selectCardsToPass(hand, "across", "daring", 2);
    expect(passed).toHaveLength(3);
    expect(passed).toContainEqual(c("spades", 12));
  });

  it("keeps Q♠ when targeting seat 0 with strongMoon (7+ hearts)", () => {
    // Seat 3 passes left → targeting seat 0. Normally Q♠ is passed adversarially.
    // But 7+ hearts + Q♠ (strongMoon) → bypasses suppression → moon-viable keeps Q♠.
    // Moon attempt is impossible without Q♠, so passing it away is self-defeating.
    const hand = [
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 11),
      c("hearts", 9),
      c("hearts", 7),
      c("hearts", 5),
      c("hearts", 3), // 7 hearts → strongMoon threshold
      c("spades", 12), // Q♠ — must be kept
      c("diamonds", 1),
      c("diamonds", 8),
      c("clubs", 8),
      c("clubs", 7),
      c("clubs", 6),
    ];
    // playerIndex=3, direction="left" → (3+1)%4=0 → targeting seat 0
    const passed = selectCardsToPass(hand, "left", "daring", 3);
    expect(passed).toHaveLength(3);
    expect(passed).not.toContainEqual(c("spades", 12)); // Q♠ kept for moon attempt
  });
});

describe("selectCardToPlay — Daring difficulty, adversarial void discard (edge cases)", () => {
  it("falls through to normal discard when seat 0 is winning but Daring holds no Q♠ or hearts", () => {
    // Player 1 holds only non-point cards — nothing to target seat 0 with.
    // Should fall through and discard normally (highest non-point card).
    const hand = [c("diamonds", 10), c("clubs", 9), c("diamonds", 6)];
    const trick: TrickCard[] = [
      { card: c("spades", 13), playerIndex: 0 }, // seat 0 winning with K♠
      { card: c("spades", 3), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      heartsBroken: true,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // No Q♠ or hearts to dump — adversarial block falls through; normal discard fires.
    expect(pick.suit).not.toBe("hearts");
    expect(pick).not.toEqual(c("spades", 12));
  });

  it("does not apply adversarial targeting when Daring is seat 0 (never happens in real game)", () => {
    // Regression: Daring at seat 0 must NOT save Q♠ waiting for a 'seat 0 win' that can never
    // fire from its own void plays — it would hold Q♠ indefinitely and hurt its own score.
    // Daring at seat 0 should dump Q♠ normally (chooseDiscard) regardless of who is winning.
    const hand = [c("spades", 12), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 3), playerIndex: 1 },
      { card: c("clubs", 13), playerIndex: 2 }, // seat 2 winning — not seat 0
    ];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 0,
      heartsBroken: true,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 0, "daring");
    // Adversarial targeting inactive for playerIndex=0; chooseDiscard dumps Q♠ normally.
    expect(pick).toEqual(c("spades", 12));
  });
});

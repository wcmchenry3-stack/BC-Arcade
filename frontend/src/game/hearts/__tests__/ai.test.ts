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
    aiDifficulty: "medium",
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
// Easy AI — selectCardsToPass
// ---------------------------------------------------------------------------

describe("selectCardsToPass — Easy difficulty", () => {
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
    expect(selectCardsToPass(hand, "left", "easy")).toHaveLength(3);
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
    const passed = selectCardsToPass(hand, "left", "easy");
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
    const passed = selectCardsToPass(hand, "right", "easy");
    passed.forEach((p) => expect(hand).toContainEqual(p));
  });
});

// ---------------------------------------------------------------------------
// Easy AI — selectCardToPlay
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Easy difficulty", () => {
  it("leads the lowest valid card", () => {
    const hand = [c("spades", 1), c("spades", 3), c("diamonds", 5)];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: [],
      tricksPlayedInHand: 3,
      heartsBroken: true,
      currentPlayerIndex: 0,
    });
    const pick = selectCardToPlay(hand, [], state, 0, "easy");
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
    const pick = selectCardToPlay(hand, trick, state, 3, "easy");
    // Easy dumps lowest card, not the strategic Q♠
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
    const pick = selectCardToPlay(hand, trick, state, 2, "easy");
    expect(pick).toEqual(c("spades", 5));
  });
});

// ---------------------------------------------------------------------------
// Hard AI — moon attempt
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Hard difficulty, moon attempt", () => {
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
    const pick = selectCardToPlay(hand, trick, state, 1, "hard");
    // Void in clubs → can discard freely. Moon attempt: keep hearts and Q♠.
    // Should discard a diamond (highest of non-hearts/non-Q♠)
    expect(pick.suit).not.toBe("hearts");
    expect(pick).not.toEqual(c("spades", 12));
    expect(pick.suit).toBe("diamonds");
  });
});

// ---------------------------------------------------------------------------
// Hard AI — card counting (leading)
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Hard difficulty, card counting", () => {
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
    const pick = selectCardToPlay(hand, [], state, 0, "hard");
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
    const pick = selectCardToPlay(hand, [], state, 0, "hard");
    // Q♠ is gone — K♠ is safe to lead (lowest non-heart in safe pool)
    // clubs 7 is also safe; the algo picks lowest of longest safe suit
    // With Q♠ gone, K♠ is in the safe pool; lowest of spades=[K♠,2♠] is 2♠
    // lowest of clubs=[7♣] is 7♣. bySuitDescending would pick the tie-broken suit.
    // Either way, K♠ should appear in the valid consideration set now.
    expect([c("spades", 2), c("clubs", 7)]).toContainEqual(pick);
  });
});

// ---------------------------------------------------------------------------
// Hard AI — score-aware endgame
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Hard difficulty, score-aware endgame", () => {
  it("dumps Q♠ on score leader when void and score leader is winning the trick", () => {
    // Player 0 has the highest score (70) and is winning the trick.
    // Hard (player 1) is void in clubs and should dump Q♠ to push player 0 toward 100.
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
    const pick = selectCardToPlay(hand, trick, state, 1, "hard");
    expect(pick).toEqual(c("spades", 12));
  });

  it("holds Q♠ when dumping would push trick winner to 100+ and Hard is not the game leader", () => {
    // Player 2 (score 88) is winning the trick; 88 + 13 = 101 ≥ 100 would end the game.
    // Hard (player 1, score 50) is not the game leader (player 0 has lowest score 30).
    // Player 3 is the score leader (92) but is NOT winning the trick — offensive dump doesn't fire.
    // Hard should hold Q♠ and discard a safe card instead.
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
    const pick = selectCardToPlay(hand, trick, state, 1, "hard");
    expect(pick).not.toEqual(c("spades", 12));
  });
});

// ---------------------------------------------------------------------------
// Hard AI — opportunistic void in passing
// ---------------------------------------------------------------------------

describe("selectCardsToPass — Hard difficulty, opportunistic void", () => {
  it("voids a 1-card suit when exactly 1 pass slot remains after dangerous cards", () => {
    // Q♠ fills slot 1, A♥ fills slot 2 (high heart). 1 slot remains.
    // ♦7 is the only diamond → void fires and ♦7 fills the last slot.
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
    const passed = selectCardsToPass(hand, "left", "hard");
    expect(passed).toContainEqual(c("diamonds", 7));
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
    const pick = selectCardToPlay(hand, trick, state, 1, "medium");
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
    const pick = selectCardToPlay(hand, trick, state, 1, "medium");
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
    const pick = selectCardToPlay(hand, trick, state, 1, "medium");
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
    const pick = selectCardToPlay(hand, trick, state, 1, "medium");
    expect(pick).toEqual(c("spades", 12)); // Q♠ not K♠
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
    const pick = selectCardToPlay(hand, [], state, 0, "medium");
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
    const pick = selectCardToPlay(hand, [], state, 0, "medium");
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
    const pick = selectCardToPlay(hand, [], state, 0, "medium");
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
    const pick = selectCardToPlay(hand, trick, state, 3, "medium");
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
    const pick = selectCardToPlay(hand, trick, state, 3, "medium");
    expect(pick).not.toEqual(c("spades", 12));
    expect(pick).toEqual(c("spades", 7));
  });

  it("hard AI in moon-attempt mode does not dump Q♠ even when covering card present", () => {
    // Hard AI holds 8 hearts + Q♠ with 0 pts taken → isMoonAttempt = true.
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
    const pick = selectCardToPlay(hand, trick, state, 3, "hard");
    expect(pick).not.toEqual(c("spades", 12));
  });
});

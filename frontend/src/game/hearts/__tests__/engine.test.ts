/**
 * Hearts engine unit tests (#604).
 *
 * Covers all acceptance criteria from the issue:
 *   - Deal: 52 unique cards, 13 per player
 *   - Pass exchange: correct direction (left/right/across), none skips exchange
 *   - getValidPlays: first-trick restriction, suit-following, void freedom, hearts-locked
 *   - Trick winner: highest of led suit wins regardless of discards
 *   - heartsBroken set when heart discarded
 *   - Moon detection: true when all 26 pts taken, false otherwise
 *   - Moon scoring: shooter gets 0, others +26
 *   - isGameOver: triggers at exactly ≥ 100
 *   - getWinner: returns lowest-score player
 */

import {
  applyHandScoring,
  commitPass,
  dealGame,
  dealNextHand,
  detectMoon,
  getPassDirection,
  getValidPlays,
  isGameOver,
  getWinner,
  playCard,
  selectPassCard,
  setRng,
} from "../engine";
import type { Card, HeartsState, Suit, Rank } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function c(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

/** Build a 4-player hands array, defaulting missing slots to []. */
function h4(
  p0: Card[] = [],
  p1: Card[] = [],
  p2: Card[] = [],
  p3: Card[] = []
): readonly (readonly Card[])[] {
  return [p0, p1, p2, p3];
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
    heartsBroken: false,
    tricksPlayedInHand: 0,
    isComplete: false,
    winnerIndex: null,
    ...overrides,
  };
}

afterEach(() => {
  setRng(Math.random);
});

// ---------------------------------------------------------------------------
// dealGame
// ---------------------------------------------------------------------------

describe("dealGame", () => {
  it("deals 52 unique cards across 4 players with 13 each", () => {
    const state = dealGame();
    const allCards = state.playerHands.flatMap((h) => h);
    expect(allCards).toHaveLength(52);
    const ids = new Set(allCards.map((c) => `${c.suit}-${c.rank}`));
    expect(ids.size).toBe(52);
    state.playerHands.forEach((hand) => expect(hand).toHaveLength(13));
  });

  it("starts in passing phase for hand 1 (left direction)", () => {
    const state = dealGame();
    expect(state.phase).toBe("passing");
    expect(state.passDirection).toBe("left");
    expect(state.handNumber).toBe(1);
  });

  it("initialises cumulative scores to zero", () => {
    const state = dealGame();
    expect(state.cumulativeScores).toEqual([0, 0, 0, 0]);
  });

  it("initialises scoreHistory empty", () => {
    const state = dealGame();
    expect(state.scoreHistory).toEqual([]);
  });

  it("uses storage schema v3", () => {
    expect(dealGame()._v).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// getPassDirection
// ---------------------------------------------------------------------------

describe("getPassDirection", () => {
  it("returns left for hand 1", () => expect(getPassDirection(1)).toBe("left"));
  it("returns right for hand 2", () => expect(getPassDirection(2)).toBe("right"));
  it("returns across for hand 3", () => expect(getPassDirection(3)).toBe("across"));
  it("returns none for hand 4", () => expect(getPassDirection(4)).toBe("none"));
  it("cycles correctly for hand 5", () => expect(getPassDirection(5)).toBe("left"));
  it("cycles correctly for hand 8", () => expect(getPassDirection(8)).toBe("none"));
});

// ---------------------------------------------------------------------------
// selectPassCard
// ---------------------------------------------------------------------------

describe("selectPassCard", () => {
  it("adds a card to the selection", () => {
    const hand = [c("spades", 1), c("hearts", 2), c("clubs", 3)];
    const state = mkState({ playerHands: h4(hand), passSelections: [[], [], [], []] });
    const next = selectPassCard(state, 0, c("spades", 1));
    expect(next.passSelections[0]).toHaveLength(1);
  });

  it("removes a card already selected (toggle)", () => {
    const card = c("spades", 1);
    const state = mkState({ passSelections: [[card], [], [], []] });
    const next = selectPassCard(state, 0, card);
    expect(next.passSelections[0]).toHaveLength(0);
  });

  it("does not add a 4th card", () => {
    const sel = [c("spades", 1), c("hearts", 2), c("clubs", 3)];
    const state = mkState({ passSelections: [sel, [], [], []] });
    const next = selectPassCard(state, 0, c("diamonds", 4));
    expect(next.passSelections[0]).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// commitPass
// ---------------------------------------------------------------------------

describe("commitPass — left", () => {
  it("player 0's cards go to player 1, player 1's to 2, etc.", () => {
    const p0Cards = [c("spades", 1), c("spades", 2), c("spades", 3)];
    const p1Cards = [c("hearts", 1), c("hearts", 2), c("hearts", 3)];
    const p2Cards = [c("diamonds", 1), c("diamonds", 2), c("diamonds", 3)];
    const p3Cards = [c("clubs", 4), c("clubs", 5), c("clubs", 6)];

    // Give each player a club 2 so find2ClubsHolder can locate it, and extra cards
    const hands = [
      [...p0Cards, c("clubs", 2), c("clubs", 7), c("clubs", 8), c("clubs", 9), c("clubs", 10)],
      [
        ...p1Cards,
        c("clubs", 11),
        c("clubs", 12),
        c("clubs", 13),
        c("diamonds", 4),
        c("diamonds", 5),
      ],
      [...p2Cards, c("hearts", 4), c("hearts", 5), c("hearts", 6), c("hearts", 7), c("hearts", 8)],
      [...p3Cards, c("spades", 4), c("spades", 5), c("spades", 6), c("spades", 7), c("spades", 8)],
    ] as Card[][];

    const state = mkState({
      phase: "passing",
      passDirection: "left",
      playerHands: hands,
      passSelections: [p0Cards, p1Cards, p2Cards, p3Cards],
    });

    const next = commitPass(state);
    expect(next.phase).toBe("playing");
    // p0's cards went to p1
    p0Cards.forEach((card) => expect(next.playerHands[1]).toContainEqual(card));
    // p1's cards went to p2
    p1Cards.forEach((card) => expect(next.playerHands[2]).toContainEqual(card));
    // p2's cards went to p3
    p2Cards.forEach((card) => expect(next.playerHands[3]).toContainEqual(card));
    // p3's cards went to p0
    p3Cards.forEach((card) => expect(next.playerHands[0]).toContainEqual(card));
  });
});

describe("commitPass — right", () => {
  it("player 0's cards go to player 3", () => {
    const p0Cards = [c("spades", 1), c("spades", 2), c("spades", 3)];
    const others = [
      [c("clubs", 2), c("clubs", 7), c("clubs", 8)],
      [c("hearts", 1), c("hearts", 2), c("hearts", 3)],
      [c("diamonds", 1), c("diamonds", 2), c("diamonds", 3)],
    ] as Card[][];
    const state = mkState({
      passDirection: "right",
      playerHands: [
        [...p0Cards, c("clubs", 9), c("clubs", 10)],
        [...others[0]!, c("clubs", 11), c("clubs", 12)],
        [...others[1]!, c("clubs", 13), c("diamonds", 4)],
        [...others[2]!, c("diamonds", 5), c("diamonds", 6)],
      ],
      passSelections: [p0Cards, others[0]!, others[1]!, others[2]!],
    });
    const next = commitPass(state);
    p0Cards.forEach((card) => expect(next.playerHands[3]).toContainEqual(card));
  });
});

describe("commitPass — across", () => {
  it("player 0's cards go to player 2", () => {
    const p0Cards = [c("spades", 1), c("spades", 2), c("spades", 3)];
    const others = [
      [c("clubs", 2), c("clubs", 7), c("clubs", 8)],
      [c("hearts", 1), c("hearts", 2), c("hearts", 3)],
      [c("diamonds", 1), c("diamonds", 2), c("diamonds", 3)],
    ] as Card[][];
    const state = mkState({
      passDirection: "across",
      playerHands: [
        [...p0Cards, c("clubs", 9), c("clubs", 10)],
        [...others[0]!, c("clubs", 11), c("clubs", 12)],
        [...others[1]!, c("clubs", 13), c("diamonds", 4)],
        [...others[2]!, c("diamonds", 5), c("diamonds", 6)],
      ],
      passSelections: [p0Cards, others[0]!, others[1]!, others[2]!],
    });
    const next = commitPass(state);
    p0Cards.forEach((card) => expect(next.playerHands[2]).toContainEqual(card));
  });
});

describe("commitPass — none", () => {
  it("skips exchange and transitions to playing", () => {
    const hands = [
      [c("clubs", 3), c("clubs", 4), c("clubs", 5)],
      [c("clubs", 2), c("clubs", 6), c("clubs", 7)], // p1 has 2♣
      [c("clubs", 8), c("clubs", 9), c("clubs", 10)],
      [c("clubs", 11), c("clubs", 12), c("clubs", 13)],
    ] as Card[][];
    const state = mkState({
      passDirection: "none",
      playerHands: hands,
      passSelections: [[], [], [], []],
    });
    const next = commitPass(state);
    expect(next.phase).toBe("playing");
    expect(next.currentLeaderIndex).toBe(1);
    // Hands unchanged
    hands.forEach((hand, i) => {
      hand.forEach((card) => expect(next.playerHands[i]).toContainEqual(card));
    });
  });

  it("throws if selection is missing on a non-none hand", () => {
    const state = mkState({ passDirection: "left", passSelections: [[], [], [], []] });
    expect(() => commitPass(state)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// getValidPlays
// ---------------------------------------------------------------------------

describe("getValidPlays — first trick", () => {
  it("leader can only play 2♣", () => {
    const hand = [c("clubs", 2), c("spades", 1), c("hearts", 3)];
    const state = mkState({ playerHands: h4(hand), tricksPlayedInHand: 0 });
    expect(getValidPlays(state, 0)).toEqual([c("clubs", 2)]);
  });

  it("follower with clubs must follow suit", () => {
    const hand = [c("clubs", 5), c("hearts", 3), c("spades", 1)];
    const state = mkState({
      playerHands: h4([], hand),
      tricksPlayedInHand: 0,
      currentTrick: [{ card: c("clubs", 2), playerIndex: 0 }],
    });
    expect(getValidPlays(state, 1)).toEqual([c("clubs", 5)]);
  });

  it("follower void in clubs cannot play hearts or Q♠", () => {
    const hand = [c("hearts", 1), c("spades", 12), c("spades", 1), c("diamonds", 5)];
    const state = mkState({
      playerHands: h4([], hand),
      tricksPlayedInHand: 0,
      currentTrick: [{ card: c("clubs", 2), playerIndex: 0 }],
    });
    const valid = getValidPlays(state, 1);
    expect(valid).not.toContainEqual(c("hearts", 1));
    expect(valid).not.toContainEqual(c("spades", 12));
    expect(valid).toContainEqual(c("spades", 1));
    expect(valid).toContainEqual(c("diamonds", 5));
  });

  it("follower void in clubs with only hearts/Q♠ may play anything", () => {
    const hand = [c("hearts", 1), c("hearts", 2), c("spades", 12)];
    const state = mkState({
      playerHands: h4([], hand),
      tricksPlayedInHand: 0,
      currentTrick: [{ card: c("clubs", 2), playerIndex: 0 }],
    });
    expect(getValidPlays(state, 1)).toHaveLength(3);
  });
});

describe("getValidPlays — later tricks", () => {
  it("must follow led suit when holding it", () => {
    const hand = [c("spades", 5), c("spades", 7), c("hearts", 3)];
    const state = mkState({
      playerHands: h4([], hand),
      tricksPlayedInHand: 1,
      currentTrick: [{ card: c("spades", 2), playerIndex: 0 }],
    });
    const valid = getValidPlays(state, 1);
    expect(valid).toHaveLength(2);
    valid.forEach((c) => expect(c.suit).toBe("spades"));
  });

  it("void in led suit may play any card", () => {
    const hand = [c("hearts", 1), c("clubs", 3), c("diamonds", 7)];
    const state = mkState({
      playerHands: h4([], hand),
      tricksPlayedInHand: 1,
      currentTrick: [{ card: c("spades", 2), playerIndex: 0 }],
    });
    expect(getValidPlays(state, 1)).toHaveLength(3);
  });

  it("cannot lead hearts before they are broken", () => {
    const hand = [c("hearts", 1), c("hearts", 2), c("clubs", 5)];
    const state = mkState({
      playerHands: h4(hand),
      tricksPlayedInHand: 1,
      heartsBroken: false,
    });
    const valid = getValidPlays(state, 0);
    expect(valid).not.toContainEqual(c("hearts", 1));
    expect(valid).toContainEqual(c("clubs", 5));
  });

  it("can lead hearts once broken", () => {
    const hand = [c("hearts", 1), c("clubs", 5)];
    const state = mkState({
      playerHands: h4(hand),
      tricksPlayedInHand: 1,
      heartsBroken: true,
    });
    expect(getValidPlays(state, 0)).toHaveLength(2);
  });

  it("can lead hearts even if not broken when hand is all hearts", () => {
    const hand = [c("hearts", 1), c("hearts", 2), c("hearts", 3)];
    const state = mkState({
      playerHands: h4(hand),
      tricksPlayedInHand: 3,
      heartsBroken: false,
    });
    expect(getValidPlays(state, 0)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// playCard
// ---------------------------------------------------------------------------

describe("playCard", () => {
  it("removes card from hand and adds to trick", () => {
    const hand = [c("clubs", 2), c("clubs", 5)];
    const state = mkState({
      playerHands: h4(hand),
      tricksPlayedInHand: 0,
    });
    const next = playCard(state, 0, c("clubs", 2));
    expect(next.playerHands[0]).not.toContainEqual(c("clubs", 2));
    expect(next.currentTrick).toHaveLength(1);
    expect(next.currentTrick[0]?.card).toEqual(c("clubs", 2));
  });

  it("throws on invalid play", () => {
    const hand = [c("clubs", 2)];
    const state = mkState({ playerHands: h4(hand), tricksPlayedInHand: 0 });
    expect(() => playCard(state, 0, c("hearts", 5))).toThrow();
  });

  it("sets heartsBroken when a heart is played", () => {
    const hand = [c("hearts", 5), c("clubs", 3)];
    const state = mkState({
      playerHands: h4(hand),
      tricksPlayedInHand: 1,
      heartsBroken: false,
      currentTrick: [
        { card: c("hearts", 2), playerIndex: 3 },
        { card: c("hearts", 3), playerIndex: 1 },
        { card: c("hearts", 4), playerIndex: 2 },
      ],
    });
    const next = playCard(state, 0, c("hearts", 5));
    expect(next.heartsBroken).toBe(true);
  });

  it("does not set heartsBroken for non-heart cards", () => {
    const hand = [c("clubs", 2), c("clubs", 5)];
    const state = mkState({
      playerHands: h4(hand),
      tricksPlayedInHand: 0,
      heartsBroken: false,
    });
    const next = playCard(state, 0, c("clubs", 2));
    expect(next.heartsBroken).toBe(false);
  });

  it("emits heartsBroken event when first heart is played", () => {
    const hand = [c("hearts", 5), c("clubs", 3)];
    const state = mkState({
      playerHands: h4(hand),
      tricksPlayedInHand: 1,
      heartsBroken: false,
      currentTrick: [
        { card: c("hearts", 2), playerIndex: 3 },
        { card: c("hearts", 3), playerIndex: 1 },
        { card: c("hearts", 4), playerIndex: 2 },
      ],
    });
    const next = playCard(state, 0, c("hearts", 5));
    expect(next.events).toContainEqual({ type: "heartsBroken" });
  });

  it("does not emit heartsBroken when hearts already broken", () => {
    const hand = [c("hearts", 7), c("clubs", 3)];
    const state = mkState({
      playerHands: h4(hand),
      tricksPlayedInHand: 2,
      heartsBroken: true,
      currentTrick: [
        { card: c("hearts", 2), playerIndex: 3 },
        { card: c("hearts", 3), playerIndex: 1 },
        { card: c("hearts", 4), playerIndex: 2 },
      ],
    });
    const next = playCard(state, 0, c("hearts", 7));
    expect(next.events ?? []).not.toContainEqual({ type: "heartsBroken" });
  });

  it("does not emit heartsBroken for non-heart cards", () => {
    const hand = [c("clubs", 2), c("clubs", 5)];
    const state = mkState({
      playerHands: h4(hand),
      tricksPlayedInHand: 0,
      heartsBroken: false,
    });
    const next = playCard(state, 0, c("clubs", 2));
    expect(next.events ?? []).not.toContainEqual({ type: "heartsBroken" });
  });
});

// ---------------------------------------------------------------------------
// Event propagation — sequential calls (regression #814)
// ---------------------------------------------------------------------------

describe("playCard — stale-event regression (#814)", () => {
  it("does not carry forward heartsBroken when caller clears events between calls", () => {
    // P0 plays a heart, completing a 4-card trick and triggering the event.
    const state = mkState({
      playerHands: h4([c("hearts", 5), c("clubs", 3)]),
      tricksPlayedInHand: 1,
      heartsBroken: false,
      currentTrick: [
        { card: c("hearts", 2), playerIndex: 3 },
        { card: c("hearts", 3), playerIndex: 1 },
        { card: c("hearts", 4), playerIndex: 2 },
      ],
    });
    const withEvent = playCard(state, 0, c("hearts", 5));
    expect(withEvent.events).toContainEqual({ type: "heartsBroken" });

    // Without the fix: stale events carry into the next playCard call,
    // producing a new array reference with the same events — re-triggering animations.
    const withoutClear = playCard(withEvent, 0, c("clubs", 3));
    expect(withoutClear.events).toContainEqual({ type: "heartsBroken" });

    // With the fix: caller clears events before the next playCard call.
    const cleared = { ...withEvent, events: [] as typeof withEvent.events };
    const withClear = playCard(cleared, 0, c("clubs", 3));
    expect(withClear.events ?? []).not.toContainEqual({ type: "heartsBroken" });
  });
});

// ---------------------------------------------------------------------------
// Trick resolution
// ---------------------------------------------------------------------------

describe("trick resolution", () => {
  it("highest card of led suit wins (discards ignored)", () => {
    // P0 leads spades 5; P1 discards hearts ace; P2 plays spades 10; P3 plays spades 3
    // P2 should win
    const hands = [
      [c("spades", 5), c("clubs", 2)],
      [c("hearts", 1), c("clubs", 3)], // void in spades
      [c("spades", 10), c("clubs", 4)],
      [c("spades", 3), c("clubs", 5)],
    ] as Card[][];
    let state = mkState({
      playerHands: hands,
      tricksPlayedInHand: 1,
      heartsBroken: true,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
    });
    state = playCard(state, 0, c("spades", 5));
    state = playCard(state, 1, c("hearts", 1));
    state = playCard(state, 2, c("spades", 10));
    state = playCard(state, 3, c("spades", 3));

    expect(state.currentLeaderIndex).toBe(2);
    expect(state.wonCards[2]).toContainEqual(c("spades", 10));
    expect(state.currentTrick).toHaveLength(0);
  });

  it("awards trick points to winner's handScores", () => {
    const hands = [
      [c("spades", 5), c("clubs", 2)],
      [c("hearts", 1), c("clubs", 3)],
      [c("spades", 10), c("clubs", 4)],
      [c("spades", 3), c("clubs", 5)],
    ] as Card[][];
    let state = mkState({
      playerHands: hands,
      tricksPlayedInHand: 1,
      heartsBroken: true,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
    });
    state = playCard(state, 0, c("spades", 5));
    state = playCard(state, 1, c("hearts", 1));
    state = playCard(state, 2, c("spades", 10));
    state = playCard(state, 3, c("spades", 3));

    // P2 won the heart (1 pt)
    expect(state.handScores[2]).toBe(1);
    expect(state.handScores[0]).toBe(0);
  });

  it("Q♠ awards 13 points to the trick winner", () => {
    const hands = [
      [c("spades", 13), c("clubs", 2)], // p0 leads K♠
      [c("spades", 12), c("clubs", 3)], // p1 plays Q♠
      [c("spades", 3), c("clubs", 4)],
      [c("spades", 4), c("clubs", 5)],
    ] as Card[][];
    let state = mkState({
      playerHands: hands,
      tricksPlayedInHand: 1,
      heartsBroken: true,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
    });
    state = playCard(state, 0, c("spades", 13));
    state = playCard(state, 1, c("spades", 12));
    state = playCard(state, 2, c("spades", 3));
    state = playCard(state, 3, c("spades", 4));

    // P0 led K♠ and won (K > Q)
    expect(state.handScores[0]).toBe(13);
  });

  // Ace is high in Hearts — guards against rank-1 being treated as lowest (#739).
  it("Ace of led suit wins when led", () => {
    // P0 leads A♠; P1 K♠; P2 10♠; P3 5♠ — P0 should win
    const hands = [
      [c("spades", 1), c("clubs", 2)],
      [c("spades", 13), c("clubs", 3)],
      [c("spades", 10), c("clubs", 4)],
      [c("spades", 5), c("clubs", 5)],
    ] as Card[][];
    let state = mkState({
      playerHands: hands,
      tricksPlayedInHand: 1,
      heartsBroken: true,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
    });
    state = playCard(state, 0, c("spades", 1));
    state = playCard(state, 1, c("spades", 13));
    state = playCard(state, 2, c("spades", 10));
    state = playCard(state, 3, c("spades", 5));

    expect(state.currentLeaderIndex).toBe(0);
    expect(state.wonCards[0]).toContainEqual(c("spades", 1));
  });

  it("Ace of led suit wins when following suit", () => {
    // P0 leads 5♠; P1 follows A♠; P2 K♠; P3 3♠ — P1 should win
    const hands = [
      [c("spades", 5), c("clubs", 2)],
      [c("spades", 1), c("clubs", 3)],
      [c("spades", 13), c("clubs", 4)],
      [c("spades", 3), c("clubs", 5)],
    ] as Card[][];
    let state = mkState({
      playerHands: hands,
      tricksPlayedInHand: 1,
      heartsBroken: true,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
    });
    state = playCard(state, 0, c("spades", 5));
    state = playCard(state, 1, c("spades", 1));
    state = playCard(state, 2, c("spades", 13));
    state = playCard(state, 3, c("spades", 3));

    expect(state.currentLeaderIndex).toBe(1);
    expect(state.wonCards[1]).toContainEqual(c("spades", 1));
  });

  it("Ace of led suit collects Q♠ penalty points", () => {
    // P0 leads 3♠; P1 A♠; P2 Q♠; P3 5♠ — P1 wins A♠ and the 13-point Q♠
    const hands = [
      [c("spades", 3), c("clubs", 2)],
      [c("spades", 1), c("clubs", 3)],
      [c("spades", 12), c("clubs", 4)],
      [c("spades", 5), c("clubs", 5)],
    ] as Card[][];
    let state = mkState({
      playerHands: hands,
      tricksPlayedInHand: 1,
      heartsBroken: true,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
    });
    state = playCard(state, 0, c("spades", 3));
    state = playCard(state, 1, c("spades", 1));
    state = playCard(state, 2, c("spades", 12));
    state = playCard(state, 3, c("spades", 5));

    expect(state.currentLeaderIndex).toBe(1);
    expect(state.handScores[1]).toBe(13);
    expect(state.handScores[2]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// queenOfSpades event
// ---------------------------------------------------------------------------

describe("resolveTrick — queenOfSpades event", () => {
  it("appends queenOfSpades event with correct takerSeat when Q♠ is in the trick", () => {
    // P0 leads K♠; P1 plays Q♠; P2,P3 play low spades — P0 wins (K > Q)
    const hands = [
      [c("spades", 13), c("clubs", 2)],
      [c("spades", 12), c("clubs", 3)],
      [c("spades", 3), c("clubs", 4)],
      [c("spades", 4), c("clubs", 5)],
    ] as Card[][];
    let state = mkState({
      playerHands: hands,
      tricksPlayedInHand: 1,
      heartsBroken: true,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
    });
    state = playCard(state, 0, c("spades", 13));
    state = playCard(state, 1, c("spades", 12));
    state = playCard(state, 2, c("spades", 3));
    state = playCard(state, 3, c("spades", 4));

    expect(state.events).toContainEqual({ type: "queenOfSpades", takerSeat: 0 });
  });

  it("sets takerSeat to the actual trick winner, not always player 0", () => {
    // P0 leads 3♠; P1 plays A♠ (wins); P2 plays Q♠; P3 plays 5♠
    const hands = [
      [c("spades", 3), c("clubs", 2)],
      [c("spades", 1), c("clubs", 3)],
      [c("spades", 12), c("clubs", 4)],
      [c("spades", 5), c("clubs", 5)],
    ] as Card[][];
    let state = mkState({
      playerHands: hands,
      tricksPlayedInHand: 1,
      heartsBroken: true,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
    });
    state = playCard(state, 0, c("spades", 3));
    state = playCard(state, 1, c("spades", 1));
    state = playCard(state, 2, c("spades", 12));
    state = playCard(state, 3, c("spades", 5));

    expect(state.events).toContainEqual({ type: "queenOfSpades", takerSeat: 1 });
  });

  it("does NOT append queenOfSpades event when Q♠ is not in the trick", () => {
    const hands = [
      [c("spades", 5), c("clubs", 2)],
      [c("hearts", 1), c("clubs", 3)],
      [c("spades", 10), c("clubs", 4)],
      [c("spades", 3), c("clubs", 5)],
    ] as Card[][];
    let state = mkState({
      playerHands: hands,
      tricksPlayedInHand: 1,
      heartsBroken: true,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
    });
    state = playCard(state, 0, c("spades", 5));
    state = playCard(state, 1, c("hearts", 1));
    state = playCard(state, 2, c("spades", 10));
    state = playCard(state, 3, c("spades", 3));

    expect(state.events ?? []).not.toContainEqual(
      expect.objectContaining({ type: "queenOfSpades" })
    );
  });

  it("still awards 13 points to the correct player when Q♠ is in the trick", () => {
    // P0 leads 3♠; P1 plays A♠ (wins); P2 plays Q♠
    const hands = [
      [c("spades", 3), c("clubs", 2)],
      [c("spades", 1), c("clubs", 3)],
      [c("spades", 12), c("clubs", 4)],
      [c("spades", 5), c("clubs", 5)],
    ] as Card[][];
    let state = mkState({
      playerHands: hands,
      tricksPlayedInHand: 1,
      heartsBroken: true,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
    });
    state = playCard(state, 0, c("spades", 3));
    state = playCard(state, 1, c("spades", 1));
    state = playCard(state, 2, c("spades", 12));
    state = playCard(state, 3, c("spades", 5));

    expect(state.handScores[1]).toBe(13);
    expect(state.handScores[0]).toBe(0);
  });

  it("awards both heart points and Q♠ points when they appear in the same trick", () => {
    // P0 leads 3♠; P1 A♠ (wins); P2 Q♠; P3 discards 2♥ — P1 takes 13+1=14 pts
    const hands = [
      [c("spades", 3), c("clubs", 2)],
      [c("spades", 1), c("clubs", 3)],
      [c("spades", 12), c("clubs", 4)],
      [c("hearts", 2), c("clubs", 5)],
    ] as Card[][];
    let state = mkState({
      playerHands: hands,
      tricksPlayedInHand: 1,
      heartsBroken: true,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
    });
    state = playCard(state, 0, c("spades", 3));
    state = playCard(state, 1, c("spades", 1));
    state = playCard(state, 2, c("spades", 12));
    state = playCard(state, 3, c("hearts", 2));

    expect(state.handScores[1]).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// detectMoon
// ---------------------------------------------------------------------------

describe("detectMoon", () => {
  it("returns player index when they took all 13 hearts and Q♠", () => {
    const allHearts = Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank));
    const wonCards = [[...allHearts, c("spades", 12)], [], [], []];
    expect(detectMoon(wonCards)).toBe(0);
  });

  it("returns null when hearts are split", () => {
    const wonCards = [[c("hearts", 1), c("hearts", 2), c("spades", 12)], [c("hearts", 3)], [], []];
    expect(detectMoon(wonCards)).toBe(null);
  });

  it("returns null when Q♠ is missing", () => {
    const allHearts = Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank));
    const wonCards = [allHearts, [], [], []];
    expect(detectMoon(wonCards)).toBe(null);
  });

  it("returns null for an empty wonCards state", () => {
    expect(detectMoon([[], [], [], []])).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// applyHandScoring
// ---------------------------------------------------------------------------

describe("applyHandScoring — normal", () => {
  it("adds handScores to cumulativeScores", () => {
    const allHearts = Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank));
    const state = mkState({
      phase: "hand_end",
      handScores: [10, 8, 5, 3],
      cumulativeScores: [20, 15, 10, 5],
      wonCards: [
        [c("hearts", 1), c("hearts", 2)],
        [c("hearts", 3), c("spades", 12)],
        [c("hearts", 4), c("hearts", 5)],
        allHearts.slice(5),
      ],
    });
    const next = applyHandScoring(state);
    expect(next.cumulativeScores).toEqual([30, 23, 15, 8]);
    expect(next.phase).toBe("dealing");
  });

  it("appends the applied delta to scoreHistory (#745)", () => {
    const state = mkState({
      phase: "hand_end",
      handScores: [10, 8, 5, 3],
      cumulativeScores: [20, 15, 10, 5],
      wonCards: [[c("hearts", 1)], [c("hearts", 2)], [c("hearts", 3)], [c("hearts", 4)]],
      scoreHistory: [
        [5, 5, 5, 5],
        [15, 10, 5, 0],
      ],
    });
    const next = applyHandScoring(state);
    expect(next.scoreHistory).toHaveLength(3);
    expect(next.scoreHistory[2]).toEqual([10, 8, 5, 3]);
  });
});

describe("applyHandScoring — moon shot", () => {
  it("shooter gets 0 pts added; everyone else gets +26", () => {
    const allHearts = Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank));
    const state = mkState({
      phase: "hand_end",
      handScores: [26, 0, 0, 0],
      cumulativeScores: [10, 20, 30, 40],
      wonCards: [[...allHearts, c("spades", 12)], [], [], []],
    });
    const next = applyHandScoring(state);
    expect(next.cumulativeScores[0]).toBe(10); // shooter unchanged
    expect(next.cumulativeScores[1]).toBe(46); // +26
    expect(next.cumulativeScores[2]).toBe(56); // +26
    expect(next.cumulativeScores[3]).toBe(66); // +26
  });

  it("scoreHistory row reflects post-moon delta, not raw handScores (#743/#745)", () => {
    const allHearts = Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank));
    const state = mkState({
      phase: "hand_end",
      handScores: [26, 0, 0, 0],
      cumulativeScores: [10, 20, 30, 40],
      wonCards: [[...allHearts, c("spades", 12)], [], [], []],
    });
    const next = applyHandScoring(state);
    expect(next.scoreHistory).toHaveLength(1);
    expect(next.scoreHistory[0]).toEqual([0, 26, 26, 26]);
  });
});

describe("applyHandScoring — moonShot event", () => {
  it("appends moonShot event when detectMoon returns non-null", () => {
    const allHearts = Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank));
    const state = mkState({
      phase: "hand_end",
      handScores: [26, 0, 0, 0],
      cumulativeScores: [0, 0, 0, 0],
      wonCards: [[...allHearts, c("spades", 12)], [], [], []],
    });
    const next = applyHandScoring(state);
    expect(next.events).toContainEqual({ type: "moonShot", shooter: 0 });
  });

  it("emits correct shooter index when player 2 shoots the moon", () => {
    const allHearts = Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank));
    const state = mkState({
      phase: "hand_end",
      handScores: [0, 0, 26, 0],
      cumulativeScores: [0, 0, 0, 0],
      wonCards: [[], [], [...allHearts, c("spades", 12)], []],
    });
    const next = applyHandScoring(state);
    expect(next.events).toContainEqual({ type: "moonShot", shooter: 2 });
  });

  it("does not append moonShot event when no moon was shot", () => {
    const state = mkState({
      phase: "hand_end",
      handScores: [10, 8, 5, 3],
      cumulativeScores: [0, 0, 0, 0],
      wonCards: [[c("hearts", 1)], [c("hearts", 2)], [c("hearts", 3)], [c("hearts", 4)]],
    });
    const next = applyHandScoring(state);
    const moonEvents = (next.events ?? []).filter((e) => e.type === "moonShot");
    expect(moonEvents).toHaveLength(0);
  });

  it("does not mutate pre-existing events entries", () => {
    const allHearts = Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank));
    const existing = [{ type: "heartsBroken" as const }];
    const state = mkState({
      phase: "hand_end",
      handScores: [26, 0, 0, 0],
      cumulativeScores: [0, 0, 0, 0],
      wonCards: [[...allHearts, c("spades", 12)], [], [], []],
      events: existing,
    });
    const next = applyHandScoring(state);
    expect(next.events).toContainEqual({ type: "heartsBroken" });
    expect(next.events).toContainEqual({ type: "moonShot", shooter: 0 });
    expect(state.events).toHaveLength(1); // original not mutated
  });

  it("emits moonShot even when the hand also triggers game_over", () => {
    const allHearts = Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank));
    // Player 1 shoots the moon; player 0 is at 80, so +26 pushes them to 106 → game_over
    const state = mkState({
      phase: "hand_end",
      handScores: [0, 26, 0, 0],
      cumulativeScores: [80, 0, 0, 0],
      wonCards: [[], [...allHearts, c("spades", 12)], [], []],
    });
    const next = applyHandScoring(state);
    expect(next.phase).toBe("game_over");
    expect(next.events).toContainEqual({ type: "moonShot", shooter: 1 });
  });
});

describe("resolveTrick — moonShot event mid-hand (#1364)", () => {
  it("emits moonShot immediately when moon is clinched before trick 13", () => {
    // Player 0 already holds 12 hearts + Q♠ (25 pts). One heart remains.
    // This is trick 11; winning it gives player 0 all 26 points mid-hand.
    const hearts12 = Array.from({ length: 12 }, (_, i) => c("hearts", (i + 2) as Rank));
    let state = mkState({
      tricksPlayedInHand: 10,
      heartsBroken: true,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
      wonCards: [[...hearts12, c("spades", 12)], [], [], []],
      handScores: [25, 0, 0, 0],
      playerHands: [[c("hearts", 1)], [c("clubs", 2)], [c("clubs", 3)], [c("clubs", 4)]],
    });
    state = playCard(state, 0, c("hearts", 1));
    state = playCard(state, 1, c("clubs", 2));
    state = playCard(state, 2, c("clubs", 3));
    state = playCard(state, 3, c("clubs", 4));

    expect(state.phase).toBe("playing");
    expect(state.events).toContainEqual({ type: "moonShot", shooter: 0 });
  });

  it("does not emit moonShot mid-hand when moon has not been clinched", () => {
    // Player 0 has only 12 hearts — still missing Q♠.
    const hearts12 = Array.from({ length: 12 }, (_, i) => c("hearts", (i + 2) as Rank));
    let state = mkState({
      tricksPlayedInHand: 10,
      heartsBroken: true,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
      wonCards: [hearts12, [], [], []],
      handScores: [12, 0, 0, 0],
      playerHands: [[c("hearts", 1)], [c("clubs", 2)], [c("clubs", 3)], [c("clubs", 4)]],
    });
    state = playCard(state, 0, c("hearts", 1));
    state = playCard(state, 1, c("clubs", 2));
    state = playCard(state, 2, c("clubs", 3));
    state = playCard(state, 3, c("clubs", 4));

    const moonEvents = (state.events ?? []).filter((e) => e.type === "moonShot");
    expect(moonEvents).toHaveLength(0);
  });

  it("emits moonShot exactly once when moon clinches mid-hand then applyHandScoring runs", () => {
    // Simulate state after a mid-hand moonShot has already been emitted —
    // applyHandScoring should not append a second event.
    const allHearts = Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank));
    const state = mkState({
      phase: "hand_end",
      handScores: [26, 0, 0, 0],
      cumulativeScores: [0, 0, 0, 0],
      wonCards: [[...allHearts, c("spades", 12)], [], [], []],
      events: [{ type: "moonShot", shooter: 0 }],
    });
    const next = applyHandScoring(state);
    const moonEvents = (next.events ?? []).filter((e) => e.type === "moonShot");
    expect(moonEvents).toHaveLength(1);
  });

  it("emits moonShot exactly once when moon is clinched on trick 13 (applyHandScoring path)", () => {
    // Moon clinched on the final trick — resolveTrick must NOT fire the event
    // (newTricksPlayed === 13 guard), applyHandScoring fires it once.
    const hearts12 = Array.from({ length: 12 }, (_, i) => c("hearts", (i + 2) as Rank));
    let state = mkState({
      tricksPlayedInHand: 12,
      heartsBroken: true,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
      wonCards: [[...hearts12, c("spades", 12)], [], [], []],
      handScores: [25, 0, 0, 0],
      cumulativeScores: [0, 0, 0, 0],
      playerHands: [[c("hearts", 1)], [c("clubs", 2)], [c("clubs", 3)], [c("clubs", 4)]],
    });
    state = playCard(state, 0, c("hearts", 1));
    state = playCard(state, 1, c("clubs", 2));
    state = playCard(state, 2, c("clubs", 3));
    state = playCard(state, 3, c("clubs", 4));

    const moonEvents = (state.events ?? []).filter((e) => e.type === "moonShot");
    expect(moonEvents).toHaveLength(1);
    expect(state.phase).not.toBe("playing");
  });
});

describe("applyHandScoring — game over", () => {
  it("transitions to game_over when any score reaches 100", () => {
    const state = mkState({
      phase: "hand_end",
      handScores: [30, 0, 0, 0],
      cumulativeScores: [80, 20, 10, 5],
      wonCards: [[], [], [], []],
    });
    const next = applyHandScoring(state);
    expect(next.phase).toBe("game_over");
    expect(next.isComplete).toBe(true);
  });

  it("picks the winner correctly on game over", () => {
    const state = mkState({
      phase: "hand_end",
      handScores: [30, 0, 0, 0],
      cumulativeScores: [80, 20, 10, 5],
      wonCards: [[], [], [], []],
    });
    const next = applyHandScoring(state);
    expect(next.winnerIndex).toBe(3); // lowest cumulative (5+0)
  });
});

// ---------------------------------------------------------------------------
// isGameOver
// ---------------------------------------------------------------------------

describe("isGameOver", () => {
  it("returns false when all scores are below 100", () => {
    expect(isGameOver([99, 50, 30, 10])).toBe(false);
  });

  it("returns true when exactly one score is 100", () => {
    expect(isGameOver([100, 50, 30, 10])).toBe(true);
  });

  it("returns true when a score exceeds 100", () => {
    expect(isGameOver([120, 50, 30, 10])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getWinner
// ---------------------------------------------------------------------------

describe("getWinner", () => {
  it("returns the index of the lowest score", () => {
    expect(getWinner([80, 60, 40, 20])).toBe(3);
  });

  it("returns lowest index on a tie", () => {
    expect(getWinner([20, 20, 50, 80])).toBe(0);
  });

  it("handles a single minimum score anywhere", () => {
    expect(getWinner([100, 90, 5, 80])).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// dealNextHand
// ---------------------------------------------------------------------------

describe("dealNextHand", () => {
  it("preserves cumulative scores and increments handNumber", () => {
    const state = mkState({ cumulativeScores: [10, 20, 30, 40], handNumber: 1, phase: "dealing" });
    const next = dealNextHand(state);
    expect(next.cumulativeScores).toEqual([10, 20, 30, 40]);
    expect(next.handNumber).toBe(2);
  });

  it("resets hand state for the new hand", () => {
    const state = mkState({ handScores: [10, 5, 3, 8], tricksPlayedInHand: 13, phase: "dealing" });
    const next = dealNextHand(state);
    expect(next.handScores).toEqual([0, 0, 0, 0]);
    expect(next.tricksPlayedInHand).toBe(0);
    expect(next.heartsBroken).toBe(false);
  });

  it("deals 52 unique cards with 13 per player", () => {
    const state = mkState({ phase: "dealing", handNumber: 1 });
    const next = dealNextHand(state);
    const allCards = next.playerHands.flatMap((h) => h);
    expect(allCards).toHaveLength(52);
    const ids = new Set(allCards.map((c) => `${c.suit}-${c.rank}`));
    expect(ids.size).toBe(52);
  });

  it("preserves scoreHistory across the new deal (#745)", () => {
    const history = [
      [5, 5, 5, 5],
      [10, 8, 4, 4],
    ];
    const state = mkState({ phase: "dealing", handNumber: 2, scoreHistory: history });
    const next = dealNextHand(state);
    expect(next.scoreHistory).toEqual(history);
  });
});

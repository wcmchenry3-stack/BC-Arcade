/**
 * Hearts information set unit tests (#2029).
 *
 * Covers all acceptance criteria from the issue:
 *   - seenKeys aggregates all wonCards + current trick cards
 *   - seenKeys: every played card appears exactly once in a full-hand replay
 *   - ledSuit: null when leading, set when following
 *   - voidLedger: off-suit discard marks the player void in led suit
 *   - voidLedger: legal follow (in-suit play) does NOT mark a void
 *   - voidLedger: current-trick live observations (in-progress trick)
 *   - voidLedger: ledger resets between hands (knownVoids absent → empty ledger)
 *   - voidLedger: engine-tracked knownVoids carry into the info set
 *   - isFirstTrick: true when tricksPlayedInHand === 0
 *   - tricksRemaining: 13 − tricksPlayedInHand
 *   - pointsPerPlayer reflects handScores
 *   - cumulativeScores passed through
 *   - passDirection and heartsBroken passed through
 */

import { buildHeartsInfoSet } from "../aiInfoSet";
import {
  createSeededRng,
  dealGame,
  dealNextHand,
  getValidPlays,
  playCard,
  setRng,
} from "../engine";
import type { Card, HeartsState, Rank, Suit, TrickCard } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function c(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

function tc(suit: Suit, rank: Rank, playerIndex: number): TrickCard {
  return { card: c(suit, rank), playerIndex };
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
    heartsBroken: false,
    tricksPlayedInHand: 1,
    isComplete: false,
    winnerIndex: null,
    knownVoids: [[], [], [], []],
    ...overrides,
  };
}

afterEach(() => {
  setRng(Math.random);
});

// ---------------------------------------------------------------------------
// Basic field pass-through
// ---------------------------------------------------------------------------

describe("buildHeartsInfoSet — basic fields", () => {
  it("returns kind === 'hearts'", () => {
    const state = mkState();
    const info = buildHeartsInfoSet([], [], state, 0);
    expect(info.kind).toBe("hearts");
  });

  it("passes hand through unchanged", () => {
    const hand = [c("clubs", 5), c("spades", 3)];
    const state = mkState();
    const info = buildHeartsInfoSet(hand, [], state, 0);
    expect(info.hand).toStrictEqual(hand);
  });

  it("passes currentTrick through unchanged", () => {
    const trick = [tc("clubs", 5, 3)];
    const state = mkState({ currentTrick: trick });
    const info = buildHeartsInfoSet([], trick, state, 0);
    expect(info.currentTrick).toStrictEqual(trick);
  });

  it("passes cumulativeScores through", () => {
    const state = mkState({ cumulativeScores: [10, 20, 30, 40] });
    const info = buildHeartsInfoSet([], [], state, 0);
    expect(info.cumulativeScores).toEqual([10, 20, 30, 40]);
  });

  it("passes passDirection through", () => {
    const state = mkState({ passDirection: "right" });
    const info = buildHeartsInfoSet([], [], state, 0);
    expect(info.passDirection).toBe("right");
  });

  it("passes heartsBroken through", () => {
    const state = mkState({ heartsBroken: true });
    const info = buildHeartsInfoSet([], [], state, 0);
    expect(info.heartsBroken).toBe(true);
  });

  it("pointsPerPlayer reflects handScores", () => {
    const state = mkState({ handScores: [3, 8, 0, 15] });
    const info = buildHeartsInfoSet([], [], state, 0);
    expect(info.pointsPerPlayer).toEqual([3, 8, 0, 15]);
  });
});

// ---------------------------------------------------------------------------
// isFirstTrick
// ---------------------------------------------------------------------------

describe("buildHeartsInfoSet — isFirstTrick", () => {
  it("is true when tricksPlayedInHand === 0", () => {
    const state = mkState({ tricksPlayedInHand: 0 });
    const info = buildHeartsInfoSet([], [], state, 0);
    expect(info.isFirstTrick).toBe(true);
  });

  it("is false when tricksPlayedInHand > 0", () => {
    const state = mkState({ tricksPlayedInHand: 5 });
    const info = buildHeartsInfoSet([], [], state, 0);
    expect(info.isFirstTrick).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tricksRemaining
// ---------------------------------------------------------------------------

describe("buildHeartsInfoSet — tricksRemaining", () => {
  it("is 13 at the start of a hand", () => {
    const state = mkState({ tricksPlayedInHand: 0 });
    const info = buildHeartsInfoSet([], [], state, 0);
    expect(info.tricksRemaining).toBe(13);
  });

  it("decrements correctly mid-hand", () => {
    const state = mkState({ tricksPlayedInHand: 7 });
    const info = buildHeartsInfoSet([], [], state, 0);
    expect(info.tricksRemaining).toBe(6);
  });

  it("is 0 after all 13 tricks", () => {
    const state = mkState({ tricksPlayedInHand: 13 });
    const info = buildHeartsInfoSet([], [], state, 0);
    expect(info.tricksRemaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ledSuit
// ---------------------------------------------------------------------------

describe("buildHeartsInfoSet — ledSuit", () => {
  it("is null when the trick is empty (player is leading)", () => {
    const state = mkState({ currentTrick: [] });
    const info = buildHeartsInfoSet([], [], state, 0);
    expect(info.ledSuit).toBeNull();
  });

  it("reflects the first card's suit when following", () => {
    const trick = [tc("diamonds", 7, 3), tc("diamonds", 2, 1)];
    const state = mkState({ currentTrick: trick });
    const info = buildHeartsInfoSet([], trick, state, 0);
    expect(info.ledSuit).toBe("diamonds");
  });

  it("reflects 'spades' when spades are led", () => {
    const trick = [tc("spades", 5, 2)];
    const state = mkState({ currentTrick: trick });
    const info = buildHeartsInfoSet([], trick, state, 0);
    expect(info.ledSuit).toBe("spades");
  });
});

// ---------------------------------------------------------------------------
// seenKeys
// ---------------------------------------------------------------------------

describe("buildHeartsInfoSet — seenKeys", () => {
  it("is empty at the very start (no wonCards, no trick)", () => {
    const state = mkState({ wonCards: [[], [], [], []], tricksPlayedInHand: 0 });
    const info = buildHeartsInfoSet([], [], state, 0);
    expect(info.seenKeys.size).toBe(0);
  });

  it("includes cards in wonCards piles", () => {
    const state = mkState({
      wonCards: [[c("hearts", 3), c("clubs", 7)], [], [], [c("spades", 12)]],
    });
    const info = buildHeartsInfoSet([], [], state, 0);
    expect(info.seenKeys.has("hearts:3")).toBe(true);
    expect(info.seenKeys.has("clubs:7")).toBe(true);
    expect(info.seenKeys.has("spades:12")).toBe(true);
  });

  it("includes cards in the current trick", () => {
    const trick = [tc("diamonds", 4, 1), tc("diamonds", 9, 2)];
    const state = mkState({ wonCards: [[], [], [], []], currentTrick: trick });
    const info = buildHeartsInfoSet([], trick, state, 0);
    expect(info.seenKeys.has("diamonds:4")).toBe(true);
    expect(info.seenKeys.has("diamonds:9")).toBe(true);
  });

  it("does not double-count cards appearing in both wonCards and trick (impossible in practice but safe)", () => {
    // Cards that somehow appear in both — Set deduplicates.
    const trick = [tc("clubs", 5, 0)];
    const state = mkState({
      wonCards: [[c("clubs", 5)], [], [], []],
      currentTrick: trick,
    });
    const info = buildHeartsInfoSet([], trick, state, 0);
    expect(info.seenKeys.has("clubs:5")).toBe(true);
    expect(info.seenKeys.size).toBe(1); // deduplicated
  });

  it("does not include cards still in hands", () => {
    const hand = [c("hearts", 1), c("spades", 13)];
    const state = mkState({ playerHands: [hand, [], [], []] });
    const info = buildHeartsInfoSet(hand, [], state, 0);
    expect(info.seenKeys.has("hearts:1")).toBe(false);
    expect(info.seenKeys.has("spades:13")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// seenKeys — full-hand replay: every played card appears exactly once
// ---------------------------------------------------------------------------

describe("buildHeartsInfoSet — seenKeys full-hand replay", () => {
  it("every played card appears in seenKeys exactly once at end of hand", () => {
    // Deal a deterministic game and play all 52 cards by always taking the first valid play.
    setRng(createSeededRng(99));

    // Build a known-deck state: 4 players, 13 cards each, no hearts broken.
    // Use a scripted full hand to avoid engine dealing complexity.
    // Cards: 4 suits × 13 ranks = 52 cards.
    const allCards: Card[] = [];
    const suits: Suit[] = ["clubs", "diamonds", "spades", "hearts"];
    for (const suit of suits) {
      for (let r = 1; r <= 13; r++) {
        allCards.push(c(suit, r as Rank));
      }
    }

    // Distribute 13 to each player
    const hands: Card[][] = [
      allCards.slice(0, 13),
      allCards.slice(13, 26),
      allCards.slice(26, 39),
      allCards.slice(39, 52),
    ];

    // Find who holds 2♣
    let startPlayer = 0;
    for (let p = 0; p < 4; p++) {
      if (hands[p]!.some((card) => card.suit === "clubs" && card.rank === 2)) {
        startPlayer = p;
        break;
      }
    }

    let state = mkState({
      playerHands: hands,
      currentLeaderIndex: startPlayer,
      currentPlayerIndex: startPlayer,
      tricksPlayedInHand: 0,
      heartsBroken: false,
      wonCards: [[], [], [], []],
      knownVoids: [[], [], [], []],
    });

    // Track every card played in order
    const playedCards: string[] = [];

    // Play all 13 tricks
    for (let trick = 0; trick < 13; trick++) {
      for (let play = 0; play < 4; play++) {
        const player = state.currentPlayerIndex;
        const valid = getValidPlays(state, player);
        const card = valid[0]!;
        playedCards.push(`${card.suit}:${card.rank}`);
        state = playCard(state, player, card);
        if (state.phase !== "playing") break;
      }
      if (state.phase !== "playing") break;
    }

    // At the end of the hand, wonCards has all 52 cards. seenKeys should have exactly 52 entries.
    const finalInfo = buildHeartsInfoSet([], [], state, 0);

    // Every card that was played should be in seenKeys
    for (const key of playedCards) {
      expect(finalInfo.seenKeys.has(key)).toBe(true);
    }

    // Total seen should be exactly the number of unique cards played (all 52)
    expect(finalInfo.seenKeys.size).toBe(playedCards.length);
  });
});

// ---------------------------------------------------------------------------
// voidLedger — off-suit discard marks void
// ---------------------------------------------------------------------------

describe("buildHeartsInfoSet — voidLedger from engine (knownVoids)", () => {
  it("records void when engine knownVoids is set for a player", () => {
    const state = mkState({
      knownVoids: [["diamonds"], [], ["spades", "hearts"], []],
    });
    const info = buildHeartsInfoSet([], [], state, 0);
    expect(info.voidLedger[0]?.diamonds).toBe(true);
    expect(info.voidLedger[2]?.spades).toBe(true);
    expect(info.voidLedger[2]?.hearts).toBe(true);
  });

  it("empty ledger when knownVoids is absent (legacy state)", () => {
    // knownVoids is optional; omitting it simulates a legacy save.
    const { knownVoids: _omitted, ...rest } = mkState();
    const state: HeartsState = rest as HeartsState;
    const info = buildHeartsInfoSet([], [], state, 0);
    // Should not throw; ledger entries for each player should be undefined or empty
    expect(info.voidLedger[0]?.spades).toBeUndefined();
    expect(info.voidLedger[1]?.hearts).toBeUndefined();
  });

  it("no false positives: player with no voids has no ledger entries", () => {
    const state = mkState({ knownVoids: [[], [], [], []] });
    const info = buildHeartsInfoSet([], [], state, 0);
    expect(info.voidLedger[0]).toBeUndefined();
    expect(info.voidLedger[1]).toBeUndefined();
    expect(info.voidLedger[2]).toBeUndefined();
    expect(info.voidLedger[3]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// voidLedger — live current-trick observations
// ---------------------------------------------------------------------------

describe("buildHeartsInfoSet — voidLedger from current trick (live)", () => {
  it("marks player void in led suit when they play off-suit in current trick", () => {
    // P3 leads diamonds; P1 (index 1 in trick, follower) plays a heart — void in diamonds.
    const trick: TrickCard[] = [
      tc("diamonds", 7, 3), // leader
      tc("hearts", 5, 1), // follower, off-suit → void in diamonds
    ];
    const state = mkState({ currentTrick: trick, knownVoids: [[], [], [], []] });
    const info = buildHeartsInfoSet([], trick, state, 0);
    expect(info.voidLedger[1]?.diamonds).toBe(true);
  });

  it("does NOT mark the leader as void (they set the suit)", () => {
    const trick: TrickCard[] = [
      tc("clubs", 4, 2), // leader — never a void observation
    ];
    const state = mkState({ currentTrick: trick, knownVoids: [[], [], [], []] });
    const info = buildHeartsInfoSet([], trick, state, 0);
    expect(info.voidLedger[2]?.clubs).toBeUndefined();
  });

  it("does NOT mark a legal follower void (they follow suit)", () => {
    // P0 leads spades; P1 follows with spades — P1 is NOT void in spades.
    const trick: TrickCard[] = [
      tc("spades", 5, 0), // leader
      tc("spades", 9, 1), // in-suit follow
    ];
    const state = mkState({ currentTrick: trick, knownVoids: [[], [], [], []] });
    const info = buildHeartsInfoSet([], trick, state, 0);
    expect(info.voidLedger[1]?.spades).toBeUndefined();
  });

  it("marks multiple followers void if multiple play off-suit in the same trick", () => {
    const trick: TrickCard[] = [
      tc("clubs", 8, 0), // leader — clubs
      tc("spades", 3, 1), // off-suit → void in clubs
      tc("hearts", 2, 2), // off-suit → void in clubs
    ];
    const state = mkState({ currentTrick: trick, knownVoids: [[], [], [], []] });
    const info = buildHeartsInfoSet([], trick, state, 0);
    expect(info.voidLedger[1]?.clubs).toBe(true);
    expect(info.voidLedger[2]?.clubs).toBe(true);
  });

  it("merges live current-trick voids with engine-tracked knownVoids", () => {
    // Player 1 is already known void in spades (from a previous trick).
    // Now in the current trick, player 2 plays off hearts — void in hearts too.
    const trick: TrickCard[] = [
      tc("hearts", 3, 0), // leader
      tc("clubs", 7, 2), // P2 is void in hearts
    ];
    const state = mkState({
      currentTrick: trick,
      knownVoids: [[], ["spades"], [], []],
    });
    const info = buildHeartsInfoSet([], trick, state, 0);
    // Engine-tracked
    expect(info.voidLedger[1]?.spades).toBe(true);
    // Live observation
    expect(info.voidLedger[2]?.hearts).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// voidLedger — end-to-end via engine (playCard sequences)
// ---------------------------------------------------------------------------

describe("buildHeartsInfoSet — void ledger integration via engine playCard", () => {
  it("off-suit discard in a completed trick is reflected in knownVoids and voidLedger", () => {
    // P0 leads clubs 5; P1 must follow clubs but has none — discards a heart.
    // After the trick resolves, engine records P1 as void in clubs.
    const hands: Card[][] = [
      [c("clubs", 5), c("clubs", 8)], // P0: clubs
      [c("hearts", 2), c("hearts", 3)], // P1: void in clubs
      [c("clubs", 3), c("clubs", 9)], // P2
      [c("clubs", 4), c("clubs", 10)], // P3
    ];

    let state = mkState({
      playerHands: hands,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
      tricksPlayedInHand: 1, // Not trick 0 so no first-trick restriction
      heartsBroken: true,
      knownVoids: [[], [], [], []],
    });

    state = playCard(state, 0, c("clubs", 5));
    state = playCard(state, 1, c("hearts", 2)); // off-suit discard
    state = playCard(state, 2, c("clubs", 3));
    state = playCard(state, 3, c("clubs", 4));

    // After trick resolves, P1 should be in knownVoids for clubs.
    expect(state.knownVoids?.[1]).toContain("clubs");

    // The info set should reflect this.
    const info = buildHeartsInfoSet(state.playerHands[0]!, state.currentTrick, state, 0);
    expect(info.voidLedger[1]?.clubs).toBe(true);
  });

  it("in-suit follow does NOT mark void — no false positive", () => {
    // P0 leads spades; all other players follow with spades (no voids).
    const hands: Card[][] = [
      [c("spades", 5), c("clubs", 2)],
      [c("spades", 7), c("clubs", 3)],
      [c("spades", 9), c("clubs", 4)],
      [c("spades", 11), c("clubs", 5)],
    ];

    let state = mkState({
      playerHands: hands,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
      tricksPlayedInHand: 1,
      heartsBroken: false,
      knownVoids: [[], [], [], []],
    });

    state = playCard(state, 0, c("spades", 5));
    state = playCard(state, 1, c("spades", 7));
    state = playCard(state, 2, c("spades", 9));
    state = playCard(state, 3, c("spades", 11));

    // No one should be void in spades.
    expect(state.knownVoids?.[0]).not.toContain("spades");
    expect(state.knownVoids?.[1]).not.toContain("spades");
    expect(state.knownVoids?.[2]).not.toContain("spades");
    expect(state.knownVoids?.[3]).not.toContain("spades");

    const info = buildHeartsInfoSet(state.playerHands[0]!, state.currentTrick, state, 0);
    expect(info.voidLedger[1]?.spades).toBeUndefined();
    expect(info.voidLedger[2]?.spades).toBeUndefined();
    expect(info.voidLedger[3]?.spades).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// voidLedger — ledger resets between hands
// ---------------------------------------------------------------------------

describe("buildHeartsInfoSet — void ledger resets between hands", () => {
  it("knownVoids are reset to empty arrays by dealNextHand", () => {
    // State at end of a hand where P1 was known void in clubs.
    const state = mkState({
      phase: "dealing",
      handNumber: 1,
      knownVoids: [[], ["clubs"], [], ["hearts", "diamonds"]],
    });

    const next = dealNextHand(state);

    // After dealing the next hand, knownVoids should be reset.
    expect(next.knownVoids).toEqual([[], [], [], []]);
    const info = buildHeartsInfoSet(next.playerHands[0]!, [], next, 0);
    expect(info.voidLedger[1]?.clubs).toBeUndefined();
    expect(info.voidLedger[3]?.hearts).toBeUndefined();
  });

  it("knownVoids start as empty arrays on a fresh dealGame", () => {
    setRng(createSeededRng(42));
    const state = dealGame();
    expect(state.knownVoids).toEqual([[], [], [], []]);
    const info = buildHeartsInfoSet(state.playerHands[0]!, [], state, 0);
    for (let p = 0; p < 4; p++) {
      expect(info.voidLedger[p]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Scripted trick sequence — ledger and seenKeys evolution
// ---------------------------------------------------------------------------

describe("buildHeartsInfoSet — scripted trick sequence", () => {
  it("seenKeys and voidLedger evolve correctly across multiple tricks", () => {
    // Set up a scripted scenario:
    // Trick 1: P0 leads clubs; P1 discards heart (void in clubs); P2/P3 follow clubs.
    // After trick 1, P0 leads diamonds; P2 is void in diamonds (only has spades left).
    //
    // Hands designed so:
    //   P2 has one club (for trick 1) and one spade (for trick 2) — no diamonds.
    //   P3 has one club (for trick 1) and one diamond (for trick 2).

    const initialHands: Card[][] = [
      [c("clubs", 6), c("diamonds", 4)], // P0: leads clubs, then leads diamonds
      [c("hearts", 9), c("diamonds", 5)], // P1: void in clubs, follows diamonds
      [c("clubs", 7), c("spades", 3)], // P2: follows clubs, then void in diamonds → spade
      [c("clubs", 8), c("diamonds", 7)], // P3: follows clubs, follows diamonds
    ];

    let state = mkState({
      playerHands: initialHands,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
      tricksPlayedInHand: 1,
      heartsBroken: true,
      wonCards: [[c("clubs", 2)], [], [c("clubs", 3)], [c("clubs", 4)]],
      knownVoids: [[], [], [], []],
    });

    // Before trick 1: seenKeys should have the 3 wonCards.
    const infoBeforeTrick1 = buildHeartsInfoSet(state.playerHands[0]!, [], state, 0);
    expect(infoBeforeTrick1.seenKeys.has("clubs:2")).toBe(true);
    expect(infoBeforeTrick1.seenKeys.has("clubs:3")).toBe(true);
    expect(infoBeforeTrick1.seenKeys.has("clubs:4")).toBe(true);
    expect(infoBeforeTrick1.seenKeys.size).toBe(3);

    // Play trick 1: P0 leads clubs:6; P1 discards hearts:9 (void in clubs); P2/P3 follow.
    // P2 wins with clubs:7 (highest follower-club; clubs:6 < clubs:7 < clubs:8, but P0 led clubs:6).
    // Actually: clubs:8 (P3) > clubs:7 (P2) > clubs:6 (P0) → P3 wins.
    state = playCard(state, 0, c("clubs", 6));
    state = playCard(state, 1, c("hearts", 9)); // P1 off-suit: void in clubs
    state = playCard(state, 2, c("clubs", 7));
    state = playCard(state, 3, c("clubs", 8));

    // After trick 1 resolves — P3 wins.
    expect(state.knownVoids?.[1]).toContain("clubs");
    expect(state.knownVoids?.[0]).not.toContain("clubs");

    // Info set after trick 1: seenKeys now has 3 original + 4 trick cards = 7.
    const infoAfterTrick1 = buildHeartsInfoSet(state.playerHands[0]!, [], state, 0);
    expect(infoAfterTrick1.seenKeys.has("clubs:6")).toBe(true);
    expect(infoAfterTrick1.seenKeys.has("hearts:9")).toBe(true);
    expect(infoAfterTrick1.seenKeys.has("clubs:7")).toBe(true);
    expect(infoAfterTrick1.seenKeys.has("clubs:8")).toBe(true);
    expect(infoAfterTrick1.seenKeys.size).toBe(7); // 3 original + 4 new

    // Void ledger after trick 1
    expect(infoAfterTrick1.voidLedger[1]?.clubs).toBe(true);
    expect(infoAfterTrick1.voidLedger[0]?.clubs).toBeUndefined();

    // P0 won't lead trick 2 since P3 won; next leader is P3. But we need P0 to lead
    // for the diamonds scenario. Let's just observe the ledger state at this point
    // using a direct info set build for the remaining hand positions.
    //
    // Remaining hands: P0=[diamonds:4], P1=[diamonds:5], P2=[spades:3], P3=[diamonds:7]
    // P3 leads diamonds now. P2 is void in diamonds (has only spades:3).
    // Manually play trick 2 from the actual current state.
    const leader = state.currentLeaderIndex; // should be P3 (won trick 1)

    // Build info set mid-trick: P3 leads diamonds, P0 follows, P1 follows.
    // We can observe that P2 will play off-suit once the trick resolves.
    // Play trick 2:
    state = playCard(state, leader, c("diamonds", 7)); // P3 leads diamonds
    // P0 is next after P3 (P3+1=0)
    state = playCard(state, (leader + 1) % 4, c("diamonds", 4)); // P0 follows diamonds
    state = playCard(state, (leader + 2) % 4, c("diamonds", 5)); // P1 follows diamonds
    state = playCard(state, (leader + 3) % 4, c("spades", 3)); // P2 void: off-suit

    // After trick 2 resolves, P2 should be known void in diamonds.
    expect(state.knownVoids?.[2]).toContain("diamonds");

    const infoAfterTrick2 = buildHeartsInfoSet(state.playerHands[0]!, [], state, 0);
    expect(infoAfterTrick2.voidLedger[1]?.clubs).toBe(true); // retained from trick 1
    expect(infoAfterTrick2.voidLedger[2]?.diamonds).toBe(true); // added in trick 2
  });
});

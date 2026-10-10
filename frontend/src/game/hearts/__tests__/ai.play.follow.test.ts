/**
 * Hearts AI unit tests (#606): `selectCardToPlay` when following suit (`chooseFollow`).
 *
 * Part of the `selectCardToPlay` cluster of `ai.ts`, split by describe group so no file passes the
 * ~1,000-line layout rule (#2955). Describe blocks moved whole; shared fixtures live in
 * `helpers/aiFixtures.ts`.
 */
import { detectMoonAttempt, selectCardToPlay } from "../ai";
import { setRng } from "../engine";
import type { Card, HeartsState, TrickCard } from "../types";
import { c, mkState } from "./helpers/aiFixtures";

// Pin RNG to suppress cognitive noise (NOISE_RATE: Cautious 55%, Schemer 19%) so tests
// are deterministic — noise fires only when rng() < noiseRate, never at 0.99.
beforeEach(() => setRng(() => 0.99));

// ---------------------------------------------------------------------------
// selectCardToPlay — following suit
// ---------------------------------------------------------------------------

describe("selectCardToPlay — following suit with points in trick", () => {
  it("plays highest card that still loses when trick has points", () => {
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
    // Winning rank is 10; utility AI plays a losing spade (any of 5, 7, 9)
    expect(pick.suit).toBe("spades");
    expect([5, 7, 9]).toContain(pick.rank);
  });

  it("plays a spade when forced to win a trick with points", () => {
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
    // Both 11 and 13 beat 10; utility AI picks one (valid play required)
    expect(["spades"]).toContain(pick.suit);
    expect([11, 13]).toContain(pick.rank);
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
    // Q♠ (rank 12) would win the trick — should not be played
    expect(pick).not.toEqual(c("spades", 12));
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
  });

  it("hard AI in moon-attempt mode does not dump Q♠ even when covering card present", () => {
    // Daring holds a viable moon hand (#2234: 5 top hearts, Q♠, A♦-led
    // diamonds) with 0 pts taken → isMoonAttempt = true.
    // A♠ is covering; Q♠ should be held to complete the moon shot.
    const hand = [
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 12),
      c("hearts", 11),
      c("hearts", 10),
      c("spades", 12),
      c("spades", 7),
      c("diamonds", 1),
      c("diamonds", 3),
      c("diamonds", 2),
    ];
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
// First-trick club play — all personas should play highest club (#firstTrick)
// ---------------------------------------------------------------------------

describe("selectCardToPlay — first trick, play highest club (all personas)", () => {
  function mkTrick0State(playerHands: Card[][]): HeartsState {
    return mkState({
      playerHands,
      tricksPlayedInHand: 0,
      heartsBroken: false,
    });
  }

  const personas = ["cautious", "schemer", "daring"] as const;

  for (const persona of personas) {
    it(`${persona}: 2nd follower plays highest club, not lowest`, () => {
      // Player 1 leads 2♣; player 2 (2nd follower, not last) has 6♣ 5♣ 3♣.
      const hand2 = [c("clubs", 6), c("clubs", 5), c("clubs", 3)];
      const trick: TrickCard[] = [{ card: c("clubs", 2), playerIndex: 1 }];
      const state = mkTrick0State([[], hand2, hand2, []]);
      // currentTrick must match trick so getValidPlays sees a following situation.
      const pick = selectCardToPlay(
        hand2,
        trick,
        {
          ...state,
          currentPlayerIndex: 2,
          currentTrick: trick,
        },
        2,
        persona
      );
      expect(pick).toEqual(c("clubs", 6));
    });

    it(`${persona}: 3rd follower plays highest club, not lowest`, () => {
      // Player 1 leads 2♣, player 2 played 5♣; player 3 has K♣ J♣ 10♣ — should play K♣.
      const hand3 = [c("clubs", 13), c("clubs", 11), c("clubs", 10)];
      const trick: TrickCard[] = [
        { card: c("clubs", 2), playerIndex: 1 },
        { card: c("clubs", 5), playerIndex: 2 },
      ];
      const state = mkTrick0State([[], [], [], hand3]);
      const pick = selectCardToPlay(
        hand3,
        trick,
        {
          ...state,
          currentPlayerIndex: 3,
          currentTrick: trick,
        },
        3,
        persona
      );
      expect(pick).toEqual(c("clubs", 13));
    });

    it(`${persona}: last follower (4th) plays highest club`, () => {
      // Last to play — should also play highest club (A♣ over 4♣).
      const hand0 = [c("clubs", 1), c("clubs", 9), c("clubs", 4)];
      const trick: TrickCard[] = [
        { card: c("clubs", 2), playerIndex: 1 },
        { card: c("clubs", 7), playerIndex: 2 },
        { card: c("clubs", 11), playerIndex: 3 },
      ];
      const state = mkTrick0State([hand0, [], [], []]);
      const pick = selectCardToPlay(
        hand0,
        trick,
        {
          ...state,
          currentPlayerIndex: 0,
          currentTrick: trick,
        },
        0,
        persona
      );
      expect(pick).toEqual(c("clubs", 1)); // Ace (rank 1) is highest
    });
  }
});

// ---------------------------------------------------------------------------
// Daring AI — Q♠ spade-follow behavior (#1893)
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Daring Q♠ spade-follow behavior (#1893)", () => {
  it("dumps Q♠ when following spades with no A♠/K♠ cover and Q♠ won't win", () => {
    // Player 1 (Daring) follows spades: holds Q♠ + J♠ but NO A♠/K♠.
    // Seat 0 led A♠ — Q♠ (rank 12) loses to A♠ (aceHigh=14). Dump Q♠.
    const hand = [c("spades", 12), c("spades", 11), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 1), playerIndex: 0 }, // A♠ winning
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      heartsBroken: false,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    expect(pick).toEqual(c("spades", 12));
  });

  it("plays A♠ to win safely when holding Q♠ + A♠ and a low spade leads", () => {
    // Player 1 holds Q♠ + A♠. Low 5♠ leads — both Q♠ and A♠ would win.
    // chooseFollow plays lowestNonPoint (A♠) to win without taking 13 pts.
    const hand = [c("spades", 12), c("spades", 1), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 5), playerIndex: 0 }, // low spade — both Q♠ and A♠ win
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      heartsBroken: false,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // lowestNonPoint wins: A♠ (0 pts) is played, not Q♠ (13 pts).
    expect(pick).toEqual(c("spades", 1));
  });

  it("does NOT dump Q♠ when it would win the trick (no higher spade played)", () => {
    // Only J♠ in trick — Q♠ (rank 12) would WIN. Play a losing spade instead.
    const hand = [c("spades", 12), c("spades", 9), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("spades", 11), playerIndex: 0 }, // J♠ winning
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      heartsBroken: false,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Q♠ would win — utility AI avoids taking the trick with Q♠.
    expect(pick).not.toEqual(c("spades", 12));
    expect(pick.suit).toBe("spades"); // must follow suit
  });

  it("commits to the moon after capturing Q♠ + hearts (#2234)", () => {
    // Captured Q♠ + 10♥ + J♥ (15 pts), nobody else has points → committed
    // (MOON_HAND_RULES.commitPoints = 13), even though the 6-card hand no
    // longer rates on its own. The old heart-count rule (6+ total hearts)
    // dropped out here.
    const heartsInHand = [c("hearts", 2), c("hearts", 4), c("hearts", 6)];
    const heartsWon = [c("hearts", 10), c("hearts", 11)];
    const alreadyWon = [c("spades", 12), ...heartsWon]; // Q♠ + 2 hearts
    const hand = [...heartsInHand, c("diamonds", 13), c("diamonds", 8), c("clubs", 7)]; // 6 cards
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: [],
      tricksPlayedInHand: 7,
      currentPlayerIndex: 1,
      heartsBroken: false,
      handScores: [0, 15, 0, 0], // Q♠(13) + 2 hearts won
      wonCards: [[], alreadyWon, [], []],
    });
    expect(detectMoonAttempt(hand, state, 1, "daring")).toBe(true); // committed
    const pick = selectCardToPlay(hand, [], state, 1, "daring");
    expect(pick.suit).not.toBe("hearts"); // keeps its hearts to collect the rest
  });
});

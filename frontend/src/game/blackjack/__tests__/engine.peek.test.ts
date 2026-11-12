/**
 * #3741 (owner decision: standard rules). The dealer peeks: with an Ace or a ten-value card up, the
 * dealer checks for a natural before the player acts, and a dealer natural ends the hand at once
 * for the original bet only (a push against the player's natural). A natural beats any 21 that is
 * not one: a 3-card 21 loses to the dealer's natural, and the player's natural still wins 3:2
 * against a dealer who would have made 21 in three cards.
 */
import {
  doubleDown,
  hit,
  newGame,
  placeBet,
  split,
  stand,
  toViewState,
  type Card,
  type EngineState,
} from "../engine";
import { c, splitSetup, stateInPlayer } from "./helpers/engineFixtures";

/** A deck dealt in this order (player, dealer hole, player, dealer up, then draws), then 5s. */
function dealt(order: Card[], chips = 1000): EngineState {
  const deck = [...Array.from({ length: 30 }, () => c("♣", "5")), ...[...order].reverse()];
  return newGame(deck, { startingChips: chips, betMin: 5, betMax: 500 });
}

const TENS = ["10", "J", "Q", "K"];

describe("the dealer peeks on an Ace or a ten", () => {
  it.each([["A", "K"], ...TENS.map((t) => [t, "A"])])(
    "up card %s with %s in the hole: a natural, the hand ends at the deal and only the bet is lost",
    (up, hole) => {
      const s = placeBet(dealt([c("♠", "10"), c("♥", hole), c("♠", "8"), c("♦", up)]), 100);
      expect(s.phase).toBe("result");
      expect(s.outcome).toBe("lose");
      expect(s.payout).toBe(-100);
      expect(s.chips).toBe(900);
      expect(s.bet).toBe(100);
      // The dealer drew nothing; the player took nothing.
      expect(s.dealer_hand).toHaveLength(2);
      expect(s.player_hand).toHaveLength(2);
      expect(s.doubled).toBe(false);
      expect(s.split_count).toBe(0);
      expect(s.events).toEqual([{ type: "cardDeal" }, { type: "cardDeal" }, { type: "loss" }]);
      // The hole card shows with the result.
      expect(toViewState(s).dealer_hand.cards.every((x) => !x.face_down)).toBe(true);
      expect(toViewState(s).dealer_hand.value).toBe(21);
    }
  );

  it.each([["A"], ...TENS.map((t) => [t])])(
    "up card %s without a natural: the peek finds nothing and the player acts",
    (up) => {
      const hole = up === "A" ? "9" : "8";
      const s = placeBet(dealt([c("♠", "10"), c("♥", hole), c("♠", "6"), c("♦", up)]), 100);
      expect(s.phase).toBe("player");
      expect(s.outcome).toBeNull();
      expect(toViewState(s).dealer_hand.cards[0]?.face_down).toBe(true);
    }
  );

  it.each(["2", "3", "4", "5", "6", "7", "8", "9"])(
    "up card %s: no peek, the player acts (with the ace in the hole)",
    (up) => {
      const s = placeBet(dealt([c("♠", "10"), c("♥", "A"), c("♠", "6"), c("♦", up)]), 100);
      expect(s.phase).toBe("player");
      expect(toViewState(s).dealer_hand.cards[0]?.face_down).toBe(true);
    }
  );

  it("a dealer natural leaves no double or split to take: the actions throw", () => {
    // A pair of 8s that could split, 11 total would double: neither is offered.
    const s = placeBet(dealt([c("♠", "8"), c("♥", "K"), c("♣", "8"), c("♦", "A")]), 100);
    expect(s.outcome).toBe("lose");
    const v = toViewState(s);
    expect(v.double_down_available).toBe(false);
    expect(v.split_available).toBe(false);
    expect(() => doubleDown(s)).toThrow(/Not in player phase/);
    expect(() => split(s)).toThrow(/Not in player phase/);
    expect(() => hit(s)).toThrow(/Not in player phase/);
    expect(s.chips).toBe(900);
  });

  it("natural against natural is a push", () => {
    const s = placeBet(dealt([c("♠", "A"), c("♥", "K"), c("♣", "Q"), c("♦", "A")]), 100);
    expect(s.phase).toBe("result");
    expect(s.outcome).toBe("push");
    expect(s.payout).toBe(0);
    expect(s.chips).toBe(1000);
    expect(s.events).toEqual([{ type: "cardDeal" }, { type: "cardDeal" }, { type: "push" }]);
  });

  it("an all-in bet lost to the peek ends the run's chips and keeps the all-in event", () => {
    const s = placeBet(dealt([c("♠", "10"), c("♥", "K"), c("♣", "8"), c("♦", "A")], 50), 50);
    expect(s.chips).toBe(0);
    expect(s.events?.[0]).toEqual({ type: "allIn" });
    expect(toViewState(s).game_over).toBe(true);
  });
});

describe("a natural beats any 21 that is not one", () => {
  it("the player's natural against a dealer who would make 21 in three cards wins 3:2", () => {
    // Dealer 6 + 5 (11) with a K next: 21 in three cards, never drawn.
    const s = placeBet(
      dealt([c("♠", "A"), c("♥", "6"), c("♣", "K"), c("♦", "5"), c("♠", "K")]),
      100
    );
    expect(s.outcome).toBe("blackjack");
    expect(s.payout).toBe(150);
    expect(s.chips).toBe(1150);
    expect(s.dealer_hand).toHaveLength(2);
  });

  /**
   * A round saved mid-hand by a build from before the peek: the player still to act against the
   * dealer's natural. The peek makes it unreachable in play; the engine still settles it right.
   */
  const savedAgainstNatural = (player: Card[], deck: Card[] = []): EngineState => ({
    ...stateInPlayer(1000, 100),
    player_hand: player,
    dealer_hand: [c("♦", "K"), c("♣", "A")],
    deck: [...Array(10).fill(c("♠", "5")), ...[...deck].reverse()],
  });

  it("a 3-card 21 that stands against the dealer's natural loses (it pushed before #3741)", () => {
    const s = stand(savedAgainstNatural([c("♠", "10"), c("♥", "6"), c("♣", "5")]));
    expect(s.outcome).toBe("lose");
    expect(s.payout).toBe(-100);
    expect(s.events?.[0]).toEqual({ type: "loss" });
  });

  it("a hit to 21 then a stand against the dealer's natural loses", () => {
    const s = stand(hit(savedAgainstNatural([c("♠", "10"), c("♥", "6")], [c("♣", "5")])));
    expect(s.outcome).toBe("lose");
  });

  it("a double to 21 against the dealer's natural loses the doubled bet", () => {
    const s = doubleDown(savedAgainstNatural([c("♠", "6"), c("♥", "5")], [c("♣", "K")]));
    expect(s.outcome).toBe("lose");
    expect(s.payout).toBe(-200);
  });

  it("split hands of 21 against the dealer's natural lose", () => {
    const s0 = splitSetup({
      player: [c("♠", "8"), c("♥", "8")],
      dealer: [c("♦", "K"), c("♣", "A")],
      deck: [...Array(10).fill(c("♠", "2")), c("♦", "Q"), c("♣", "K"), c("♠", "3"), c("♥", "3")],
    });
    let s = split(s0);
    // Hand 1: 8 3 then K = 21; hand 2: 8 3 then Q = 21.
    s = stand(hit(s));
    s = stand(hit(s));
    expect(s.phase).toBe("result");
    expect(s.hand_outcomes).toEqual(["lose", "lose"]);
    expect(s.payout).toBe(-200);
  });

  it("21 against a dealer's 3-card 21 is still a push", () => {
    const s = stand({
      ...stateInPlayer(1000, 100),
      player_hand: [c("♠", "10"), c("♥", "6"), c("♣", "5")],
      dealer_hand: [c("♦", "6"), c("♣", "5")],
      deck: [...Array(10).fill(c("♠", "5")), c("♦", "K")],
    });
    expect(s.dealer_hand).toHaveLength(3);
    expect(s.outcome).toBe("push");
  });
});

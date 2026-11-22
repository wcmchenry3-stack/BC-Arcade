/**
 * A hand that reaches 21 stands on its own (#3764): a hit to 21 plays on as a Stand would (the
 * dealer's turn and the settlement on a single hand, the next hand on a split), and a split hand
 * dealt 21 is passed over at once. Split aces keep their one card each.
 *
 * Decks deal from the end: the last card in `deck` is the next one drawn.
 */
import {
  EngineState,
  doubleDown,
  handValue,
  hit,
  split,
  stand,
  standOnTwentyOne,
  toViewState,
} from "../engine";
import { c, splitSetup, stateInPlayer } from "./helpers/engineFixtures";

/** A deck that deals `draws` in order, after enough 5s that nothing reshuffles. */
const deckDealing = (...draws: ReturnType<typeof c>[]) => [
  ...Array(10).fill(c("♠", "5")),
  ...[...draws].reverse(),
];

describe("single hand: a hit to 21 stands", () => {
  it("hard 21 (7+4, hits a 10) settles with the dealer's turn, no Stand needed", () => {
    // Dealer 6+9 = 15 draws a 5 → 20: the player's 21 wins.
    const s: EngineState = {
      ...stateInPlayer(1000, 100),
      player_hand: [c("♠", "7"), c("♥", "4")],
      deck: deckDealing(c("♦", "10"), c("♣", "5")),
    };
    const next = hit(s);
    expect(handValue(next.player_hand)).toBe(21);
    expect(next.phase).toBe("result");
    expect(next.dealer_hand).toHaveLength(3);
    expect(handValue(next.dealer_hand)).toBe(20);
    expect(next.outcome).toBe("win");
    expect(next.payout).toBe(100);
    expect(next.chips).toBe(1100);
    expect(next.events).toEqual([{ type: "cardDeal" }, { type: "win" }]);
  });

  it("soft 21 (A+5, hits a 5) settles too", () => {
    // Dealer 6+9 = 15 draws a 6 → 21: a 3-card 21 against the player's 3-card 21 pushes.
    const s: EngineState = {
      ...stateInPlayer(1000, 100),
      player_hand: [c("♠", "A"), c("♥", "5")],
      deck: deckDealing(c("♦", "5"), c("♣", "6")),
    };
    const next = hit(s);
    expect(handValue(next.player_hand)).toBe(21);
    expect(next.phase).toBe("result");
    expect(next.outcome).toBe("push");
    expect(next.chips).toBe(1000);
    expect(next.events).toEqual([{ type: "cardDeal" }, { type: "push" }]);
  });

  it("settles exactly as a Stand on the same 21 would", () => {
    const s: EngineState = {
      ...stateInPlayer(1000, 100),
      player_hand: [c("♠", "7"), c("♥", "4")],
      deck: deckDealing(c("♦", "10"), c("♣", "2"), c("♣", "K")),
    };
    const auto = hit(s);
    // The same hand on 21, the 10 already drawn, then a Stand.
    const viaStand = stand({
      ...s,
      deck: s.deck.slice(0, -1),
      player_hand: [...s.player_hand, c("♦", "10")],
    });
    expect(auto.dealer_hand).toEqual(viaStand.dealer_hand);
    expect(auto.outcome).toBe(viaStand.outcome);
    expect(auto.chips).toBe(viaStand.chips);
  });

  it("a hit below 21 still waits for the player", () => {
    const s: EngineState = {
      ...stateInPlayer(1000, 100),
      player_hand: [c("♠", "7"), c("♥", "4")],
      deck: deckDealing(c("♦", "9")),
    };
    const next = hit(s);
    expect(handValue(next.player_hand)).toBe(20);
    expect(next.phase).toBe("player");
  });

  it("never leaves a player-phase view showing 21 on the hand to play", () => {
    const s: EngineState = {
      ...stateInPlayer(1000, 100),
      player_hand: [c("♠", "2"), c("♥", "3")],
      deck: deckDealing(c("♦", "6"), c("♣", "A"), c("♣", "9")),
    };
    // 5 → 11 → soft 12 → 21.
    let cur = s;
    while (cur.phase === "player") {
      const v = toViewState(cur);
      expect(v.player_hand.value).toBeLessThan(21);
      cur = hit(cur);
    }
    expect(handValue(cur.player_hand)).toBe(21);
  });
});

describe("split hands: 21 moves play on", () => {
  /** Split 8s against dealer 6+9; `draws` are dealt in order (the split's two cards first). */
  const split8s = (...draws: ReturnType<typeof c>[]) =>
    split(splitSetup({ deck: deckDealing(...draws) }));

  it("a split hand hit to 21 finishes; the next hand is played", () => {
    // Hands 8+3 and 8+2. Hand 1 hits a K → 21: play moves to hand 2.
    const s = split8s(c("♠", "3"), c("♥", "2"), c("♦", "K"));
    expect(s.active_hand_index).toBe(0);
    const next = hit(s);
    expect(handValue(next.player_hands[0]!)).toBe(21);
    expect(next.phase).toBe("player");
    expect(next.active_hand_index).toBe(1);
    expect(next.hand_outcomes).toEqual([null, null]);
    expect(next.events).toEqual([{ type: "cardDeal" }]);
  });

  it("the last split hand hit to 21 moves on to the dealer", () => {
    // Hands 8+3 and 8+2. Stand on 11, then hand 2 hits A → soft 21. Dealer 15 draws 5 → 20.
    const s = stand(split8s(c("♠", "3"), c("♥", "2"), c("♦", "A"), c("♣", "5")));
    expect(s.active_hand_index).toBe(1);
    const next = hit(s);
    expect(handValue(next.player_hands[1]!)).toBe(21);
    expect(next.phase).toBe("result");
    expect(handValue(next.dealer_hand)).toBe(20);
    expect(next.hand_outcomes).toEqual(["lose", "win"]);
    expect(next.events?.[0]).toEqual({ type: "cardDeal" });
    expect(next.events).toContainEqual({ type: "push" });
  });

  it("a split hand dealt 21 is passed over at once (10s split, the first gets an Ace)", () => {
    const s = split(
      splitSetup({
        player: [c("♠", "10"), c("♥", "10")],
        deck: deckDealing(c("♦", "A"), c("♣", "7")),
      })
    );
    expect(handValue(s.player_hands[0]!)).toBe(21);
    expect(s.phase).toBe("player");
    expect(s.active_hand_index).toBe(1);
    expect(toViewState(s).player_hand.value).toBe(17);
  });

  it("the second split hand dealt 21 is passed over when play reaches it", () => {
    // Hands 10+7 and 10+A. Standing on hand 1 skips hand 2 and the dealer plays.
    const s = split(
      splitSetup({
        player: [c("♠", "10"), c("♥", "10")],
        deck: deckDealing(c("♦", "7"), c("♣", "A"), c("♣", "2")),
      })
    );
    expect(s.active_hand_index).toBe(0);
    const next = stand(s);
    expect(next.phase).toBe("result");
    // Dealer 6+9 = 15 draws 2 → 17: hand 1 (17) pushes, hand 2 (21) wins.
    expect(next.hand_outcomes).toEqual(["push", "win"]);
  });

  it("both split hands dealt 21: the dealer plays straight from the split", () => {
    const s = split(
      splitSetup({
        player: [c("♠", "10"), c("♥", "10")],
        deck: deckDealing(c("♦", "A"), c("♣", "A"), c("♣", "2")),
      })
    );
    expect(s.phase).toBe("result");
    expect(s.hand_outcomes).toEqual(["win", "win"]);
    expect(s.chips).toBe(1200);
    expect(s.events).toContainEqual({ type: "win" });
  });

  it("a hit to 21 skips a following hand that was dealt 21", () => {
    // Re-split: 10s → [10,10] and [10,A]; split hand 1 again → [10,5], [10,6]. Hands: 10+5, 10+6, 10+A.
    let s = split(
      splitSetup({
        player: [c("♠", "10"), c("♥", "10")],
        deck: deckDealing(
          c("♦", "10"),
          c("♣", "A"),
          c("♦", "5"),
          c("♥", "6"),
          c("♠", "6"),
          c("♠", "Q"),
          c("♠", "2")
        ),
      })
    );
    s = split(s);
    expect(s.player_hands.map((h) => handValue(h))).toEqual([15, 16, 21]);
    s = hit(s); // 15 + 6 = 21 → hand 2
    expect(s.active_hand_index).toBe(1);
    s = hit(s); // 16 + Q = 26: bust; hand 3 (21) is passed over → the dealer
    expect(s.phase).toBe("result");
    // Dealer 6+9 = 15 draws 2 → 17.
    expect(s.hand_outcomes).toEqual(["win", "lose", "win"]);
  });

  it("a split double to 21 moves on as before", () => {
    const s = split8s(c("♠", "3"), c("♥", "2"), c("♦", "K"));
    const next = doubleDown(s);
    expect(handValue(next.player_hands[0]!)).toBe(21);
    expect(next.active_hand_index).toBe(1);
  });

  it("split aces still get one card each and never hit", () => {
    const s = split(
      splitSetup({
        player: [c("♠", "A"), c("♥", "A")],
        deck: deckDealing(c("♦", "K"), c("♣", "5"), c("♣", "2")),
      })
    );
    expect(s.player_hands.map((h) => h.length)).toEqual([2, 2]);
    expect(s.phase).toBe("result");
    expect(() => hit({ ...s, phase: "player", active_hand_index: 0 })).toThrow(
      "Cannot hit on split aces"
    );
  });
});

describe("standOnTwentyOne (a save from before #3764, on 21 in the player's phase)", () => {
  it("a single hand on 21 is stood and settled", () => {
    const saved: EngineState = {
      ...stateInPlayer(1000, 100),
      player_hand: [c("♠", "7"), c("♥", "4"), c("♦", "K")],
      deck: deckDealing(c("♣", "5")),
    };
    const next = standOnTwentyOne(saved);
    expect(next.phase).toBe("result");
    expect(next.outcome).toBe("win");
    expect(next.chips).toBe(1100);
    expect(next.events).toBeUndefined();
  });

  it("a split hand on 21 moves on to the next hand", () => {
    const saved: EngineState = {
      ...splitSetup(),
      split_count: 1,
      player_hands: [
        [c("♠", "8"), c("♥", "3"), c("♦", "K")],
        [c("♥", "8"), c("♣", "2")],
      ],
      hand_bets: [100, 100],
      hand_outcomes: [null, null],
      hand_payouts: [0, 0],
      split_from_aces: [false, false],
    };
    const next = standOnTwentyOne(saved);
    expect(next.phase).toBe("player");
    expect(next.active_hand_index).toBe(1);
  });

  it("any other save is returned as it is", () => {
    const below = stateInPlayer();
    expect(standOnTwentyOne(below)).toBe(below);
    const settled: EngineState = {
      ...stateInPlayer(),
      phase: "result",
      player_hand: [c("♠", "7"), c("♥", "4"), c("♦", "K")],
    };
    expect(standOnTwentyOne(settled)).toBe(settled);
  });
});

describe("every split settlement emits its outcome, milestones and comeback (#3764 review)", () => {
  /** Split 8s (1000 chips, 100 a hand) against dealer 6+9, dealing `draws` in order. */
  const split8s = (opts: Partial<EngineState>, ...draws: ReturnType<typeof c>[]) =>
    split({ ...splitSetup({ deck: deckDealing(...draws) }), ...opts });

  it("a Stand on the last hand: the outcome, and a milestone it reached", () => {
    // 8+3 and 8+K; stand, stand: dealer 15 draws K (bust). Both win: +200.
    const s = stand(split8s({ milestones: [1150] }, c("♠", "3"), c("♥", "K"), c("♦", "K")));
    const next = stand(s);
    expect(next.phase).toBe("result");
    expect(next.events).toEqual([{ type: "win" }, { type: "milestone", value: 1150 }]);
  });

  it("a Stand that reaches the run's goal: victory, with the outcome", () => {
    const s = stand(split8s({ runGoal: 1200 }, c("♠", "3"), c("♥", "K"), c("♦", "K")));
    const next = stand(s);
    expect(next.phase).toBe("victory");
    expect(next.events).toEqual([{ type: "win" }]);
  });

  it("a Stand that moves play on emits nothing", () => {
    const s = split8s({}, c("♠", "3"), c("♥", "K"));
    expect(stand(s).events).toBeUndefined();
  });

  it("a split hit that busts the last hand: the bust, then the outcome", () => {
    // 8+3 stands; 8+K hits a K (28). Dealer 15 draws 5 (20): hand 1 loses too.
    const s = stand(split8s({}, c("♠", "3"), c("♥", "K"), c("♦", "K"), c("♣", "5")));
    const next = hit(s);
    expect(next.phase).toBe("result");
    expect(next.events).toEqual([{ type: "cardDeal" }, { type: "bust" }, { type: "loss" }]);
  });

  it("a split hit that busts with a hand still to play emits no outcome", () => {
    const s = split8s({}, c("♠", "K"), c("♥", "2"), c("♦", "K"));
    const next = hit(s);
    expect(next.phase).toBe("player");
    expect(next.events).toEqual([{ type: "cardDeal" }, { type: "bust" }]);
  });

  it("a split double that busts the last hand: the bust, then the outcome", () => {
    // 8+3 stands; 8+5 doubles a K (23). Dealer 15 draws 5 (20).
    const s = stand(split8s({}, c("♠", "3"), c("♥", "5"), c("♦", "K"), c("♣", "5")));
    const next = doubleDown(s);
    expect(next.phase).toBe("result");
    expect(next.events).toEqual([{ type: "cardDeal" }, { type: "bust" }, { type: "loss" }]);
  });

  it("a split double that settles the round, reaching victory: the outcome", () => {
    // 8+3 stands on 11; 8+3 doubles a K (21). Dealer 15 draws K (bust): +100 and +200.
    const s = stand(split8s({ runGoal: 1300 }, c("♠", "3"), c("♥", "3"), c("♦", "K"), c("♣", "K")));
    const next = doubleDown(s);
    expect(next.phase).toBe("victory");
    expect(next.events).toEqual([{ type: "cardDeal" }, { type: "win" }]);
  });

  it("split aces settle at the split with their outcome", () => {
    // A+K 21 wins, A+5 16 loses to the dealer's 17: a push overall.
    const s = split(
      splitSetup({
        player: [c("♠", "A"), c("♥", "A")],
        deck: deckDealing(c("♦", "K"), c("♣", "5"), c("♣", "2")),
      })
    );
    expect(s.phase).toBe("result");
    expect(s.events).toEqual([{ type: "push" }]);
  });

  it("split aces reaching the run's goal: victory, with the outcome and the milestone", () => {
    // A+K and A+9 against a dealer bust (15 + K): +200.
    const s = split({
      ...splitSetup({
        player: [c("♠", "A"), c("♥", "A")],
        deck: deckDealing(c("♦", "K"), c("♣", "9"), c("♣", "K")),
      }),
      runGoal: 1200,
      milestones: [1100],
    });
    expect(s.phase).toBe("victory");
    expect(s.events).toEqual([{ type: "win" }, { type: "milestone", value: 1100 }]);
  });

  it("a comeback reached on a split settlement is emitted", () => {
    // From 600 after a low under 25%: +200 makes 800, past 75% of the 1000 start.
    const s = stand(
      split8s(
        { chips: 600, startingChips: 1000, hitLowChips: true },
        c("♠", "3"),
        c("♥", "K"),
        c("♦", "K")
      )
    );
    expect(stand(s).events).toEqual([{ type: "win" }, { type: "comeback" }]);
  });
});

describe("standOnTwentyOne leaves a single hand's two-card 21 alone", () => {
  it("a natural in the player's phase (no build saves one) is not stood as a plain 21", () => {
    const natural: EngineState = {
      ...stateInPlayer(1000, 100),
      player_hand: [c("♠", "A"), c("♥", "K")],
    };
    expect(standOnTwentyOne(natural)).toBe(natural);
  });
});

/**
 * Tests for the client-side Blackjack engine: the round flow (`newGame`, `placeBet`, `hit`,
 * `stand`, `doubleDown`, `newHand`): phases, bets, run config, victory, payouts, bust and
 * reshuffle.
 *
 * Ports backend/tests/test_blackjack_game.py so the two engines behave identically. Split out of
 * the former `engine.test.ts` (#2955) by exported-function cluster of `engine.ts`; describe blocks
 * moved whole, shared fixtures live in `helpers/engineFixtures.ts`.
 */
import {
  newGame,
  placeBet,
  hit,
  stand,
  doubleDown,
  split,
  newHand,
  handValue,
  toViewState,
  EngineState,
  Card,
  DEFAULT_RULES,
  DEFAULT_RUN_CONFIG,
} from "../engine";
import {
  c,
  emptySplitState,
  stateInPlayer,
  stateInResult,
  splitSetup,
} from "./helpers/engineFixtures";

// --- Double down — deterministic scenarios (rigged decks) -----------------
//
// deal() pops from the end of `deck`, so the LAST element is drawn first.
// Stack order for DD tests:
//     deck = [..., dealer_hit_2, dealer_hit_1, DD_card]
//                                               ^ popped first

function ddSetup(
  chips: number,
  bet: number,
  player: Card[],
  dealer: Card[],
  deck: Card[]
): EngineState {
  return {
    ...DEFAULT_RUN_CONFIG,
    milestones_reached: [],
    hitLowChips: false,
    comebackEmitted: false,
    chips,
    bet,
    phase: "player",
    outcome: null,
    payout: 0,
    lastWin: null,
    player_hand: player,
    dealer_hand: dealer,
    deck,
    doubled: false,
    rules: DEFAULT_RULES,
    ...emptySplitState(),
  };
}

// --- Fresh game state -----------------------------------------------------

describe("newGame", () => {
  it("starts in betting phase", () => expect(newGame().phase).toBe("betting"));
  it("starts with 1000 chips", () => expect(newGame().chips).toBe(1000));
  it("starts with 312-card deck (6 decks by default)", () =>
    expect(newGame().deck).toHaveLength(312));
  it("starts with empty hands", () => {
    const g = newGame();
    expect(g.player_hand).toEqual([]);
    expect(g.dealer_hand).toEqual([]);
  });
  it("starts with bet 0, outcome null, payout 0", () => {
    const g = newGame();
    expect(g.bet).toBe(0);
    expect(g.outcome).toBeNull();
    expect(g.payout).toBe(0);
  });
  it("starts with lastWin null", () => expect(newGame().lastWin).toBeNull());
});

// --- Phase machine --------------------------------------------------------

describe("phase machine", () => {
  it("placeBet transitions to player or result", () => {
    const g = placeBet(newGame(), 100);
    expect(["player", "result"]).toContain(g.phase);
  });

  it("hit in wrong phase throws", () => {
    expect(() => hit(newGame())).toThrow(/Not in player phase/);
  });

  it("stand in wrong phase throws", () => {
    expect(() => stand(newGame())).toThrow(/Not in player phase/);
  });

  it("doubleDown in wrong phase throws", () => {
    expect(() => doubleDown(newGame())).toThrow(/Not in player phase/);
  });

  it("newHand in wrong phase throws", () => {
    expect(() => newHand(newGame())).toThrow(/Not in result phase/);
  });

  it("placeBet in wrong phase throws", () => {
    expect(() => placeBet(stateInPlayer(), 100)).toThrow(/Not in betting phase/);
  });

  it("stand reaches result phase", () => {
    expect(stand(stateInPlayer()).phase).toBe("result");
  });

  it("newHand returns to betting", () => {
    expect(newHand(stateInResult()).phase).toBe("betting");
  });

  it("newHand resets bet and outcome", () => {
    const g = newHand(stateInResult(1000, 200, "win", 200));
    expect(g.bet).toBe(0);
    expect(g.outcome).toBeNull();
    expect(g.payout).toBe(0);
  });

  it("newHand carries payout into lastWin", () => {
    const g = newHand(stateInResult(1000, 100, "win", 100));
    expect(g.lastWin).toBe(100);
  });

  it("newHand carries negative payout into lastWin on loss", () => {
    const g = newHand(stateInResult(900, 100, "lose", -100));
    expect(g.lastWin).toBe(-100);
  });

  it("newHand carries 0 payout into lastWin on push", () => {
    const g = newHand(stateInResult(1000, 100, "push", 0));
    expect(g.lastWin).toBe(0);
  });
});

// --- Bet validation -------------------------------------------------------

describe("bet validation", () => {
  it("below minimum (4) throws", () => expect(() => placeBet(newGame(), 4)).toThrow());
  it("zero throws", () => expect(() => placeBet(newGame(), 0)).toThrow());
  it("above maximum throws", () => expect(() => placeBet(newGame(), 510)).toThrow());
  it("minimum bet of 5 accepted", () => {
    const g = placeBet(newGame(), 5);
    expect(["player", "result"]).toContain(g.phase);
  });
  it("non-multiple of 10 (15) accepted", () => {
    const g = placeBet(newGame(), 15);
    expect(["player", "result"]).toContain(g.phase);
  });
  it("non-multiple of 10 (30) accepted", () => {
    const g = placeBet(newGame(), 30);
    expect(["player", "result"]).toContain(g.phase);
  });
  it("exceeds chips throws", () =>
    expect(() => placeBet({ ...newGame(), chips: 50 }, 100)).toThrow(/Insufficient chips/));
  it("exact chips accepted", () => {
    const g = placeBet({ ...newGame(), chips: 100 }, 100);
    expect(["player", "result"]).toContain(g.phase);
  });
});

// --- Run config -----------------------------------------------------------

describe("run config", () => {
  it("newGame uses startingChips from runConfig", () => {
    const g = newGame(undefined, { startingChips: 250 });
    expect(g.chips).toBe(250);
    expect(g.startingChips).toBe(250);
  });

  it("newGame uses runGoal from runConfig", () => {
    const g = newGame(undefined, { runGoal: 500 });
    expect(g.runGoal).toBe(500);
  });

  it("newGame defaults to null runGoal (no victory)", () => {
    expect(newGame().runGoal).toBeNull();
  });

  it("newGame uses dynamic betMin/betMax", () => {
    const g = newGame(undefined, { betMin: 10, betMax: 50 });
    expect(g.betMin).toBe(10);
    expect(g.betMax).toBe(50);
  });

  it("placeBet respects dynamic betMin", () => {
    const g = newGame(undefined, { startingChips: 500, betMin: 10, betMax: 50 });
    expect(() => placeBet(g, 5)).toThrow();
    expect(() => placeBet(g, 10)).not.toThrow();
  });

  it("placeBet respects dynamic betMax", () => {
    const g = newGame(undefined, { startingChips: 500, betMin: 10, betMax: 50 });
    expect(() => placeBet(g, 51)).toThrow();
    expect(() => placeBet(g, 50)).not.toThrow();
  });
});

// --- Victory phase --------------------------------------------------------

describe("victory phase", () => {
  it("transitions to victory when chips reach runGoal after stand", () => {
    const s: EngineState = {
      ...stateInPlayer(240, 10),
      runGoal: 250,
      player_hand: [c("♠", "K"), c("♥", "9")], // 19
      dealer_hand: [c("♦", "6"), c("♣", "7")], // 13
      deck: Array(10).fill(c("♠", "4")), // dealer hits to 17
    };
    const r = stand(s);
    expect(r.outcome).toBe("win");
    expect(r.chips).toBe(250);
    expect(r.phase).toBe("victory");
  });

  it("transitions to victory on natural blackjack crossing the goal", () => {
    const g = newGame(undefined, { startingChips: 240, runGoal: 250, betMin: 5, betMax: 100 });
    const withDeck: EngineState = {
      ...g,
      deck: [c("♣", "5"), c("♦", "K"), c("♥", "6"), c("♠", "A")],
    };
    const r = placeBet(withDeck, 10);
    expect(r.outcome).toBe("blackjack");
    expect(r.phase).toBe("victory");
  });

  it("stays in result phase when chips do not reach runGoal", () => {
    const s: EngineState = {
      ...stateInPlayer(100, 10),
      runGoal: 250,
      player_hand: [c("♠", "K"), c("♥", "9")],
      dealer_hand: [c("♦", "6"), c("♣", "7")],
      deck: Array(10).fill(c("♠", "4")),
    };
    const r = stand(s);
    expect(r.phase).toBe("result");
  });

  it("never triggers victory when runGoal is null", () => {
    const s: EngineState = {
      ...stateInPlayer(2000, 10),
      runGoal: null,
      player_hand: [c("♠", "K"), c("♥", "9")],
      dealer_hand: [c("♦", "6"), c("♣", "7")],
      deck: Array(10).fill(c("♠", "4")),
    };
    expect(stand(s).phase).toBe("result");
  });

  it("toViewState sets run_complete true in victory phase", () => {
    const s: EngineState = {
      ...stateInResult(),
      phase: "victory",
      runGoal: 1000,
    };
    const view = toViewState(s);
    expect(view.run_complete).toBe(true);
    expect(view.run_goal).toBe(1000);
  });

  it("toViewState sets run_complete false in result phase", () => {
    expect(toViewState(stateInResult()).run_complete).toBe(false);
  });

  it("transitions to victory via doubleDown crossing the goal", () => {
    // Player 10+5=15, DD card 6 → 21. Dealer 6+8=14 hits 10 → 24 bust.
    // chips=230, bet=10 → DD doubles bet to 20, win pays +20 → 250 == runGoal.
    const s: EngineState = {
      ...ddSetup(
        230,
        10,
        [c("♠", "10"), c("♥", "5")],
        [c("♦", "6"), c("♣", "8")],
        [c("♠", "10"), c("♠", "6")]
      ),
      runGoal: 250,
    };
    const r = doubleDown(s);
    expect(r.outcome).toBe("win");
    expect(r.chips).toBe(250);
    expect(r.phase).toBe("victory");
  });

  it("transitions to victory via split settlement crossing the goal", () => {
    // Both split hands win: chips=230, bet=10 each → net +20 → 250 == runGoal.
    // Deck pop order: hand0 gets 9♥ (19), hand1 gets 9♦ (19), dealer draws 10♠ → busts.
    let s = split(
      splitSetup({
        chips: 230,
        bet: 10,
        player: [c("♠", "K"), c("♥", "K")],
        dealer: [c("♦", "6"), c("♣", "7")], // 13 → draws 10 → 23 bust
        deck: [c("♠", "10"), c("♦", "9"), c("♥", "9")],
      })
    );
    s = { ...s, runGoal: 250 };
    s = stand(s); // hand 0 done
    s = stand(s); // hand 1 done → finishIfAllHandsDone → victory
    expect(s.phase).toBe("victory");
    expect(s.chips).toBe(250);
  });

  it("newHand accepts victory phase", () => {
    const s: EngineState = { ...stateInResult(), phase: "victory" };
    expect(newHand(s).phase).toBe("betting");
  });
});

// --- Payouts --------------------------------------------------------------

describe("payouts (via stand)", () => {
  it("win pays 1:1", () => {
    // Force player 20 / dealer 18 → player wins
    const base = stateInPlayer(1000, 100);
    const forced: EngineState = {
      ...base,
      player_hand: [c("♠", "K"), c("♥", "Q")], // 20
      dealer_hand: [c("♦", "10"), c("♣", "8")], // 18
      deck: Array(10).fill(c("♠", "5")), // dealer already at 18, stands
    };
    const r = stand(forced);
    expect(r.outcome).toBe("win");
    expect(r.payout).toBe(100);
    expect(r.chips).toBe(1100);
  });

  it("lose deducts bet", () => {
    const base = stateInPlayer(1000, 100);
    const forced: EngineState = {
      ...base,
      player_hand: [c("♠", "9"), c("♥", "7")], // 16
      dealer_hand: [c("♦", "10"), c("♣", "9")], // 19
      deck: Array(10).fill(c("♠", "5")),
    };
    const r = stand(forced);
    expect(r.outcome).toBe("lose");
    expect(r.payout).toBe(-100);
    expect(r.chips).toBe(900);
  });

  it("push returns bet", () => {
    const base = stateInPlayer(1000, 100);
    const forced: EngineState = {
      ...base,
      player_hand: [c("♠", "9"), c("♥", "9")], // 18
      dealer_hand: [c("♦", "10"), c("♣", "8")], // 18
      deck: Array(10).fill(c("♠", "5")),
    };
    const r = stand(forced);
    expect(r.outcome).toBe("push");
    expect(r.payout).toBe(0);
    expect(r.chips).toBe(1000);
  });

  it("chips never go negative", () => {
    const forced: EngineState = {
      ...stateInPlayer(100, 200),
      player_hand: [c("♠", "9"), c("♥", "7")],
      dealer_hand: [c("♦", "10"), c("♣", "9")],
      deck: Array(10).fill(c("♠", "5")),
    };
    const r = stand(forced);
    expect(r.chips).toBeGreaterThanOrEqual(0);
  });
});

describe("blackjack payout (3:2, rounded up)", () => {
  // Force a natural blackjack during placeBet by stacking the deck.
  // Deck is popped from the end; deal order is P, D, P, D.
  // Deck from end: card1 P, card2 D, card3 P, card4 D
  it("blackjack pays ceil(bet * 1.5) — bet 10 → 15", () => {
    const g: EngineState = {
      ...newGame(),
      // Dealer will NOT have natural BJ (6+9=15)
      // Player gets A + K (natural BJ)
      // Deck pop order (last-in-first-out): [..., D=9, P=K, D=6, P=A]
      deck: [
        ...Array(40).fill(c("♠", "2")),
        c("♦", "9"), // D (2nd)
        c("♠", "K"), // P (2nd)
        c("♦", "6"), // D (1st)
        c("♠", "A"), // P (1st)
      ],
    };
    const r = placeBet(g, 10);
    expect(r.outcome).toBe("blackjack");
    expect(r.payout).toBe(15); // ceil(10 * 1.5)
    expect(r.chips).toBe(1015);
  });

  it("blackjack pays ceil(bet * 1.5) — bet 30 → 45", () => {
    const g: EngineState = {
      ...newGame(),
      deck: [...Array(40).fill(c("♠", "2")), c("♦", "9"), c("♠", "K"), c("♦", "6"), c("♠", "A")],
    };
    const r = placeBet(g, 30);
    expect(r.outcome).toBe("blackjack");
    expect(r.payout).toBe(45); // ceil(30 * 1.5)
  });

  it("player + dealer natural blackjack is a push", () => {
    const g: EngineState = {
      ...newGame(),
      // Both hands naturals. Pop order: [..., D=K, P=K, D=A, P=A]
      deck: [
        ...Array(40).fill(c("♠", "2")),
        c("♦", "K"), // D 2nd
        c("♠", "K"), // P 2nd
        c("♦", "A"), // D 1st
        c("♠", "A"), // P 1st
      ],
    };
    const r = placeBet(g, 100);
    expect(r.outcome).toBe("push");
    expect(r.payout).toBe(0);
  });
});

// --- Double down ----------------------------------------------------------

describe("double down", () => {
  it("requires exactly 2 cards", () => {
    const three: EngineState = {
      ...stateInPlayer(),
      player_hand: [c("♠", "7"), c("♥", "8"), c("♦", "2")],
    };
    expect(() => doubleDown(three)).toThrow(/initial two cards/);
  });

  it("requires chips >= 2*bet (free stack = chips - bet)", () => {
    // chips=150, bet=100 → only 50 free; needs another 100 to double.
    const broke: EngineState = stateInPlayer(150, 100);
    expect(() => doubleDown(broke)).toThrow(/Insufficient chips/);
  });

  it("accepts exact 2*bet (boundary)", () => {
    // chips=200, bet=100 → chips == 2*bet, allowed.
    const r = doubleDown(stateInPlayer(200, 100));
    expect(r.bet).toBe(200);
  });

  it("doubles the bet", () => {
    const r = doubleDown(stateInPlayer(500, 100));
    expect(r.bet).toBe(200);
  });

  it("reaches result phase", () => {
    const r = doubleDown(stateInPlayer(500, 100));
    expect(r.phase).toBe("result");
  });

  it("applies 2x payout delta", () => {
    // Under "chips includes wagered" accounting, doubling the bet doubles
    // the settlement delta. Start 300 / bet 100:
    //   win:  300 + 200 = 500
    //   lose: 300 - 200 = 100
    //   push: 300 + 0   = 300
    const r = doubleDown(stateInPlayer(300, 100));
    expect(r.bet).toBe(200);
    if (r.outcome === "win") expect(r.chips).toBe(500);
    if (r.outcome === "lose") expect(r.chips).toBe(100);
    if (r.outcome === "push") expect(r.chips).toBe(300);
    expect(r.chips).toBeGreaterThanOrEqual(0);
  });
});

// --- Bust -----------------------------------------------------------------

describe("bust", () => {
  it("player bust settles as lose", () => {
    // Force a 20 player hand, deck tops with a 10 → bust to 30
    const forced: EngineState = {
      ...stateInPlayer(),
      player_hand: [c("♠", "K"), c("♥", "Q")],
      deck: Array(20).fill(c("♠", "10")),
    };
    const r = hit(forced);
    expect(r.phase).toBe("result");
    expect(r.outcome).toBe("lose");
  });
});

// --- Reshuffle ------------------------------------------------------------

describe("deck reshuffle", () => {
  it("reshuffles when below threshold on newHand", () => {
    // Default rules: 6 decks, 0.75 penetration → threshold = max(15, 312*0.25) = 78
    const low: EngineState = { ...stateInResult(), deck: [c("♠", "5"), c("♥", "5")] };
    const r = newHand(low);
    expect(r.deck.length).toBe(312); // 6 decks
  });

  it("keeps deck when above threshold on newHand", () => {
    // 80 cards remaining is above threshold (78)
    const high: EngineState = { ...stateInResult(), deck: Array(80).fill(c("♠", "5")) };
    const r = newHand(high);
    expect(r.deck.length).toBe(80);
  });
});

describe("double down — deterministic scenarios", () => {
  it("DD win pays net +2*bet (dealer busts)", () => {
    // Player 10+5=15, DD card 6 → 21. Dealer 6+8=14, hits 10 → 24 bust.
    const g = ddSetup(
      500,
      100,
      [c("♠", "10"), c("♥", "5")],
      [c("♦", "6"), c("♣", "8")],
      [c("♠", "10"), c("♠", "6")] // dealer hit, then DD card (popped first)
    );
    const r = doubleDown(g);
    expect(r.outcome).toBe("win");
    expect(r.bet).toBe(200);
    expect(r.chips).toBe(500 + 200); // net +2*bet
  });

  it("DD loss debits net -2*bet", () => {
    // Player 10+5=15, DD card 2 → 17. Dealer 9+9=18 stands.
    const g = ddSetup(
      500,
      100,
      [c("♠", "10"), c("♥", "5")],
      [c("♦", "9"), c("♣", "9")],
      [c("♠", "2")]
    );
    const r = doubleDown(g);
    expect(r.outcome).toBe("lose");
    expect(r.chips).toBe(500 - 200);
  });

  it("DD push returns zero delta", () => {
    // Player 10+5=15, DD card 3 → 18. Dealer 9+9=18 stands. Push.
    const g = ddSetup(
      500,
      100,
      [c("♠", "10"), c("♥", "5")],
      [c("♦", "9"), c("♣", "9")],
      [c("♠", "3")]
    );
    const r = doubleDown(g);
    expect(r.outcome).toBe("push");
    expect(r.chips).toBe(500);
  });

  it("DD to 21 is even money, not the 3:2 blackjack payout", () => {
    // 6+5=11, DD card K → 21 (3 cards — not a natural). Pays +2*bet,
    // NOT ceil(1.5 * 200) = 300.
    const g = ddSetup(
      500,
      100,
      [c("♠", "6"), c("♥", "5")],
      [c("♦", "10"), c("♣", "8")], // 18, stands
      [c("♠", "K")]
    );
    const r = doubleDown(g);
    expect(r.outcome).toBe("win");
    expect(r.chips).toBe(500 + 200); // not +300
  });

  it("DD bust settles immediately — dealer hand untouched", () => {
    // Player 10+10=20, DD card 5 → 25 bust. Dealer MUST NOT draw.
    const dealerInitial = [c("♦", "6"), c("♣", "7")];
    const g = ddSetup(
      500,
      100,
      [c("♠", "K"), c("♥", "Q")],
      dealerInitial,
      [c("♠", "2"), c("♠", "5")] // 2 is "would-be dealer hit"
    );
    const r = doubleDown(g);
    expect(r.outcome).toBe("lose");
    expect(r.chips).toBe(500 - 200);
    expect(r.dealer_hand).toEqual(dealerInitial);
    // The unused dealer-hit card should still be in the deck.
    expect(r.deck.some((card) => card.rank === "2")).toBe(true);
  });

  it("sufficiency boundary: chips == 2*bet is allowed", () => {
    const g = ddSetup(
      200,
      100,
      [c("♠", "10"), c("♥", "5")],
      [c("♦", "9"), c("♣", "9")],
      [c("♠", "3")] // push
    );
    const r = doubleDown(g);
    expect(r.bet).toBe(200);
    expect(r.chips).toBe(200);
  });

  it("sufficiency boundary: chips == 2*bet - 10 rejected", () => {
    const g = ddSetup(
      190,
      100,
      [c("♠", "10"), c("♥", "5")],
      [c("♦", "9"), c("♣", "9")],
      [c("♠", "2")]
    );
    expect(() => doubleDown(g)).toThrow(/Insufficient chips/);
  });

  it("exact 2*bet loss → chips 0 and game_over via view state", () => {
    const g = ddSetup(
      200,
      100,
      [c("♠", "10"), c("♥", "5")],
      [c("♦", "9"), c("♣", "9")],
      [c("♠", "2")] // → 17, dealer 18 → lose
    );
    const r = doubleDown(g);
    expect(r.outcome).toBe("lose");
    expect(r.chips).toBe(0);
    expect(r.phase).toBe("result");
    expect(toViewState(r).game_over).toBe(true);
  });

  it("DD refused after a hit (3rd card)", () => {
    const g = ddSetup(
      500,
      100,
      [c("♠", "5"), c("♥", "5")],
      [c("♦", "9"), c("♣", "8")],
      [c("♠", "3")]
    );
    const afterHit = hit(g);
    expect(() => doubleDown(afterHit)).toThrow(/initial two cards/);
  });

  it("DD with soft 17 (A+6) — ace demotes when DD card busts", () => {
    // A+6 = 17 soft. DD card K → 11+6+10=27 > 21, ace demotes: 1+6+10 = 17.
    // Dealer 9+9=18 stands → lose.
    const g = ddSetup(
      500,
      100,
      [c("♠", "A"), c("♥", "6")],
      [c("♦", "9"), c("♣", "9")],
      [c("♠", "K")]
    );
    const r = doubleDown(g);
    expect(r.outcome).toBe("lose");
    expect(r.chips).toBe(500 - 200);
    // Confirm the final player total is 17 via the engine's handValue
    expect(handValue(r.player_hand)).toBe(17);
  });

  it("DD with soft 18 (A+7) — 3 brings it to hard 21 (ace stays 11)", () => {
    // A+7=18, DD card 3 → 11+7+3=21. Dealer 10+8=18 stands → win.
    const g = ddSetup(
      500,
      100,
      [c("♠", "A"), c("♥", "7")],
      [c("♦", "10"), c("♣", "8")],
      [c("♠", "3")]
    );
    const r = doubleDown(g);
    expect(handValue(r.player_hand)).toBe(21);
    expect(r.outcome).toBe("win");
    expect(r.chips).toBe(500 + 200);
  });
});

describe.each([
  [200, 100],
  [1000, 500],
  [20, 10],
])("double down — boundary at chips=%i, bet=%i", (chips, bet) => {
  it("DD at exact 2*bet with push leaves chips intact", () => {
    const g = ddSetup(
      chips,
      bet,
      [c("♠", "10"), c("♥", "5")],
      [c("♦", "9"), c("♣", "9")],
      [c("♠", "3")]
    );
    const r = doubleDown(g);
    expect(r.outcome).toBe("push");
    expect(r.chips).toBe(chips);
  });

  it("DD at exact 2*bet with loss reaches zero", () => {
    const g = ddSetup(
      chips,
      bet,
      [c("♠", "10"), c("♥", "5")],
      [c("♦", "9"), c("♣", "9")],
      [c("♠", "2")]
    );
    const r = doubleDown(g);
    expect(r.outcome).toBe("lose");
    expect(r.chips).toBe(0);
  });
});

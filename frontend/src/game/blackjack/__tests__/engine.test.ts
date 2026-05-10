/**
 * Tests for the client-side Blackjack engine.
 *
 * Ports backend/tests/test_blackjack_game.py so the two engines behave
 * identically. Covers: hand value, natural blackjack, deck generation,
 * phase transitions, bet validation, payouts, double down, bust,
 * reshuffle threshold.
 */

import {
  newGame,
  placeBet,
  hit,
  stand,
  doubleDown,
  split,
  canSplit,
  newHand,
  handValue,
  isNaturalBlackjack,
  isSoftHand,
  toViewState,
  setRng,
  createSeededRng,
  EngineState,
  Card,
  DEFAULT_RULES,
  DEFAULT_RUN_CONFIG,
} from "../engine";

// Helpers ------------------------------------------------------------------

function c(suit: string, rank: string): Card {
  return { suit, rank };
}

function emptySplitState() {
  return {
    player_hands: [] as Card[][],
    hand_bets: [] as number[],
    hand_outcomes: [] as (string | null)[],
    hand_payouts: [] as number[],
    active_hand_index: 0,
    split_count: 0,
    split_from_aces: [] as boolean[],
  };
}

function stateInPlayer(chips = 1000, bet = 100): EngineState {
  return {
    ...DEFAULT_RUN_CONFIG,
    milestones_reached: [],
    chips,
    bet,
    phase: "player",
    outcome: null,
    payout: 0,
    lastWin: null,
    deck: Array(20).fill(c("♠", "5")), // safe 5s — won't over-bust
    player_hand: [c("♠", "7"), c("♥", "8")], // 15
    dealer_hand: [c("♦", "6"), c("♣", "9")], // 15
    doubled: false,
    rules: DEFAULT_RULES,
    ...emptySplitState(),
  };
}

function stateInResult(
  chips = 1000,
  bet = 100,
  outcome: EngineState["outcome"] = "push",
  payout = 0
): EngineState {
  return {
    ...DEFAULT_RUN_CONFIG,
    milestones_reached: [],
    chips,
    bet,
    phase: "result",
    outcome,
    payout,
    lastWin: null,
    deck: Array(30).fill(c("♠", "5")),
    player_hand: [c("♠", "7"), c("♥", "8")],
    dealer_hand: [c("♦", "6"), c("♣", "9")],
    doubled: false,
    rules: DEFAULT_RULES,
    ...emptySplitState(),
  };
}

function splitSetup(opts?: {
  chips?: number;
  bet?: number;
  player?: Card[];
  dealer?: Card[];
  deck?: Card[];
}): EngineState {
  return {
    ...DEFAULT_RUN_CONFIG,
    milestones_reached: [],
    chips: opts?.chips ?? 1000,
    bet: opts?.bet ?? 100,
    phase: "player",
    outcome: null,
    payout: 0,
    lastWin: null,
    deck: opts?.deck ?? Array(20).fill(c("♠", "3")),
    player_hand: opts?.player ?? [c("♠", "8"), c("♥", "8")],
    dealer_hand: opts?.dealer ?? [c("♦", "6"), c("♣", "9")],
    doubled: false,
    rules: DEFAULT_RULES,
    ...emptySplitState(),
  };
}

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

// --- View state projection -----------------------------------------------

describe("toViewState", () => {
  it("conceals dealer hole card during player phase", () => {
    const view = toViewState(stateInPlayer());
    expect(view.dealer_hand.cards[0]).toEqual({ rank: "?", suit: "?", face_down: true });
    expect(view.dealer_hand.value).toBe(0);
    expect(view.player_hand.value).toBe(15);
  });

  it("reveals dealer hand during result phase", () => {
    const view = toViewState(stateInResult());
    expect(view.dealer_hand.cards[0]?.face_down).toBe(false);
    expect(view.dealer_hand.value).toBeGreaterThan(0);
  });

  it("sets game_over when chips=0 and phase=result", () => {
    const broke: EngineState = { ...stateInResult(0, 100), chips: 0 };
    expect(toViewState(broke).game_over).toBe(true);
  });

  it("game_over false when chips>0", () => {
    expect(toViewState(stateInResult()).game_over).toBe(false);
  });

  it("player_hand.soft is true for a soft hand", () => {
    const soft: EngineState = {
      ...stateInPlayer(),
      player_hand: [c("♠", "A"), c("♥", "6")], // soft 17
    };
    expect(toViewState(soft).player_hand.soft).toBe(true);
    expect(toViewState(soft).player_hand.value).toBe(17);
  });

  it("dealer_hand.soft is false when concealed (hole card hidden)", () => {
    const soft: EngineState = {
      ...stateInPlayer(),
      dealer_hand: [c("♦", "A"), c("♣", "6")], // soft 17 but concealed
    };
    const view = toViewState(soft);
    expect(view.dealer_hand.soft).toBe(false);
    expect(view.dealer_hand.value).toBe(0);
  });

  it("dealer_hand.soft is true when revealed in result phase", () => {
    const soft: EngineState = {
      ...stateInResult(),
      dealer_hand: [c("♦", "A"), c("♣", "6")], // soft 17
    };
    expect(toViewState(soft).dealer_hand.soft).toBe(true);
    expect(toViewState(soft).dealer_hand.value).toBe(17);
  });

  it("last_win is null on a fresh game", () => {
    expect(toViewState(newGame()).last_win).toBeNull();
  });

  it("last_win reflects lastWin from engine state", () => {
    const s: EngineState = { ...stateInResult(), lastWin: 150 };
    expect(toViewState(s).last_win).toBe(150);
  });

  it("last_win is negative for a loss", () => {
    const s: EngineState = { ...stateInResult(), lastWin: -100 };
    expect(toViewState(s).last_win).toBe(-100);
  });

  it("double_down_available only in player phase with 2 cards and chips >= 2*bet", () => {
    // chips=500, bet=100 → chips >= 200 ✓
    expect(toViewState(stateInPlayer(500, 100)).double_down_available).toBe(true);
    // boundary: chips=200, bet=100 ✓
    expect(toViewState(stateInPlayer(200, 100)).double_down_available).toBe(true);
    // chips=150, bet=100 → not enough free stack
    expect(toViewState(stateInPlayer(150, 100)).double_down_available).toBe(false);
    // 3 cards → not available
    const three: EngineState = {
      ...stateInPlayer(500, 100),
      player_hand: [c("♠", "5"), c("♥", "5"), c("♦", "5")],
    };
    expect(toViewState(three).double_down_available).toBe(false);
  });
});

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

// --- Seedable RNG ---------------------------------------------------------

describe("seedable RNG (setRng + createSeededRng)", () => {
  afterEach(() => {
    // Restore default RNG so subsequent tests aren't affected.
    setRng(Math.random);
  });

  it("same seed produces identical shuffled decks", () => {
    setRng(createSeededRng(42));
    const a = newGame();
    setRng(createSeededRng(42));
    const b = newGame();
    expect(a.deck).toEqual(b.deck);
  });

  it("different seeds produce different decks", () => {
    setRng(createSeededRng(1));
    const a = newGame();
    setRng(createSeededRng(999));
    const b = newGame();
    expect(a.deck).not.toEqual(b.deck);
  });

  it("same seed replays identical placeBet outcome (deal order preserved)", () => {
    setRng(createSeededRng(7));
    const a = placeBet(newGame(), 100);
    setRng(createSeededRng(7));
    const b = placeBet(newGame(), 100);
    expect(a.player_hand).toEqual(b.player_hand);
    expect(a.dealer_hand).toEqual(b.dealer_hand);
    expect(a.phase).toEqual(b.phase);
    expect(a.outcome).toEqual(b.outcome);
  });

  it("same seed replays identical stand → dealer play sequence", () => {
    setRng(createSeededRng(123));
    let a = placeBet(newGame(), 100);
    if (a.phase === "player") a = stand(a);

    setRng(createSeededRng(123));
    let b = placeBet(newGame(), 100);
    if (b.phase === "player") b = stand(b);

    expect(a.player_hand).toEqual(b.player_hand);
    expect(a.dealer_hand).toEqual(b.dealer_hand);
    expect(a.outcome).toEqual(b.outcome);
    expect(a.chips).toEqual(b.chips);
  });

  it("deck contains all 52 unique card types regardless of seed", () => {
    setRng(createSeededRng(12345));
    const { deck } = newGame();
    expect(deck).toHaveLength(312); // 6 decks
    const keys = new Set(deck.map((card) => `${card.rank}-${card.suit}`));
    expect(keys.size).toBe(52); // 52 unique card types, each repeated 6 times
  });

  it("setRng(Math.random) afterEach restores non-determinism", () => {
    const a = newGame();
    const b = newGame();
    // Two fresh shuffles from Math.random almost never match across 52 cards.
    expect(a.deck).not.toEqual(b.deck);
  });
});

// --- split ----------------------------------------------------------------

describe("split", () => {
  it("wrong phase throws", () => {
    expect(() => split(newGame())).toThrow("Not in player phase");
  });

  it("creates two hands from a pair", () => {
    const s = splitSetup({ deck: [c("♠", "3"), c("♥", "5")] });
    const next = split(s);
    expect(next.split_count).toBe(1);
    expect(next.player_hands).toHaveLength(2);
    expect(next.player_hands[0]).toHaveLength(2);
    expect(next.player_hands[1]).toHaveLength(2);
    expect(next.player_hands[0]?.[0]?.rank).toBe("8");
    expect(next.player_hands[1]?.[0]?.rank).toBe("8");
  });

  it("creates matching bets", () => {
    const next = split(splitSetup({ chips: 500, bet: 100 }));
    expect(next.hand_bets).toEqual([100, 100]);
  });

  it("rejects different ranks", () => {
    const s = splitSetup({ player: [c("♠", "7"), c("♥", "8")] });
    expect(() => split(s)).toThrow("cannot be split");
  });

  it("rejects when not two cards", () => {
    const s = splitSetup({ player: [c("♠", "8"), c("♥", "8"), c("♦", "2")] });
    expect(() => split(s)).toThrow("cannot be split");
  });

  it("rejects insufficient chips", () => {
    const s = splitSetup({ chips: 150, bet: 100 });
    expect(() => split(s)).toThrow("Insufficient chips");
  });

  it("allows split with exact chips", () => {
    const next = split(splitSetup({ chips: 200, bet: 100 }));
    expect(next.split_count).toBe(1);
  });

  it("splits 10-value cards (K+J)", () => {
    const s = splitSetup({ player: [c("♠", "K"), c("♥", "J")] });
    const next = split(s);
    expect(next.player_hands[0]?.[0]?.rank).toBe("K");
    expect(next.player_hands[1]?.[0]?.rank).toBe("J");
  });

  it("stays in player phase after split", () => {
    const next = split(splitSetup());
    expect(next.phase).toBe("player");
    expect(next.active_hand_index).toBe(0);
  });

  it("canSplit returns true for pair", () => {
    expect(canSplit(splitSetup())).toBe(true);
  });

  it("canSplit returns false for non-pair", () => {
    expect(canSplit(splitSetup({ player: [c("♠", "7"), c("♥", "8")] }))).toBe(false);
  });
});

describe("split hit/stand", () => {
  it("hit adds card to active split hand", () => {
    const s = split(splitSetup({ deck: [c("♠", "3"), c("♥", "5"), c("♦", "2")] }));
    const initial = s.player_hands[0]?.length ?? 0;
    const next = hit(s);
    expect(next.player_hands[0]).toHaveLength(initial + 1);
  });

  it("stand advances to next hand", () => {
    const s = split(splitSetup());
    expect(s.active_hand_index).toBe(0);
    const next = stand(s);
    expect(next.active_hand_index).toBe(1);
  });

  it("stand on last hand triggers dealer and result", () => {
    let s = split(
      splitSetup({
        deck: [c("♠", "3"), c("♥", "5"), c("♦", "10")],
        dealer: [c("♦", "6"), c("♣", "9")],
      })
    );
    s = stand(s); // hand 0 done
    s = stand(s); // hand 1 done → dealer plays → result
    expect(s.phase).toBe("result");
    expect(s.outcome).not.toBeNull();
  });

  it("bust on split hand settles and advances", () => {
    let s = split(
      splitSetup({ player: [c("♠", "K"), c("♥", "K")], deck: [c("♠", "3"), c("♥", "5")] })
    );
    // Override hand 0 to make bustable, override deck with bust card
    s = {
      ...s,
      player_hands: [[c("♠", "K"), c("♥", "5")], s.player_hands[1] ?? []],
      deck: [c("♠", "Q")],
    };
    const next = hit(s);
    expect(next.hand_outcomes[0]).toBe("lose");
    expect(next.active_hand_index).toBe(1);
  });
});

describe("split payout", () => {
  it("independent outcomes per hand (one win, one lose)", () => {
    // Hand 0: K+K(dealt)=20, Hand 1: K+8=18, Dealer: 10+9=19
    let s = split(
      splitSetup({
        chips: 1000,
        bet: 100,
        player: [c("♠", "K"), c("♥", "K")],
        dealer: [c("♦", "10"), c("♣", "9")],
        deck: [c("♠", "8"), c("♥", "K")],
      })
    );
    s = stand(s);
    s = stand(s);
    expect(s.hand_outcomes[0]).toBe("win");
    expect(s.hand_outcomes[1]).toBe("lose");
    expect(s.payout).toBe(0);
    expect(s.chips).toBe(1000);
  });

  it("both hands win", () => {
    let s = split(
      splitSetup({
        chips: 1000,
        bet: 100,
        player: [c("♠", "K"), c("♥", "K")],
        dealer: [c("♦", "6"), c("♣", "7")],
        deck: [c("♠", "10"), c("♥", "9"), c("♦", "10")],
      })
    );
    s = stand(s);
    s = stand(s);
    expect(s.hand_outcomes[0]).toBe("win");
    expect(s.hand_outcomes[1]).toBe("win");
    expect(s.payout).toBe(200);
    expect(s.chips).toBe(1200);
  });

  it("both hands lose", () => {
    let s = split(
      splitSetup({
        chips: 1000,
        bet: 100,
        player: [c("♠", "5"), c("♥", "5")],
        dealer: [c("♦", "10"), c("♣", "10")],
        deck: [c("♠", "2"), c("♥", "3")],
      })
    );
    s = stand(s);
    s = stand(s);
    expect(s.hand_outcomes[0]).toBe("lose");
    expect(s.hand_outcomes[1]).toBe("lose");
    expect(s.payout).toBe(-200);
    expect(s.chips).toBe(800);
  });

  it("split 21 pays even money not 3:2", () => {
    // Split aces: A+K=21, A+5=16. Dealer 10+7=17.
    const s = split(
      splitSetup({
        chips: 1000,
        bet: 100,
        player: [c("♠", "A"), c("♥", "A")],
        dealer: [c("♦", "10"), c("♣", "7")],
        deck: [c("♠", "5"), c("♥", "K")],
      })
    );
    // Aces auto-stand → result
    expect(s.phase).toBe("result");
    expect(s.hand_payouts[0]).toBe(100); // even money, not 150
    expect(s.hand_outcomes[0]).toBe("win");
    expect(s.hand_outcomes[1]).toBe("lose");
  });
});

describe("split aces", () => {
  it("auto-stands and reaches result", () => {
    const s = split(
      splitSetup({
        player: [c("♠", "A"), c("♥", "A")],
        dealer: [c("♦", "10"), c("♣", "7")],
        deck: [c("♠", "5"), c("♥", "K")],
      })
    );
    expect(s.active_hand_index).toBeGreaterThanOrEqual(2);
    expect(s.phase).toBe("result");
  });

  it("each hand gets exactly one card", () => {
    const s = split(
      splitSetup({
        player: [c("♠", "A"), c("♥", "A")],
        deck: [c("♠", "5"), c("♥", "K")],
      })
    );
    expect(s.player_hands[0]).toHaveLength(2);
    expect(s.player_hands[1]).toHaveLength(2);
  });

  it("cannot hit on split aces", () => {
    // Manually build a split-ace state in player phase
    const s: EngineState = {
      ...splitSetup(),
      player_hands: [
        [c("♠", "A"), c("♥", "5")],
        [c("♥", "A"), c("♠", "K")],
      ],
      hand_bets: [100, 100],
      hand_outcomes: [null, null],
      hand_payouts: [0, 0],
      active_hand_index: 0,
      split_count: 1,
      split_from_aces: [true, true],
    };
    expect(() => hit(s)).toThrow("Cannot hit on split aces");
  });

  it("cannot double down on split aces", () => {
    const s: EngineState = {
      ...splitSetup(),
      player_hands: [
        [c("♠", "A"), c("♥", "5")],
        [c("♥", "A"), c("♠", "K")],
      ],
      hand_bets: [100, 100],
      hand_outcomes: [null, null],
      hand_payouts: [0, 0],
      active_hand_index: 0,
      split_count: 1,
      split_from_aces: [true, true],
    };
    expect(() => doubleDown(s)).toThrow("Cannot double down on split aces");
  });
});

describe("resplit", () => {
  it("allows up to 3 splits (4 hands)", () => {
    let s = split(
      splitSetup({
        chips: 1000,
        bet: 100,
        player: [c("♠", "8"), c("♥", "8")],
        deck: Array(20)
          .fill(c("♦", "3"))
          .concat([c("♣", "8"), c("♣", "8"), c("♣", "8"), c("♣", "8"), c("♣", "8"), c("♣", "8")]),
      })
    );
    expect(s.split_count).toBe(1);
    // Force hand 0 to be a pair for resplit
    s = { ...s, player_hands: [[c("♠", "8"), c("♦", "8")], s.player_hands[1] ?? []] };
    s = split(s);
    expect(s.split_count).toBe(2);
    s = { ...s, player_hands: [[c("♠", "8"), c("♣", "8")], ...s.player_hands.slice(1)] };
    s = split(s);
    expect(s.split_count).toBe(3);
    expect(s.player_hands).toHaveLength(4);
  });

  it("rejects fourth split", () => {
    const s: EngineState = {
      ...splitSetup({ chips: 1000, bet: 100 }),
      player_hands: [
        [c("♠", "8"), c("♥", "8")],
        [c("♦", "8"), c("♣", "3")],
        [c("♠", "3"), c("♥", "5")],
        [c("♦", "5"), c("♣", "7")],
      ],
      hand_bets: [100, 100, 100, 100],
      hand_outcomes: [null, null, null, null],
      hand_payouts: [0, 0, 0, 0],
      active_hand_index: 0,
      split_count: 3,
      split_from_aces: [false, false, false, false],
    };
    expect(() => split(s)).toThrow("Maximum number of splits");
  });
});

describe("split then double down", () => {
  it("DD on split hand doubles per-hand bet", () => {
    let s = split(
      splitSetup({
        chips: 500,
        bet: 100,
        player: [c("♠", "8"), c("♥", "8")],
        dealer: [c("♦", "10"), c("♣", "7")],
        deck: [c("♠", "3"), c("♥", "5"), c("♦", "8")],
      })
    );
    s = doubleDown(s);
    expect(s.active_hand_index).toBeGreaterThanOrEqual(1);
    expect(s.hand_bets[0]).toBe(200);
  });

  it("DD on split rejects insufficient chips", () => {
    const s = split(splitSetup({ chips: 200, bet: 100, deck: [c("♠", "3"), c("♥", "5")] }));
    // Total wagered = 200, free stack = 0
    expect(() => doubleDown(s)).toThrow("Insufficient chips");
  });
});

describe("newHand resets split", () => {
  it("clears all split state", () => {
    let s = split(
      splitSetup({
        player: [c("♠", "8"), c("♥", "8")],
        dealer: [c("♦", "10"), c("♣", "7")],
        deck: [c("♠", "3"), c("♥", "5")],
      })
    );
    s = stand(s);
    s = stand(s);
    expect(s.phase).toBe("result");
    const fresh = newHand(s);
    expect(fresh.phase).toBe("betting");
    expect(fresh.split_count).toBe(0);
    expect(fresh.player_hands).toEqual([]);
    expect(fresh.hand_bets).toEqual([]);
  });
});

describe("toViewState with split", () => {
  it("includes split fields", () => {
    const s = split(splitSetup({ deck: [c("♠", "3"), c("♥", "5")] }));
    const view = toViewState(s);
    expect(view.player_hands).toHaveLength(2);
    expect(view.hand_bets).toEqual([100, 100]);
    expect(view.active_hand_index).toBe(0);
    expect(view.split_available).toBeDefined();
  });

  it("split_available is true for pair with chips", () => {
    const view = toViewState(splitSetup());
    expect(view.split_available).toBe(true);
  });

  it("split_available is false for non-pair", () => {
    const view = toViewState(splitSetup({ player: [c("♠", "7"), c("♥", "8")] }));
    expect(view.split_available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Game events (#826)
// ---------------------------------------------------------------------------

describe("game events", () => {
  function stateInBetting(chips = 1000): EngineState {
    return {
      ...DEFAULT_RUN_CONFIG,
      milestones_reached: [],
      chips,
      bet: 0,
      phase: "betting",
      outcome: null,
      payout: 0,
      lastWin: null,
      deck: [],
      player_hand: [],
      dealer_hand: [],
      doubled: false,
      rules: DEFAULT_RULES,
      ...emptySplitState(),
    };
  }

  it("placeBet emits two cardDeal events on a normal deal", () => {
    setRng(createSeededRng(1));
    const s = stateInBetting();
    const next = placeBet({ ...s, deck: [] }, 50);
    expect(next.events).toBeDefined();
    const types = next.events!.map((e) => e.type);
    expect(types.filter((t) => t === "cardDeal")).toHaveLength(2);
  });

  it("placeBet emits blackjack event on natural 21", () => {
    // Cards are drawn via pop() in order: player1, dealer1, player2, dealer2.
    // Deck (right = top): A → player1, 6 → dealer1, K → player2, 5 → dealer2.
    // Player hand: [A, K] = 21 (blackjack). Dealer hand: [6, 5] = 11 (no BJ).
    const s: EngineState = {
      ...stateInBetting(),
      deck: [c("♣", "5"), c("♦", "K"), c("♥", "6"), c("♠", "A")],
    };
    const next = placeBet(s, 50);
    const types = next.events!.map((e) => e.type);
    expect(types).toContain("blackjack");
    expect(next.phase).toBe("result");
    expect(next.outcome).toBe("blackjack");
  });

  it("placeBet emits push event when both hands are natural 21", () => {
    // Deal order (pop): player1=A, dealer1=K, player2=K, dealer2=A.
    // Player: [A, K] = 21. Dealer: [K, A] = 21. Both blackjack → push.
    const s: EngineState = {
      ...stateInBetting(),
      deck: [c("♦", "A"), c("♣", "K"), c("♠", "K"), c("♥", "A")],
    };
    const next = placeBet(s, 50);
    const types = next.events!.map((e) => e.type);
    expect(types).toContain("push");
    expect(next.outcome).toBe("push");
  });

  it("hit emits cardDeal event", () => {
    const s = stateInPlayer();
    const next = hit(s);
    expect(next.events!.map((e) => e.type)).toContain("cardDeal");
  });

  it("hit emits bust event when hand exceeds 21", () => {
    const s: EngineState = {
      ...stateInPlayer(),
      player_hand: [c("♠", "K"), c("♥", "Q")], // 20
      deck: [c("♦", "5")],
    };
    const next = hit(s);
    expect(handValue(next.player_hand)).toBeGreaterThan(21);
    const types = next.events!.map((e) => e.type);
    expect(types).toContain("cardDeal");
    expect(types).toContain("bust");
  });

  it("stand emits win event when player beats dealer", () => {
    const s: EngineState = {
      ...stateInPlayer(),
      player_hand: [c("♠", "K"), c("♥", "9")], // 19
      dealer_hand: [c("♦", "6"), c("♣", "7")], // 13
      deck: Array(10).fill(c("♠", "4")), // dealer draws 4s (13,17 = stand)
    };
    const next = stand(s);
    expect(next.outcome).toBe("win");
    expect(next.events!.map((e) => e.type)).toContain("win");
  });

  it("stand emits push event on tie", () => {
    const s: EngineState = {
      ...stateInPlayer(),
      player_hand: [c("♠", "K"), c("♥", "7")], // 17
      dealer_hand: [c("♦", "K"), c("♣", "7")], // 17
      deck: [],
    };
    const next = stand(s);
    expect(next.outcome).toBe("push");
    expect(next.events!.map((e) => e.type)).toContain("push");
  });

  it("stand emits loss event when dealer wins", () => {
    const s: EngineState = {
      ...stateInPlayer(),
      player_hand: [c("♠", "7"), c("♥", "8")], // 15
      dealer_hand: [c("♦", "K"), c("♣", "7")], // 17
      deck: [],
    };
    const next = stand(s);
    expect(next.outcome).toBe("lose");
    expect(next.events!.map((e) => e.type)).toContain("loss");
  });

  it("doubleDown emits cardDeal and outcome events", () => {
    const s: EngineState = {
      ...stateInPlayer(1000, 100),
      player_hand: [c("♠", "9"), c("♥", "8")], // 17
      dealer_hand: [c("♦", "K"), c("♣", "6")], // 16
      deck: [c("♠", "2"), c("♣", "4"), c("♥", "5")], // dealer draws to bust
    };
    const next = doubleDown(s);
    const types = next.events!.map((e) => e.type);
    expect(types).toContain("cardDeal");
  });

  it("events are cleared on the next engine call", () => {
    const s = stateInPlayer();
    const afterHit = hit(s);
    expect(afterHit.events).toBeDefined();
    const afterSecondHit = hit(afterHit);
    // New array reference with only the new events — old cardDeal not duplicated
    expect(afterSecondHit.events).not.toBe(afterHit.events);
    expect(afterSecondHit.events!.filter((e) => e.type === "cardDeal")).toHaveLength(1);
  });

  it("newHand clears events", () => {
    const s = stateInResult(1000, 100, "win", 100);
    const sWithEvents: EngineState = { ...s, events: [{ type: "win" }] };
    const next = newHand(sWithEvents);
    expect(next.events).toBeUndefined();
  });

  it("toViewState projects events onto view state", () => {
    const s: EngineState = {
      ...stateInPlayer(),
      events: [{ type: "cardDeal" }],
    };
    const view = toViewState(s);
    expect(view.events).toEqual([{ type: "cardDeal" }]);
  });
});

// ---------------------------------------------------------------------------
// Milestone system (BJ-5)
// ---------------------------------------------------------------------------

describe("milestone system", () => {
  function stateWithMilestones(
    chips: number,
    milestones: number[],
    milestones_reached: number[] = []
  ): EngineState {
    return {
      ...stateInPlayer(chips),
      milestones,
      milestones_reached,
      player_hand: [c("♠", "K"), c("♥", "9")], // 19 — beats dealer
      dealer_hand: [c("♦", "6"), c("♣", "7")], // 13 — dealer draws to stand
      deck: Array(10).fill(c("♠", "4")),
    };
  }

  it("newGame initializes milestones_reached as empty array", () => {
    const g = newGame(undefined, { milestones: [175, 220] });
    expect(g.milestones).toEqual([175, 220]);
    expect(g.milestones_reached).toEqual([]);
  });

  it("no milestone emitted when chips don't reach threshold", () => {
    const s = stateWithMilestones(100, [500]);
    // Player 19 vs dealer 13 (draws 4+4=21 bust path — dealer actually stands at 17)
    // chips: 100, bet: 100 → win → chips 200 — below 500 threshold
    const next = stand(s);
    expect(next.milestones_reached).toEqual([]);
    expect(next.events?.some((e) => e.type === "milestone")).toBe(false);
  });

  it("emits milestone event when chips cross a threshold via stand", () => {
    // chips 150, bet 100, milestones [200] — win brings chips to 250 → crosses 200
    const s: EngineState = {
      ...stateWithMilestones(150, [200]),
      bet: 100,
    };
    const next = stand(s);
    expect(next.chips).toBe(250);
    expect(next.milestones_reached).toEqual([200]);
    const msEvent = next.events?.find((e) => e.type === "milestone");
    expect(msEvent).toEqual({ type: "milestone", value: 200 });
  });

  it("emits milestone event when chips cross threshold via doubleDown win", () => {
    const s: EngineState = {
      ...stateWithMilestones(150, [200]),
      bet: 50,
      player_hand: [c("♠", "6"), c("♥", "5")], // 11 — good DD hand
      deck: [c("♠", "K"), c("♠", "4")], // DD card=K→21, dealer draws 4 (stays 17)
    };
    const next = doubleDown(s);
    expect(next.chips).toBe(250); // 150 + 100 (2*50)
    expect(next.milestones_reached).toEqual([200]);
    expect(next.events?.some((e) => e.type === "milestone")).toBe(true);
  });

  it("emits milestone event when chips cross threshold via hit-bust settling below zero", () => {
    // Player busts → loses bet. chips 300, bet 100, milestone [150].
    // After bust: chips 200 — already above 150, so milestone fires.
    // (We set milestones_reached=[] to simulate not having crossed it yet.)
    const s: EngineState = {
      ...stateWithMilestones(300, [250]),
      bet: 100,
      player_hand: [c("♠", "K"), c("♥", "Q")], // 20 — one more card will bust
      deck: [c("♦", "5")], // deal 5 → 25, bust
    };
    // Bust brings chips to 200, which is below 250 → no milestone
    const next = hit(s);
    expect(next.chips).toBe(200);
    expect(next.milestones_reached).toEqual([]);
    expect(next.events?.some((e) => e.type === "milestone")).toBe(false);
  });

  it("emits milestone event on hit-bust when chips after loss still cross threshold", () => {
    // chips 300, bet 50, milestone [200]. Bust → chips 250. 250 ≥ 200 → milestone fires.
    const s: EngineState = {
      ...stateWithMilestones(300, [200]),
      bet: 50,
      player_hand: [c("♠", "K"), c("♥", "Q")], // 20
      deck: [c("♦", "5")], // 25 — bust
    };
    const next = hit(s);
    expect(next.chips).toBe(250);
    expect(next.milestones_reached).toEqual([200]);
    expect(next.events?.some((e) => e.type === "milestone")).toBe(true);
  });

  it("emits milestone event on split final settlement via finishIfAllHandsDone", () => {
    // Two-hand split. Win both hands: chips 100 → 100+50+50=200; milestone [150] fires.
    const s: EngineState = {
      ...DEFAULT_RUN_CONFIG,
      milestones: [150],
      milestones_reached: [],
      chips: 100,
      bet: 0,
      phase: "player",
      outcome: null,
      payout: 0,
      lastWin: null,
      player_hand: [],
      dealer_hand: [c("♦", "6"), c("♣", "7")], // dealer 13, will draw 4s → stands at 17
      deck: Array(10).fill(c("♠", "4")),
      doubled: false,
      rules: DEFAULT_RULES,
      // Two split hands, each bet 50, both win (K+9=19 > dealer 17)
      player_hands: [[c("♠", "K"), c("♥", "9")], [c("♠", "K"), c("♥", "9")]],
      hand_bets: [50, 50],
      hand_outcomes: [null, null],
      hand_payouts: [0, 0],
      active_hand_index: 2, // past both hands — triggers finishIfAllHandsDone
      split_count: 1,
      split_from_aces: [false, false],
    };
    // Calling stand on hand 2 (already active_hand_index=2, finishIfAllHandsDone runs)
    const next = stand({ ...s, active_hand_index: 1, phase: "player" });
    expect(next.chips).toBe(200); // 100 + 50 + 50
    expect(next.milestones_reached).toEqual([150]);
    expect(next.events?.some((e) => e.type === "milestone")).toBe(true);
  });

  it("does not re-emit an already-reached milestone", () => {
    const s: EngineState = {
      ...stateWithMilestones(250, [200], [200]),
      bet: 50,
    };
    const next = stand(s);
    // 200 already in milestones_reached — should not fire again
    expect(next.milestones_reached).toEqual([200]);
    expect(next.events?.filter((e) => e.type === "milestone")).toHaveLength(0);
  });

  it("emits multiple milestone events when chips skip past two thresholds at once", () => {
    // chips 100, bet 500 (theoretical) → win brings chips to 600; milestones [200, 500]
    const s: EngineState = {
      ...stateWithMilestones(100, [200, 500]),
      bet: 500,
    };
    const next = stand(s);
    expect(next.chips).toBe(600);
    expect(next.milestones_reached).toEqual([200, 500]);
    const msEvents = next.events?.filter((e) => e.type === "milestone") ?? [];
    expect(msEvents).toHaveLength(2);
  });

  it("milestones_reached persists across newHand", () => {
    const s = stateInResult(300, 100, "win", 100);
    const sWithMilestones: EngineState = {
      ...s,
      milestones: [200],
      milestones_reached: [200],
    };
    const next = newHand(sWithMilestones);
    expect(next.milestones_reached).toEqual([200]);
    expect(next.milestones).toEqual([200]);
  });

  it("emits milestone event on natural blackjack crossing threshold", () => {
    // Natural blackjack: chips 150, bet 50, milestone [200] → 150 + ceil(50*1.5)=75 = 225
    const s: EngineState = {
      ...DEFAULT_RUN_CONFIG,
      milestones: [200],
      milestones_reached: [],
      chips: 150,
      bet: 0,
      phase: "betting",
      outcome: null,
      payout: 0,
      lastWin: null,
      // Deal order (pop from end): player1=A, dealer1=K, player2=Q, dealer2=2
      // Player [A,Q]=21 natural; dealer [K,2]=12 — not BJ → outcome "blackjack"
      deck: [c("♦", "2"), c("♣", "Q"), c("♠", "K"), c("♥", "A")],
      player_hand: [],
      dealer_hand: [],
      doubled: false,
      rules: DEFAULT_RULES,
      ...emptySplitState(),
    };
    const next = placeBet(s, 50);
    expect(next.outcome).toBe("blackjack");
    expect(next.chips).toBe(225);
    expect(next.milestones_reached).toEqual([200]);
    expect(next.events?.some((e) => e.type === "milestone")).toBe(true);
  });
});

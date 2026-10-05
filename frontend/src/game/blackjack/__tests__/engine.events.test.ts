/**
 * Tests for the client-side Blackjack engine: round events (`events`, all-in, comeback) and the
 * milestone system.
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
  newHand,
  handValue,
  toViewState,
  setRng,
  createSeededRng,
  EngineState,
  DEFAULT_RULES,
  DEFAULT_RUN_CONFIG,
} from "../engine";
import { c, emptySplitState, stateInPlayer, stateInResult } from "./helpers/engineFixtures";

// ---------------------------------------------------------------------------
// Game events (#826)
// ---------------------------------------------------------------------------

describe("game events", () => {
  function stateInBetting(chips = 1000): EngineState {
    return {
      ...DEFAULT_RUN_CONFIG,
      milestones_reached: [],
      hitLowChips: false,
      comebackEmitted: false,
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
// allIn event (BJ-7)
// ---------------------------------------------------------------------------

describe("allIn event", () => {
  function bettingState(chips: number): EngineState {
    return {
      ...DEFAULT_RUN_CONFIG,
      milestones_reached: [],
      hitLowChips: false,
      comebackEmitted: false,
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

  it("emits allIn when bet equals chips", () => {
    setRng(createSeededRng(42));
    const next = placeBet(bettingState(200), 200);
    expect(next.events?.some((e) => e.type === "allIn")).toBe(true);
  });

  it("does not emit allIn when bet is less than chips", () => {
    setRng(createSeededRng(42));
    const next = placeBet(bettingState(1000), 100);
    expect(next.events?.some((e) => e.type === "allIn")).toBe(false);
  });

  it("allIn appears before cardDeal events", () => {
    setRng(createSeededRng(1));
    const next = placeBet(bettingState(100), 100);
    const types = next.events!.map((e) => e.type);
    const allInIdx = types.indexOf("allIn");
    const firstCardDealIdx = types.indexOf("cardDeal");
    expect(allInIdx).toBeGreaterThanOrEqual(0);
    expect(allInIdx).toBeLessThan(firstCardDealIdx);
  });
});

// ---------------------------------------------------------------------------
// Comeback event (BJ-7)
// ---------------------------------------------------------------------------

describe("comeback event", () => {
  it("emits comeback when chips cross from below 25% to above 75%", () => {
    // startingChips=1000, so 75% = 750. Chips 400, bet 400 → win → chips 800 ≥ 750.
    const s: EngineState = {
      ...stateInPlayer(400, 400),
      startingChips: 1000,
      hitLowChips: true,
      comebackEmitted: false,
      player_hand: [c("♠", "K"), c("♥", "9")], // 19
      dealer_hand: [c("♦", "6"), c("♣", "7")], // dealer draws to 21 or bust
      deck: Array(10).fill(c("♠", "4")), // dealer: 13 → draws 4 → 17, stands
    };
    const next = stand(s);
    expect(next.chips).toBe(800);
    expect(next.events?.some((e) => e.type === "comeback")).toBe(true);
    expect(next.comebackEmitted).toBe(true);
  });

  it("does not emit comeback when hitLowChips is false", () => {
    const s: EngineState = {
      ...stateInPlayer(400, 400),
      startingChips: 1000,
      hitLowChips: false,
      comebackEmitted: false,
      player_hand: [c("♠", "K"), c("♥", "9")],
      dealer_hand: [c("♦", "6"), c("♣", "7")],
      deck: Array(10).fill(c("♠", "4")),
    };
    const next = stand(s);
    expect(next.events?.some((e) => e.type === "comeback")).toBe(false);
  });

  it("does not re-emit comeback when already emitted", () => {
    const s: EngineState = {
      ...stateInPlayer(400, 400),
      startingChips: 1000,
      hitLowChips: true,
      comebackEmitted: true,
      player_hand: [c("♠", "K"), c("♥", "9")],
      dealer_hand: [c("♦", "6"), c("♣", "7")],
      deck: Array(10).fill(c("♠", "4")),
    };
    const next = stand(s);
    expect(next.events?.some((e) => e.type === "comeback")).toBe(false);
  });

  it("sets hitLowChips when chips fall below 25% of starting", () => {
    // startingChips=1000, bet=400, chips=300 → lose → chips=0 (below 25%)
    const s: EngineState = {
      ...stateInPlayer(300, 300),
      startingChips: 1000,
      hitLowChips: false,
      comebackEmitted: false,
      player_hand: [c("♠", "7"), c("♥", "8")], // 15
      dealer_hand: [c("♦", "K"), c("♣", "7")], // 17 — dealer wins
      deck: [],
    };
    const next = stand(s);
    expect(next.hitLowChips).toBe(true);
  });

  it("hitLowChips persists across newHand", () => {
    const s = stateInResult(200, 100, "win", 100);
    const sLow: EngineState = { ...s, hitLowChips: true, comebackEmitted: false };
    const next = newHand(sLow);
    expect(next.hitLowChips).toBe(true);
  });

  it("does not emit comeback on hit-bust path even when hitLowChips is true", () => {
    // chips=800 (above 75% threshold), hitLowChips=true — bust reduces chips, can't trigger comeback
    const s: EngineState = {
      ...stateInPlayer(800, 100),
      startingChips: 1000,
      hitLowChips: true,
      comebackEmitted: false,
      player_hand: [c("♠", "K"), c("♥", "Q")], // 20
      deck: [c("♦", "5")], // 25 — bust
    };
    const next = hit(s);
    expect(next.outcome).toBe("lose");
    expect(next.events?.some((e) => e.type === "comeback")).toBe(false);
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
      hitLowChips: false,
      comebackEmitted: false,
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
      player_hands: [
        [c("♠", "K"), c("♥", "9")],
        [c("♠", "K"), c("♥", "9")],
      ],
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
      hitLowChips: false,
      comebackEmitted: false,
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

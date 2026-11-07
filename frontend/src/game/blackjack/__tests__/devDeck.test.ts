import {
  DEFAULT_RULES,
  doubleDown,
  handValue,
  hit,
  newGame,
  placeBet,
  split,
  stand,
  type Card,
  type EngineState,
} from "../engine";
import { BLACKJACK_DEV_PRESETS, stackDeck } from "../devDeck";

const c = (rank: string, suit: string): Card => ({ rank, suit });

function preset(label: string): readonly Card[] {
  const p = BLACKJACK_DEV_PRESETS.find((x) => x.label === label);
  if (!p) throw new Error(`no preset ${label}`);
  return p.cards;
}

/** A betting-phase game with the preset's cards on top of the deck. */
function stacked(label: string, extra?: Partial<EngineState>): EngineState {
  const base = newGame(undefined, { startingChips: 1000, betMin: 5, betMax: 500 });
  return { ...stackDeck(base, preset(label)), ...extra };
}

describe("stackDeck (#3576)", () => {
  it("deals the stacked cards first, in order, through placeBet and hit", () => {
    const base = newGame();
    const s = stackDeck(base, [c("2", "♠"), c("3", "♥"), c("4", "♦"), c("5", "♣"), c("6", "♠")]);
    const dealt = placeBet(s, 10);
    expect(dealt.player_hand).toEqual([c("2", "♠"), c("4", "♦")]);
    expect(dealt.dealer_hand).toEqual([c("3", "♥"), c("5", "♣")]);
    expect(hit(dealt).player_hand[2]).toEqual(c("6", "♠"));
  });

  it("dealer draws continue from the stack after stand", () => {
    // Player 10,9; dealer 2,3 then draws 2,3,2,K.
    const dealt = placeBet(stacked("Dealer draws 4 and busts"), 10);
    const done = stand(dealt);
    expect(done.dealer_hand.map((x) => x.rank)).toEqual(["2", "3", "2", "3", "2", "K"]);
  });

  it("removes one copy of each stacked card from a single-deck rest", () => {
    const base = newGame(undefined, { rules: { ...DEFAULT_RULES, deck_count: 1 } });
    expect(base.deck).toHaveLength(52);
    const s = stackDeck(base, [c("A", "♠"), c("K", "♥")]);
    expect(s.deck).toHaveLength(52);
    expect(s.deck.filter((x) => x.rank === "A" && x.suit === "♠")).toHaveLength(1);
  });

  it("does not mutate the input state", () => {
    const base = newGame();
    const before = [...base.deck];
    stackDeck(base, [c("A", "♠")]);
    expect(base.deck).toEqual(before);
  });

  it("puts the stack first even when the deck is empty, then the engine reshuffles", () => {
    const base: EngineState = { ...newGame(), deck: [] };
    const s = stackDeck(base, [c("2", "♠"), c("3", "♥"), c("4", "♦"), c("5", "♣")]);
    expect(s.deck).toHaveLength(4);
    const dealt = placeBet(s, 10);
    expect(dealt.player_hand).toEqual([c("2", "♠"), c("4", "♦")]);
    expect(dealt.dealer_hand).toEqual([c("3", "♥"), c("5", "♣")]);
    // Next card comes from the engine's fresh deck rather than throwing.
    expect(hit(dealt).player_hand).toHaveLength(3);
  });
});

describe("Blackjack dev presets (#3576)", () => {
  it("Pair to split: 8,8 vs 6, splits into 8+3 and 8+K", () => {
    const dealt = placeBet(stacked("Pair to split"), 10);
    expect(dealt.player_hand.map((x) => x.rank)).toEqual(["8", "8"]);
    expect(dealt.dealer_hand[1]!.rank).toBe("6");
    const sp = split(dealt);
    expect(sp.player_hands.map((h) => h.map((x) => x.rank))).toEqual([
      ["8", "3"],
      ["8", "K"],
    ]);
  });

  it("Pair ×4 split: reaches four hands through three splits", () => {
    let s = placeBet(stacked("Pair ×4 split"), 10);
    s = split(s);
    s = split(s);
    s = split(s);
    expect(s.player_hands).toHaveLength(4);
    expect(s.split_count).toBe(3);
    expect(s.player_hands.map((h) => h.map((x) => x.rank).join(","))).toEqual([
      "8,3",
      "8,4",
      "8,2",
      "8,5",
    ]);
  });

  it("6-card 21: player ends with 6 cards totalling 21", () => {
    let s = placeBet(stacked("6-card 21"), 10);
    for (let i = 0; i < 4; i++) s = hit(s);
    expect(s.phase).toBe("player");
    expect(s.player_hand).toHaveLength(6);
    expect(handValue(s.player_hand)).toBe(21);
    expect(stand(s).outcome).toBe("win");
  });

  it("Player natural: settles as blackjack at the deal", () => {
    const s = placeBet(stacked("Player natural"), 10);
    expect(s.phase).toBe("result");
    expect(s.outcome).toBe("blackjack");
  });

  it("Dealer natural: dealer holds 21 in two cards and beats 19", () => {
    const dealt = placeBet(stacked("Dealer natural"), 10);
    expect(handValue(dealt.dealer_hand)).toBe(21);
    expect(handValue(dealt.player_hand)).toBe(19);
    expect(stand(dealt).outcome).toBe("lose");
  });

  it("Dealer draws 4 and busts: dealer ends over 21 after four draws", () => {
    const done = stand(placeBet(stacked("Dealer draws 4 and busts"), 10));
    expect(done.dealer_hand).toHaveLength(6);
    expect(handValue(done.dealer_hand)).toBeGreaterThan(21);
    expect(done.outcome).toBe("win");
  });

  it("Push: both hands total 19", () => {
    const done = stand(placeBet(stacked("Push"), 10));
    expect(done.outcome).toBe("push");
  });

  it("Soft 17: dealer shows soft 17 and draws a 4 when it hits soft 17", () => {
    const rules = { ...DEFAULT_RULES, hit_soft_17: true };
    const dealt = placeBet(stacked("Soft 17", { rules }), 10);
    expect(handValue(dealt.dealer_hand)).toBe(17);
    const done = stand(dealt);
    expect(handValue(done.dealer_hand)).toBe(21);
    expect(done.dealer_hand).toHaveLength(3);
    // Stands on soft 17 under the default rule.
    const stands = stand(placeBet(stacked("Soft 17"), 10));
    expect(stands.dealer_hand).toHaveLength(2);
  });

  it("Ace pair: A,A splits into A+K and A+5", () => {
    const s = split(placeBet(stacked("Ace pair"), 10));
    expect(s.player_hands.map((h) => h.map((x) => x.rank))).toEqual([
      ["A", "K"],
      ["A", "5"],
    ]);
  });

  it("every preset deals without error", () => {
    for (const p of BLACKJACK_DEV_PRESETS) {
      expect(() => placeBet(stacked(p.label), 10)).not.toThrow();
    }
  });

  it("double down continues from the stack", () => {
    const dealt = placeBet(stacked("Pair to split"), 10);
    expect(doubleDown(dealt).player_hand[2]).toEqual(c("3", "♠"));
  });
});

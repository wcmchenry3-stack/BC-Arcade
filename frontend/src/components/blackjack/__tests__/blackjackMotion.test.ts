/**
 * #3581: Blackjack's motion planner. The timelines it plans from the engine's settled states (the
 * owner-approved order and timings), what the felt draws at each stage, the cards' ids, and a
 * seeded fuzz over random rounds (splits and resplits included) that checks every timeline's
 * invariants: it ends on the settled round, never hides or un-deals a card, deals each new card
 * once with one sound, turns the hole card before any draw, and sounds one result after the last
 * card lands.
 */
import {
  doubleDown,
  handValue,
  hit,
  isNaturalBlackjack,
  newGame,
  newHand,
  placeBet,
  split,
  stand,
  toViewState,
  type Card,
  type EngineState,
} from "../../../game/blackjack/engine";
import { createSeededRng } from "../../../game/_shared/seededRng";
import { savedAgainstNatural } from "../../../game/blackjack/__tests__/helpers/engineFixtures";
import type { BlackjackState } from "../../../game/blackjack/types";
import { cubicBezier } from "../../cards/cardMotion";
import {
  ACTIVATE_DEAL_MS,
  assignCardIds,
  CHIP_DELAY_MS,
  DEAL_FLIGHT_MS,
  DEALER_PACE_MS,
  FLIP_MS,
  fullStage,
  NATURAL_AT_MS,
  naturalEdges,
  NO_NATURALS,
  planMotion,
  RESULT_CUES,
  RESULT_DELAY_MS,
  SPLIT_DEAL_MS,
  stageView,
  withHeld,
  type CardIds,
  type Timeline,
} from "../blackjackMotion";

const c = (rank: string, suit = "♠"): Card => ({ rank, suit });
/** A deck dealt in this order (the engine deals from the end), then 2♣s. */
const deck = (...order: Card[]): Card[] => [
  ...Array.from({ length: 60 }, () => c("2", "♣")),
  ...[...order].reverse(),
];
const betting = (...order: Card[]) =>
  newGame(deck(...order), { startingChips: 100, runGoal: null, betMin: 5, betMax: 25 });
const view = toViewState;
const cuesOf = (t: Timeline) => t.cues.map((q) => [q.sound, q.at] as const);

describe("planMotion", () => {
  it("the opening deal: player, hole (face down), player, dealer up, 180 ms apart", () => {
    const s0 = betting(c("10"), c("7", "♣"), c("5", "♥"), c("9", "♥"));
    const s1 = placeBet(s0, 10);
    const t = planMotion(view(s0), view(s1))!;
    expect(cuesOf(t)).toEqual([
      ["deal", 0],
      ["deal", 180],
      ["deal", 360],
      ["deal", 540],
    ]);
    // [at, player cards shown, dealer cards shown, hole down, player cards counted, dealer counted]:
    // a card shows at its launch and counts in its hand's total as it lands, 240 ms later.
    const row = (f: Timeline["frames"][number]) => [
      f.at,
      f.stage.hands[0],
      f.stage.dealer,
      f.stage.holeDown,
      f.stage.counted[0],
      f.stage.dealerCounted,
    ];
    expect(t.frames.map(row)).toEqual([
      [0, 1, 0, true, 0, 0],
      [180, 1, 1, true, 0, 0],
      [240, 1, 1, true, 1, 0],
      [360, 2, 1, true, 1, 0],
      [420, 2, 1, true, 1, 1],
      [540, 2, 2, true, 1, 1],
      [600, 2, 2, true, 2, 1],
      [780, 2, 2, true, 2, 2],
    ]);
    expect(t.resultAt).toBeNull();
    expect(t.flips).toBe(false);
  });

  it("a Stand: the flip first, draws 600 ms apart, the result 300 ms after the last landing", () => {
    const s0 = placeBet(betting(c("10"), c("10", "♣"), c("9", "♥"), c("4", "♦")), 10);
    const s1 = stand(s0);
    const t = planMotion(view(s0), view(s1))!;
    const r = 2 * DEALER_PACE_MS + DEAL_FLIGHT_MS + RESULT_DELAY_MS;
    expect(t.resultAt).toBe(r);
    expect(cuesOf(t)).toEqual([
      ["flip", 0],
      ["deal", 600],
      ["deal", 1200],
      ["win", r],
      ["payout", r + CHIP_DELAY_MS],
    ]);
    expect(t.flips).toBe(true);
    // The settled round is the last stage.
    expect(t.frames[t.frames.length - 1]!.stage).toEqual(fullStage(view(s1)));
  });

  it("a dealer who stands at once: the result 300 ms after the flip ends", () => {
    const s0 = placeBet(betting(c("10"), c("10", "♣"), c("9", "♥"), c("8", "♦")), 10);
    const t = planMotion(view(s0), view(stand(s0)))!;
    expect(t.resultAt).toBe(FLIP_MS + RESULT_DELAY_MS);
    expect(cuesOf(t)).toEqual([
      ["flip", 0],
      ["win", 620],
      ["payout", 1040],
    ]);
  });

  it("a bust is its own chime, after the hole card turns", () => {
    const s0 = placeBet(betting(c("10"), c("7", "♣"), c("6", "♥"), c("9", "♥"), c("K", "♦")), 10);
    const t = planMotion(view(s0), view(hit(s0)))!;
    expect(cuesOf(t)).toEqual([
      ["deal", 0],
      ["flip", 240],
      ["bust", 860],
      ["collect", 1280],
    ]);
  });

  it("a double: one card, then the dealer's turn as it lands", () => {
    const s0 = placeBet(betting(c("6"), c("10", "♣"), c("5", "♥"), c("8", "♦"), c("K", "♦")), 10);
    const t = planMotion(view(s0), view(doubleDown(s0)))!;
    expect(cuesOf(t)).toEqual([
      ["deal", 0],
      ["flip", 240],
      ["win", 860],
      ["payout", 1280],
    ]);
  });

  // Owner decision (#3720, as the mockup): only the hand to play is dealt its second card (~720 ms);
  // the new hand's waits for its turn, then is dealt ~350 ms after it is outlined.
  it("a split: the slide, the second stake at 300 ms, then each hand's card on its turn", () => {
    const s0 = placeBet(
      betting(c("8"), c("10", "♣"), c("8", "♥"), c("7", "♦"), c("10", "♦"), c("5", "♣")),
      10
    );
    const s1 = split(s0);
    const t = planMotion(view(s0), view(s1))!;
    expect(t.slideMs).toBe(300);
    expect(t.frames[0]!.stage.hands).toEqual([1, 1]);
    expect(cuesOf(t)).toEqual([
      ["chipBet", 300],
      ["deal", 720],
    ]);
    // Hand 2 holds its second card back: it shows one card.
    expect(t.held).toEqual([0, 1]);
    expect(t.frames[t.frames.length - 1]!.stage.hands).toEqual([2, 1]);
    // Hand 1 stands: hand 2 is outlined at once and dealt its card 350 ms later.
    const s2 = stand(s1);
    const t2 = planMotion(view(s1), view(s2), t.held)!;
    expect(cuesOf(t2)).toEqual([["deal", 350]]);
    expect(t2.held).toEqual([0, 0]);
    expect(t2.frames[t2.frames.length - 1]!.stage.hands).toEqual([2, 2]);
    // The second stand plays the dealer, one net chime, then hand by hand.
    const s3 = stand(s2);
    const end = planMotion(view(s2), view(s3), t2.held)!;
    expect(cuesOf(end)).toEqual([
      ["flip", 0],
      ["push", 620],
      ["payout", 1040],
      ["collect", 1340],
    ]);
    const revealed = end.frames.map((f) => [f.at, f.stage.revealed]);
    expect(revealed).toEqual(
      expect.arrayContaining([
        [620, 0],
        [1040, 1],
        [1340, 2],
      ])
    );
  });

  it("split aces, played out at once, are each dealt their card in hand order", () => {
    const s0 = placeBet(
      betting(c("A"), c("10", "♣"), c("A", "♥"), c("7", "♦"), c("5", "♦"), c("6", "♣")),
      10
    );
    const s1 = split(s0);
    expect(s1.phase).not.toBe("player");
    const t = planMotion(view(s0), view(s1))!;
    expect(cuesOf(t).slice(0, 3)).toEqual([
      ["chipBet", 300],
      ["deal", 720],
      ["deal", 900],
    ]);
    expect(t.held).toEqual([0, 0]);
  });

  // #3764: 21 stands on its own. The hit's card lands, then the dealer's turn runs on the same
  // clock, with no tap between: the same timeline as a hit and then a Stand.
  it("a hit to 21: the card lands, then the dealer's turn runs straight through", () => {
    // 7+4 hits a 10 (21); dealer 10+6 draws a 2 (18).
    const s0 = placeBet(
      betting(c("7"), c("10", "♣"), c("4", "♥"), c("6", "♦"), c("10", "♦"), c("2", "♥")),
      10
    );
    expect(s0.phase).toBe("player");
    const s1 = hit(s0);
    expect(s1.phase).toBe("result");
    const t = planMotion(view(s0), view(s1))!;
    const flip = DEAL_FLIGHT_MS;
    const r = flip + DEALER_PACE_MS + DEAL_FLIGHT_MS + RESULT_DELAY_MS;
    expect(t.resultAt).toBe(r);
    expect(cuesOf(t)).toEqual([
      ["deal", 0],
      ["flip", flip],
      ["deal", flip + DEALER_PACE_MS],
      ["win", r],
      ["payout", r + CHIP_DELAY_MS],
    ]);
    expect(t.flips).toBe(true);
    // No stage between the hit and the result outlines a hand to play with 21 showing: the hand
    // is outlined until the hole card turns, while its 21 is still landing.
    const turned = t.frames.find((f) => !f.stage.holeDown)!;
    expect(turned.at).toBe(flip);
    expect(turned.stage.active).toBeNull();
    t.frames
      .filter((f) => f.stage.active !== null)
      .forEach((f) => expect(f.stage.counted[0]).toBeLessThan(3));
    expect(t.frames[t.frames.length - 1]!.stage).toEqual(fullStage(view(s1)));
  });

  it("a split hand dealt 21 is passed over: its held card is dealt on the way to the next hand", () => {
    // 10s split: hand 1 10+10, hand 2 10+7 (held). Hand 1 split again: 10+5, 10+A (held), 10+7.
    const s0 = placeBet(
      betting(
        c("10"),
        c("6", "♣"),
        c("10", "♥"),
        c("9", "♦"),
        c("10", "♦"),
        c("7", "♣"),
        c("5", "♥"),
        c("A", "♥")
      ),
      10
    );
    const s1 = split(s0);
    const t1 = planMotion(view(s0), view(s1))!;
    const s2 = split(s1);
    expect(s2.player_hands.map((h) => h.length)).toEqual([2, 2, 2]);
    const t2 = planMotion(view(s1), view(s2), t1.held)!;
    expect(t2.held).toEqual([0, 1, 1]);
    // Stand on 15: hand 2 (21) stands on its own, hand 3 is the one to play.
    const s3 = stand(s2);
    expect(s3.active_hand_index).toBe(2);
    const t3 = planMotion(view(s2), view(s3), t2.held)!;
    // Hand 2 is outlined and dealt its Ace, then hand 3 is outlined and dealt its 7.
    expect(cuesOf(t3)).toEqual([
      ["deal", 350],
      ["deal", 350 + DEAL_FLIGHT_MS + 350],
    ]);
    expect(t3.held).toEqual([0, 0, 0]);
    expect(t3.frames[t3.frames.length - 1]!.stage.hands).toEqual([2, 2, 2]);
    expect(t3.frames.map((f) => f.stage.active)).toEqual(expect.arrayContaining([1, 2]));
  });

  // #3764 review (the owner's recording, case 5): a split that leaves the hand to play on 21 moves
  // the outline off it as its card lands; the next hand gets its activation beat, then its card.
  it("a split hand dealt 21: the outline moves on as the 21 lands, then the next hand's card", () => {
    // 10♠ 10♦ against 9♣ (hole) 7♥: hand 1 gets A♣ (21), hand 2 gets 7♠ (held).
    const s0 = placeBet(
      betting(c("10"), c("9", "♣"), c("10", "♦"), c("7", "♥"), c("A", "♣"), c("7")),
      10
    );
    const s1 = split(s0);
    expect(s1.active_hand_index).toBe(1);
    const t = planMotion(view(s0), view(s1))!;
    const aceLands = SPLIT_DEAL_MS + DEAL_FLIGHT_MS;
    expect(cuesOf(t)).toEqual([
      ["chipBet", 300],
      ["deal", SPLIT_DEAL_MS],
      ["deal", aceLands + ACTIVATE_DEAL_MS],
    ]);
    const row = (at: number) => t.frames.filter((f) => f.at <= at).pop()!.stage;
    // Hand 1 is outlined until its Ace lands; then hand 2, as the 21 counts.
    expect(row(aceLands - 1).active).toBe(0);
    expect(row(aceLands - 1).counted[0]).toBe(1);
    expect(row(aceLands).active).toBe(1);
    expect(row(aceLands).counted[0]).toBe(2);
    expect(row(aceLands).hands[1]).toBe(1);
    // No stage outlines hand 1 with its 21 counted.
    t.frames.forEach((f) => {
      if (f.stage.active === 0) expect(f.stage.counted[0]).toBeLessThan(2);
    });
    expect(t.held).toEqual([0, 0]);
    expect(t.frames[t.frames.length - 1]!.stage.hands).toEqual([2, 2]);
  });

  it("a Stand that passes a held hand dealt 21 to end the round: that hand is outlined and dealt first, then the flip", () => {
    // 10s split: hand 1 10+5, hand 2 10+A (held). Stand on 15: hand 2 stands on its own, the dealer plays.
    const s0 = placeBet(
      betting(c("10"), c("6", "♣"), c("10", "♥"), c("9", "♦"), c("5", "♦"), c("A", "♣"), c("2")),
      10
    );
    const s1 = split(s0);
    const t1 = planMotion(view(s0), view(s1))!;
    expect(t1.held).toEqual([0, 1]);
    const s2 = stand(s1);
    expect(s2.phase).toBe("result");
    const t = planMotion(view(s1), view(s2), t1.held)!;
    const aceLands = ACTIVATE_DEAL_MS + DEAL_FLIGHT_MS;
    expect(cuesOf(t).slice(0, 3)).toEqual([
      ["deal", ACTIVATE_DEAL_MS],
      ["flip", aceLands],
      ["deal", aceLands + DEALER_PACE_MS],
    ]);
    // The Ace is dealt with hand 2 outlined, never with hand 1.
    const dealt = t.frames.find((f) => f.stage.hands[1] === 2)!;
    expect(dealt.at).toBe(ACTIVATE_DEAL_MS);
    expect(dealt.stage.active).toBe(1);
    expect(t.frames[0]!.stage.active).toBe(1);
  });

  it("a new hand's betting has no motion", () => {
    const s0 = stand(placeBet(betting(c("10"), c("7", "♣"), c("5", "♥"), c("9", "♥")), 10));
    expect(planMotion(view(s0), view(newHand(s0)))).toBeNull();
  });
});

// #3621 (owner decisions, #3739): the natural's moment, its sting and the naturals' edges.
describe("the natural", () => {
  /** [at, player edge, dealer edge] at each stage where an edge changes. */
  const edges = (t: Timeline) =>
    t.frames
      .filter(
        (f, i) =>
          i === 0 ||
          f.stage.natural.player !== t.frames[i - 1]!.stage.natural.player ||
          f.stage.natural.dealer !== t.frames[i - 1]!.stage.natural.dealer
      )
      .map((f) => [f.at, f.stage.natural.player, f.stage.natural.dealer]);

  it("a player's natural: the sting as the second card lands, the result at the flip's end", () => {
    const s0 = betting(c("A"), c("7", "♣"), c("K", "♥"), c("9", "♥"));
    const s1 = placeBet(s0, 10);
    expect(s1.outcome).toBe("blackjack");
    const t = planMotion(view(s0), view(s1))!;
    expect(cuesOf(t)).toEqual([
      ["deal", 0],
      ["deal", 180],
      ["deal", 360],
      ["deal", 540],
      ["blackjack", NATURAL_AT_MS],
      ["flip", 780],
      ["payout", 780 + FLIP_MS + CHIP_DELAY_MS],
    ]);
    expect(NATURAL_AT_MS).toBe(600);
    // No +300 ms: the banner shows as the hole card's turn ends; no second chime there.
    expect(t.resultAt).toBe(780 + FLIP_MS);
    expect(t.chimeAt).toBe(NATURAL_AT_MS);
    expect(t.momentAt).toBe(NATURAL_AT_MS);
    expect(edges(t)).toEqual([
      [0, false, false],
      [600, true, false],
    ]);
    // The 3:2 payout chip is the larger one.
    const chips = t.frames.flatMap((f) => f.stage.chips);
    expect(chips.length).toBeGreaterThan(0);
    chips.forEach((chip) => expect(chip).toMatchObject({ kind: "payout", natural: true }));
  });

  it("the dealer's natural, found by the peek (#3741): the deal, the flip at once, a silver edge as it turns, then the loss", () => {
    const s0 = betting(c("10"), c("K", "♣"), c("8", "♥"), c("A", "♦"));
    const s1 = placeBet(s0, 10);
    expect(s1.phase).toBe("result");
    expect(s1.outcome).toBe("lose");
    const t = planMotion(view(s0), view(s1))!;
    // The hole card turns as the up card lands (780 ms), then the result 300 ms after the turn.
    const flipAt = 3 * 180 + DEAL_FLIGHT_MS;
    expect(cuesOf(t)).toEqual([
      ["deal", 0],
      ["deal", 180],
      ["deal", 360],
      ["deal", 540],
      ["flip", flipAt],
      ["lose", flipAt + FLIP_MS + RESULT_DELAY_MS],
      ["collect", flipAt + FLIP_MS + RESULT_DELAY_MS + CHIP_DELAY_MS],
    ]);
    expect(t.flips).toBe(true);
    expect(t.resultAt).toBe(flipAt + FLIP_MS + RESULT_DELAY_MS);
    expect(t.chimeAt).toBe(t.resultAt);
    expect(t.momentAt).toBeNull();
    expect(edges(t)).toEqual([
      [0, false, false],
      [flipAt + FLIP_MS, false, true],
    ]);
    t.frames.flatMap((f) => f.stage.chips).forEach((chip) => expect(chip.natural).toBeUndefined());
    // Only the original bet is swept: one collect chip, for the one hand.
    expect(t.cues.filter((q) => q.sound === "collect")).toHaveLength(1);
    expect(s1.payout).toBe(-10);
  });

  it("the dealer's natural with the ace in the hole and a ten up is peeked the same way", () => {
    const s0 = betting(c("10"), c("A", "♣"), c("8", "♥"), c("Q", "♦"));
    const s1 = placeBet(s0, 10);
    expect(s1.outcome).toBe("lose");
    const t = planMotion(view(s0), view(s1))!;
    expect(t.cues.find((q) => q.sound === "flip")?.at).toBe(3 * 180 + DEAL_FLIGHT_MS);
    expect(naturalEdges(view(s1))).toEqual({ player: false, dealer: true });
  });

  it("natural against natural: the gold edge only (no sting), the silver at the flip, then the push", () => {
    const s0 = betting(c("A"), c("A", "♣"), c("K", "♥"), c("K", "♦"));
    const s1 = placeBet(s0, 10);
    expect(s1.outcome).toBe("push");
    const t = planMotion(view(s0), view(s1))!;
    expect(cuesOf(t)).toEqual([
      ["deal", 0],
      ["deal", 180],
      ["deal", 360],
      ["deal", 540],
      ["flip", 780],
      ["push", 1100],
      ["nudge", 1100 + CHIP_DELAY_MS],
    ]);
    expect(t.resultAt).toBe(1100);
    expect(t.chimeAt).toBe(1100);
    expect(t.momentAt).toBeNull();
    expect(edges(t)).toEqual([
      [0, false, false],
      [600, true, false],
      [1100, true, true],
    ]);
  });

  it("a split hand's ace and ten is not a natural (it pays 1:1): no edge, no sting", () => {
    const s0 = placeBet(
      betting(c("A"), c("7", "♣"), c("A", "♥"), c("9", "♦"), c("K", "♦"), c("5", "♣")),
      10
    );
    const s1 = split(s0);
    expect(s1.player_hands[0]!.map((x) => x.rank)).toEqual(["A", "K"]);
    expect(s1.hand_outcomes[0]).toBe("win");
    const t = planMotion(view(s0), view(s1))!;
    expect(t.cues.some((q) => q.sound === "blackjack")).toBe(false);
    expect(t.momentAt).toBeNull();
    expect(t.chimeAt).toBe(t.resultAt);
    t.frames.forEach((f) => expect(f.stage.natural).toEqual(NO_NATURALS));
    expect(naturalEdges(view(s1))).toEqual(NO_NATURALS);
  });

  it("the dealer's natural against a bust is not marked; against a 3-card 21 it wins and is (#3741)", () => {
    // A save from before the peek (savedAgainstNatural): the player still to act against it.
    const bust = savedAgainstNatural([c("10"), c("6", "♥")], [c("K", "♦")]);
    expect(naturalEdges(view(hit(bust)))).toEqual(NO_NATURALS);
    // Standard rules (#3741): the dealer's natural beats a 3-card 21, so it decided the round.
    // The hit to 21 stands on its own (#3764).
    const settled = hit(savedAgainstNatural([c("10"), c("6", "♥")], [c("5", "♦")]));
    expect(settled.outcome).toBe("lose");
    expect(naturalEdges(view(settled))).toEqual({ player: false, dealer: true });
  });

  it("a settled round marks its naturals; a round in play or betting marks none", () => {
    const s1 = placeBet(betting(c("A"), c("7", "♣"), c("K", "♥"), c("9", "♥")), 10);
    expect(naturalEdges(view(s1))).toEqual({ player: true, dealer: false });
    expect(fullStage(view(s1)).natural).toEqual({ player: true, dealer: false });
    expect(naturalEdges(view(newHand(s1)))).toEqual(NO_NATURALS);
    // The dealer peeks under an ace and finds 20, not a natural: the round goes on.
    const playing = placeBet(betting(c("10"), c("9", "♣"), c("8", "♥"), c("A", "♦")), 10);
    expect(playing.phase).toBe("player");
    expect(naturalEdges(view(playing))).toEqual(NO_NATURALS);
  });
});

describe("stageView", () => {
  it("draws the cards shown, the hole card face down, and no result before it shows", () => {
    const s1 = stand(placeBet(betting(c("10"), c("7", "♣"), c("5", "♥"), c("9", "♥")), 10));
    const v = view(s1);
    const shown = stageView(v, {
      ...fullStage(v),
      dealer: 2,
      holeDown: true,
      result: false,
      revealed: 0,
      settled: false,
      active: null,
    });
    expect(shown.phase).toBe("player");
    expect(shown.dealer_hand.cards.map((x) => x.face_down)).toEqual([true, false]);
    // The total of the cards face up only.
    expect(shown.dealer_hand.value).toBe(9);
    expect(shown.outcome).toBeNull();
    expect(shown.hand_outcomes).toEqual([]);
    // Every hand played while the dealer plays.
    expect(shown.active_hand_index).toBe(1);
  });
});

describe("assignCardIds", () => {
  let n = 0;
  const fresh = () => `id${++n}`;
  beforeEach(() => {
    n = 0;
  });

  it("keeps a card's id through its round, and moves a split's second card to the new hand", () => {
    const s0 = placeBet(
      betting(c("8"), c("10", "♣"), c("8", "♥"), c("7", "♦"), c("10", "♦"), c("5", "♣")),
      10
    );
    const ids0 = assignCardIds(null, view(s0), fresh);
    const ids1 = assignCardIds({ view: view(s0), ids: ids0 }, view(split(s0)), fresh);
    expect(ids1.dealer).toEqual(ids0.dealer);
    expect(ids1.hands[0]![0]).toBe(ids0.hands[0]![0]);
    expect(ids1.hands[1]![0]).toBe(ids0.hands[0]![1]);
    const all = [...ids1.dealer, ...ids1.hands.flat()];
    expect(new Set(all).size).toBe(all.length);
  });

  it("a new round's cards are all new", () => {
    const s0 = stand(placeBet(betting(c("10"), c("7", "♣"), c("5", "♥"), c("9", "♥")), 10));
    const ids0 = assignCardIds(null, view(s0), fresh);
    const s1 = placeBet(newHand(s0), 10);
    const ids1 = assignCardIds({ view: view(s0), ids: ids0 }, view(s1), fresh);
    const before = new Set([...ids0.dealer, ...ids0.hands.flat()]);
    expect([...ids1.dealer, ...ids1.hands.flat()].some((id) => before.has(id))).toBe(false);
  });
});

describe("cubicBezier", () => {
  it("runs from 0 to 1 and matches CSS's linear curve", () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (const p of [0, 0.1, 0.5, 0.9, 1]) expect(linear(p)).toBeCloseTo(p, 4);
    const deal = cubicBezier(0.15, 0.75, 0.25, 1);
    expect(deal(0)).toBe(0);
    expect(deal(1)).toBe(1);
    // Fast off the mark: most of the way there by half time.
    expect(deal(0.5)).toBeGreaterThan(0.85);
  });
});

// ── Fuzz ──────────────────────────────────────────────────────────────────────

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
/**
 * A shuffled shoe, with pairs made likely (so splits and resplits come up). Seeds past 40 pair
 * tens, so split hands dealt 21 (a ten and an ace) come up too (#3764).
 */
const pairFor = (seed: number) => (seed > 40 ? "10" : "8");
function shoe(rng: () => number, pair = "8"): Card[] {
  const cards: Card[] = [];
  for (let i = 0; i < 312; i++) {
    const rank = rng() < 0.3 ? pair : RANKS[Math.floor(rng() * RANKS.length)]!;
    cards.push(c(rank, ["♠", "♥", "♦", "♣"][Math.floor(rng() * 4)]));
  }
  return cards;
}

type Action = (s: EngineState) => EngineState;

/** A random legal action for `s` (the player's phase). */
function pick(s: EngineState, rng: () => number): Action {
  const v = toViewState(s);
  const options: Action[] = [hit, stand];
  if (v.double_down_available) options.push(doubleDown);
  if (v.split_available) options.push(split, split);
  return options[Math.floor(rng() * options.length)]!;
}

const totalCards = (v: BlackjackState) =>
  v.dealer_hand.cards.length + v.player_hands.reduce((a, h) => a + h.cards.length, 0);

/** The invariants every timeline keeps. */
function check(
  prev: BlackjackState,
  next: BlackjackState,
  t: Timeline,
  ids: CardIds,
  held: readonly number[]
) {
  const { frames, cues } = t;
  // In time order, from 0; the last stage is the settled round, less the cards still held back
  // (none once the round is settled, and only by a hand not yet played).
  expect(frames[0]!.at).toBe(0);
  for (let i = 1; i < frames.length; i++) expect(frames[i]!.at).toBeGreaterThan(frames[i - 1]!.at);
  expect(frames[frames.length - 1]!.stage).toEqual(withHeld(fullStage(next), t.held));
  if (next.phase !== "player") expect(t.held.every((n) => n === 0)).toBe(true);
  t.held.forEach((n, i) => {
    if (n > 0) expect(i).toBeGreaterThan(next.active_hand_index);
  });
  // A card once shown stays shown: no hand or dealer count ever goes down, no hand goes away.
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!.stage;
    const b = frames[i]!.stage;
    expect(b.dealer).toBeGreaterThanOrEqual(a.dealer);
    expect(b.hands.length).toBe(a.hands.length);
    b.hands.forEach((n, h) => expect(n).toBeGreaterThanOrEqual(a.hands[h]!));
    // The hole card turns once, never back.
    if (!a.holeDown) expect(b.holeDown).toBe(false);
    // A card counts once it is shown (it has landed), and stays counted; the hole card counts only
    // once it is face up.
    expect(b.dealerCounted).toBeGreaterThanOrEqual(a.dealerCounted);
    expect(b.dealerCounted).toBeLessThanOrEqual(b.dealer);
    b.counted.forEach((n, h) => {
      expect(n).toBeGreaterThanOrEqual(a.counted[h]!);
      expect(n).toBeLessThanOrEqual(b.hands[h]!);
    });
    if (a.holeCounted) expect(b.holeCounted).toBe(true);
    if (b.holeCounted) expect(b.holeDown).toBe(false);
  }
  // Each stage draws a prefix of the settled round, cards never face down but the hole card.
  for (const f of frames) {
    const v = stageView(next, f.stage);
    v.dealer_hand.cards.forEach((card, i) => {
      if (i > 0) expect(card.face_down).toBe(false);
    });
    v.player_hands.forEach((h, i) =>
      expect(h.cards).toEqual(next.player_hands[i]!.cards.slice(0, h.cards.length))
    );
  }
  // One deal sound per card first drawn (a split's second card moves, it is not dealt again; a
  // held card is dealt when its hand's turn comes).
  const drawn = (st: { hands: readonly number[]; dealer: number }) =>
    st.dealer + st.hands.reduce((a, n) => a + n, 0);
  const before = prev.phase !== "player" ? 0 : totalCards(prev) - held.reduce((a, n) => a + n, 0);
  const after = drawn(frames[frames.length - 1]!.stage);
  expect(cues.filter((q) => q.sound === "deal")).toHaveLength(after - before);
  // No sound twice at once.
  const keys = cues.map((q) => `${q.sound}@${q.at}`);
  expect(new Set(keys).size).toBe(keys.length);
  // The settled ids: each card one id, unique.
  const all = [...ids.dealer, ...ids.hands.flat()];
  expect(new Set(all).size).toBe(all.length);
  expect(all).toHaveLength(totalCards(next));
  // The natural (#3621): the sting only on a deal that makes a 3:2 natural, once, as the second
  // card lands, with its moment and its larger payout chip; an edge once marked stays; a split
  // round never marks one.
  const stung = prev.phase !== "player" && next.outcome === "blackjack";
  expect(cues.filter((q) => q.sound === "blackjack")).toEqual(
    stung ? [{ at: NATURAL_AT_MS, sound: "blackjack" }] : []
  );
  expect(t.momentAt).toBe(stung ? NATURAL_AT_MS : null);
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!.stage.natural;
    const b = frames[i]!.stage.natural;
    if (a.player) expect(b.player).toBe(true);
    if (a.dealer) expect(b.dealer).toBe(true);
  }
  for (const f of frames) {
    if (f.stage.hands.length > 1) expect(f.stage.natural).toEqual(NO_NATURALS);
    if (f.stage.natural.dealer) expect(f.stage.holeCounted).toBe(true);
    f.stage.chips.forEach((chip) => expect(chip.natural ?? false).toBe(stung));
  }
  const chimes = cues.filter((q) => RESULT_CUES.includes(q.sound) && q.at === t.chimeAt);
  if (t.resultAt === null) {
    expect(t.flips).toBe(false);
    expect(t.chimeAt).toBeNull();
    return;
  }
  // One chime, after the last card lands; the flip before every dealer draw. A player's natural
  // (#3621) shows its result at the flip's end, its chime (the sting) as its second card lands.
  expect(chimes).toHaveLength(1);
  const playerNatural = prev.phase !== "player" && naturalEdges(next).player;
  const lastDeal = Math.max(-1, ...cues.filter((q) => q.sound === "deal").map((q) => q.at));
  const flip = cues.find((q) => q.sound === "flip")!;
  expect(t.resultAt).toBeGreaterThanOrEqual(
    Math.max(lastDeal + DEAL_FLIGHT_MS, flip.at + FLIP_MS) + (playerNatural ? 0 : RESULT_DELAY_MS)
  );
  cues
    .filter((q) => q.sound === "deal" && q.at > flip.at)
    .forEach((q, j) => expect(q.at).toBe(flip.at + (j + 1) * DEALER_PACE_MS));
  // Each hand's chips once, after the chime.
  const chips = cues.filter((q) => ["payout", "collect", "nudge"].includes(q.sound));
  expect(chips).toHaveLength(next.player_hands.length);
  chips.forEach((q) => expect(q.at).toBeGreaterThanOrEqual(t.resultAt! + CHIP_DELAY_MS));
}

/**
 * The peek's invariant (#3741): a dealer natural settles the round at the deal, for the original
 * bet only: lost, or pushed by the player's natural.
 */
function expectPeek(s: EngineState) {
  if (!isNaturalBlackjack(s.dealer_hand)) return;
  expect(s.phase).not.toBe("player");
  expect(s.dealer_hand).toHaveLength(2);
  expect(s.doubled).toBe(false);
  expect(s.split_count).toBe(0);
  if (isNaturalBlackjack(s.player_hand)) {
    expect(s.outcome).toBe("push");
    expect(s.payout).toBe(0);
  } else {
    expect(s.outcome).toBe("lose");
    expect(s.payout).toBe(-s.bet);
  }
}

describe("fuzz: random rounds", () => {
  it.each(Array.from({ length: 60 }, (_, i) => i + 1))("seed %i", (seed) => {
    const rng = createSeededRng(seed * 7919);
    let s = newGame(shoe(rng, pairFor(seed)), {
      startingChips: 5000,
      runGoal: null,
      betMin: 5,
      betMax: 25,
    });
    let n = 0;
    const fresh = () => `id${++n}`;
    let ids = assignCardIds(null, toViewState(s), fresh);
    for (let round = 0; round < 12; round++) {
      let prev = toViewState(s);
      s = placeBet(s, 10);
      expectPeek(s);
      let next = toViewState(s);
      let nextIds = assignCardIds({ view: prev, ids }, next, fresh);
      const deal = planMotion(prev, next)!;
      check(prev, next, deal, nextIds, []);
      let held = deal.held;
      ids = nextIds;
      while (s.phase === "player") {
        // The peek (#3741): the player never acts against a dealer natural.
        expect(isNaturalBlackjack(s.dealer_hand.slice(0, 2))).toBe(false);
        // 21 stands on its own (#3764): the hand to play never shows 21, so Hit and Stand are
        // never offered on one.
        expect(toViewState(s).player_hand.value).toBeLessThan(21);
        const action = pick(s, rng);
        prev = toViewState(s);
        s = action(s);
        next = toViewState(s);
        const t = planMotion(prev, next, held);
        expect(t).not.toBeNull();
        nextIds = assignCardIds({ view: prev, ids }, next, fresh);
        check(prev, next, t!, nextIds, held);
        held = t!.held;
        ids = nextIds;
      }
      s = newHand(s);
    }
  });

  it("covers splits, resplits to four hands, doubles, naturals, peeked dealer naturals and 21s that stand on their own over the seeds", () => {
    const seen = { split: 0, four: 0, double: 0, natural: 0, peeked: 0, hit21: 0, passed21: 0 };
    for (let seed = 1; seed <= 60; seed++) {
      const rng = createSeededRng(seed * 7919);
      let s = newGame(shoe(rng, pairFor(seed)), {
        startingChips: 5000,
        runGoal: null,
        betMin: 5,
        betMax: 25,
      });
      for (let round = 0; round < 12; round++) {
        s = placeBet(s, 10);
        if (s.outcome === "blackjack") seen.natural++;
        if (isNaturalBlackjack(s.dealer_hand)) seen.peeked++;
        while (s.phase === "player") {
          const action = pick(s, rng);
          if (action === split) seen.split++;
          if (action === doubleDown) seen.double++;
          const before = s;
          s = action(s);
          if (s.player_hands.length === 4) seen.four++;
          // A hit that made 21 (#3764), and a split hand dealt 21 that play passed over.
          if (action === hit) {
            const k = before.active_hand_index;
            const h = s.split_count > 0 ? s.player_hands[k] : s.player_hand;
            if (h !== undefined && handValue(h) === 21) seen.hit21++;
          }
          const passedTo = s.phase === "player" ? s.active_hand_index : s.player_hands.length;
          for (let i = before.active_hand_index; i < passedTo; i++) {
            const h = s.player_hands[i];
            if (h?.length === 2 && handValue(h) === 21 && !s.split_from_aces[i]) seen.passed21++;
          }
        }
        s = newHand(s);
      }
    }
    expect(seen.split).toBeGreaterThan(10);
    expect(seen.four).toBeGreaterThan(0);
    expect(seen.double).toBeGreaterThan(10);
    expect(seen.natural).toBeGreaterThan(0);
    expect(seen.peeked).toBeGreaterThan(0);
    expect(seen.hit21).toBeGreaterThan(0);
    expect(seen.passed21).toBeGreaterThan(0);
  });
});

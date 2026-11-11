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
  hit,
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
import type { BlackjackState } from "../../../game/blackjack/types";
import { cubicBezier } from "../../cards/cardMotion";
import {
  assignCardIds,
  CHIP_DELAY_MS,
  DEAL_FLIGHT_MS,
  DEALER_PACE_MS,
  FLIP_MS,
  fullStage,
  planMotion,
  RESULT_CUES,
  RESULT_DELAY_MS,
  stageView,
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

  it("a split: the slide, the second stake at 300 ms, then each hand's card", () => {
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
      ["deal", 460],
      ["deal", 640],
    ]);
    // Both hands to play: the second stand plays the dealer, one net chime, then hand by hand.
    const s2 = stand(s1);
    expect(planMotion(view(s1), view(s2))!.cues).toEqual([]);
    const s3 = stand(s2);
    const end = planMotion(view(s2), view(s3))!;
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

  it("a new hand's betting has no motion", () => {
    const s0 = stand(placeBet(betting(c("10"), c("7", "♣"), c("5", "♥"), c("9", "♥")), 10));
    expect(planMotion(view(s0), view(newHand(s0)))).toBeNull();
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
/** A shuffled shoe, with pairs made likely (so splits and resplits come up). */
function shoe(rng: () => number): Card[] {
  const cards: Card[] = [];
  for (let i = 0; i < 312; i++) {
    const rank = rng() < 0.3 ? "8" : RANKS[Math.floor(rng() * RANKS.length)]!;
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
function check(prev: BlackjackState, next: BlackjackState, t: Timeline, ids: CardIds) {
  const { frames, cues } = t;
  // In time order, from 0; the last stage is the settled round.
  expect(frames[0]!.at).toBe(0);
  for (let i = 1; i < frames.length; i++) expect(frames[i]!.at).toBeGreaterThan(frames[i - 1]!.at);
  expect(frames[frames.length - 1]!.stage).toEqual(fullStage(next));
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
  // One deal sound per new card (a split's second card moves, it is not dealt again).
  const newCards = prev.phase !== "player" ? totalCards(next) : totalCards(next) - totalCards(prev);
  expect(cues.filter((q) => q.sound === "deal")).toHaveLength(newCards);
  // No sound twice at once.
  const keys = cues.map((q) => `${q.sound}@${q.at}`);
  expect(new Set(keys).size).toBe(keys.length);
  // The settled ids: each card one id, unique.
  const all = [...ids.dealer, ...ids.hands.flat()];
  expect(new Set(all).size).toBe(all.length);
  expect(all).toHaveLength(totalCards(next));
  const chimes = cues.filter((q) => RESULT_CUES.includes(q.sound) && q.at === t.resultAt);
  if (t.resultAt === null) {
    expect(t.flips).toBe(false);
    return;
  }
  // One chime, after the last card lands; the flip before every dealer draw.
  expect(chimes).toHaveLength(1);
  const lastDeal = Math.max(-1, ...cues.filter((q) => q.sound === "deal").map((q) => q.at));
  const flip = cues.find((q) => q.sound === "flip")!;
  expect(t.resultAt).toBeGreaterThanOrEqual(
    Math.max(lastDeal + DEAL_FLIGHT_MS, flip.at + FLIP_MS) + RESULT_DELAY_MS
  );
  cues
    .filter((q) => q.sound === "deal" && q.at > flip.at)
    .forEach((q, j) => expect(q.at).toBe(flip.at + (j + 1) * DEALER_PACE_MS));
  // Each hand's chips once, after the chime.
  const chips = cues.filter((q) => ["payout", "collect", "nudge"].includes(q.sound));
  expect(chips).toHaveLength(next.player_hands.length);
  chips.forEach((q) => expect(q.at).toBeGreaterThanOrEqual(t.resultAt! + CHIP_DELAY_MS));
}

describe("fuzz: random rounds", () => {
  it.each(Array.from({ length: 40 }, (_, i) => i + 1))("seed %i", (seed) => {
    const rng = createSeededRng(seed * 7919);
    let s = newGame(shoe(rng), { startingChips: 5000, runGoal: null, betMin: 5, betMax: 25 });
    let n = 0;
    const fresh = () => `id${++n}`;
    let ids = assignCardIds(null, toViewState(s), fresh);
    for (let round = 0; round < 12; round++) {
      let prev = toViewState(s);
      s = placeBet(s, 10);
      let next = toViewState(s);
      let nextIds = assignCardIds({ view: prev, ids }, next, fresh);
      check(prev, next, planMotion(prev, next)!, nextIds);
      ids = nextIds;
      while (s.phase === "player") {
        const action = pick(s, rng);
        prev = toViewState(s);
        s = action(s);
        next = toViewState(s);
        const t = planMotion(prev, next);
        expect(t).not.toBeNull();
        nextIds = assignCardIds({ view: prev, ids }, next, fresh);
        check(prev, next, t!, nextIds);
        ids = nextIds;
      }
      s = newHand(s);
    }
  });

  it("covers splits, resplits to four hands, doubles and naturals over the seeds", () => {
    const seen = { split: 0, four: 0, double: 0, natural: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      const rng = createSeededRng(seed * 7919);
      let s = newGame(shoe(rng), { startingChips: 5000, runGoal: null, betMin: 5, betMax: 25 });
      for (let round = 0; round < 12; round++) {
        s = placeBet(s, 10);
        if (s.outcome === "blackjack") seen.natural++;
        while (s.phase === "player") {
          const action = pick(s, rng);
          if (action === split) seen.split++;
          if (action === doubleDown) seen.double++;
          s = action(s);
          if (s.player_hands.length === 4) seen.four++;
        }
        s = newHand(s);
      }
    }
    expect(seen.split).toBeGreaterThan(10);
    expect(seen.four).toBeGreaterThan(0);
    expect(seen.double).toBeGreaterThan(10);
    expect(seen.natural).toBeGreaterThan(0);
  });
});

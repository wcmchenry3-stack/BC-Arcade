/**
 * Blackjack's card and chip motion, and the sounds timed to it (#3581, owner-approved from the
 * animated mockup; the decisions are in #3575). Pure: the screen's hook (`useBlackjackMotion`)
 * runs what this plans.
 *
 * The engine stays instant: an action commits the settled round at once (a Stand plays the
 * dealer's whole turn and settles it). The felt then replays the change from the settled state,
 * as a timeline of stages. A `Stage` says how much of the settled round the felt shows (how many
 * cards in each hand, whether the hole card is still face down, whether the result shows), and
 * the felt draws the settled round cut to it (`stageView`). Each stage starts at its time on the
 * action's clock; a card a stage adds is dealt (it flies in from just off the felt's top-right),
 * a card a stage moves slides, and the hole card a stage turns flips. The sounds are cues on the
 * same clock.
 *
 * See docs/games/blackjack.md ("Motion and sound timing") and the design log,
 * docs/games/arcade-sound-design.md.
 */
import { handValue, isSoftHand } from "../../game/blackjack/engine";
import { showsResult } from "../../game/blackjack/layout";
import type { BlackjackState, CardResponse, HandResponse } from "../../game/blackjack/types";
import { cubicBezier, type Point } from "../cards/cardMotion";

// ── Motion (owner-approved, #3575 / #3581) ────────────────────────────────────

/** A dealt card's flight from just off the felt's top-right to its place. */
export const DEAL_FLIGHT_MS = 240;
/** The opening deal launches its four cards this far apart. */
export const DEAL_STAGGER_MS = 180;
/** A dealt card turns from this angle to square as it flies. */
export const DEAL_ROTATE_DEG = -18;
/** The deal's easing, `cubic-bezier(.15,.75,.25,1)`. */
export const easeDeal = cubicBezier(0.15, 0.75, 0.25, 1);
/** A card moving to a new place in its hand (the re-fan as a card lands, a split). */
export const REFAN_MS = 240;
/** The re-fan's easing, `cubic-bezier(.2,.8,.2,1)`. */
export const easeSlide = cubicBezier(0.2, 0.8, 0.2, 1);
/** A split slides the pair apart, and a 3rd or 4th hand (or the next hand to play) re-lays the rows. */
export const SPLIT_SLIDE_MS = 300;
/** The hole card turns over (Y axis, 180° → 0°), lifting to `FLIP_LIFT` at its midpoint. */
export const FLIP_MS = 320;
export const FLIP_LIFT = 1.08;
/** The flip's easing, ease-in-out. */
export const easeFlip = cubicBezier(0.42, 0, 0.58, 1);
/** The dealer's turn: each draw this long after the flip, or the draw before it. */
export const DEALER_PACE_MS = 600;
/** The result shows this long after the last card lands. */
export const RESULT_DELAY_MS = 300;
/** The result banner pops in (fade, scale 0.9 → 1). */
export const BANNER_POP_MS = 260;
/** A split hand's result tag pops in (fade, scale 0.8 → 1). */
export const TAG_POP_MS = 200;
/** The chips move this long after the result (the chime leads). */
export const CHIP_DELAY_MS = 420;
/** A split round's hands settle their chips this far apart, after the net result. */
export const HAND_STAGGER_MS = 300;
/** Chip moves: a payout onto the stake, the stake swept off, a push's nudge. */
export const PAYOUT_MS = 360;
export const COLLECT_MS = 380;
export const NUDGE_MS = 300;
/** A chip from the tray into the betting circle. */
export const CHIP_BET_MS = 100;
/** A split's second stake, from the tray to the new hand. */
export const SPLIT_CHIP_MS = 160;
/** How far a push's nudge moves the stake (toward the player) before it settles back. */
export const NUDGE_PX = 14;

/** Where a dealt card's flight starts: just off the felt's top-right corner (its top-left). */
export function dealOrigin(feltWidth: number): Point {
  return { x: feltWidth + 30, y: -140 };
}

// ── Stages ────────────────────────────────────────────────────────────────────

export type ChipKind = "bet" | "split" | "payout" | "collect" | "nudge";

/** A chip moving on the felt. */
export interface ChipShown {
  readonly id: number;
  readonly kind: ChipKind;
  /** The hand whose stake it moves to or from (the betting circle for "bet"). */
  readonly hand: number;
  readonly durationMs: number;
}

/** How much of the settled round the felt shows. */
export interface Stage {
  /** Dealer cards shown. */
  readonly dealer: number;
  /** The hole card (the dealer's first) is still shown face down. */
  readonly holeDown: boolean;
  /** Cards shown in each hand; its length is the number of hands shown. */
  readonly hands: readonly number[];
  /**
   * Cards counted in each hand's total: a card counts once it lands, not as it is launched
   * (#3720 review, as in the mockup).
   */
  readonly counted: readonly number[];
  /** Dealer cards that have landed. */
  readonly dealerCounted: number;
  /** The hole card counts in the dealer's total: once its turn has ended (until then, "?"). */
  readonly holeCounted: boolean;
  /** The hand outlined; null for none (the dealer's turn: every hand is played). */
  readonly active: number | null;
  /** The result (banner, outcomes) shows. */
  readonly result: boolean;
  /** Hands whose own result shows (a split round reveals them one by one). */
  readonly revealed: number;
  /** The chip count shows the settled chips (after the payout). */
  readonly settled: boolean;
  readonly chips: readonly ChipShown[];
}

export type SoundCue =
  | "deal"
  | "flip"
  | "chipBet"
  | "win"
  | "lose"
  | "bust"
  | "push"
  | "blackjack"
  | "payout"
  | "collect"
  | "nudge";

/** The result chimes: one per round (a split's net), with the banner. */
export const RESULT_CUES: readonly SoundCue[] = ["win", "lose", "bust", "push", "blackjack"];

export interface Cue {
  readonly at: number;
  readonly sound: SoundCue;
}

export interface Timeline {
  /** The stages, in time order; the first at 0, the last the settled round. */
  readonly frames: readonly { readonly at: number; readonly stage: Stage }[];
  readonly cues: readonly Cue[];
  /** How long a card moving to a new place slides in this action. */
  readonly slideMs: number;
  /** The hole card flips in this action. */
  readonly flips: boolean;
  /** When the result shows, or null (the round goes on). */
  readonly resultAt: number | null;
  /** When the last stage starts (the round is settled from then). */
  readonly endMs: number;
}

/** The whole round, as it is settled. */
export function fullStage(v: BlackjackState): Stage {
  const result = showsResult(v.phase);
  return {
    dealer: v.dealer_hand.cards.length,
    holeDown: v.dealer_hand.cards[0]?.face_down ?? false,
    hands: v.player_hands.map((h) => h.cards.length),
    counted: v.player_hands.map((h) => h.cards.length),
    dealerCounted: v.dealer_hand.cards.length,
    holeCounted: !(v.dealer_hand.cards[0]?.face_down ?? false),
    active: v.phase === "player" ? v.active_hand_index : null,
    result,
    revealed: result ? v.player_hands.length : 0,
    settled: true,
    chips: [],
  };
}

const counts = (v: BlackjackState) => v.player_hands.map((h) => h.cards.length);

/** The chime for a settled round (a split round's net). */
export function resultCue(v: BlackjackState): SoundCue {
  if (v.player_hands.length > 1) {
    const net = v.hand_payouts.reduce((a, b) => a + b, 0);
    return net > 0 ? "win" : net < 0 ? "lose" : "push";
  }
  switch (v.outcome) {
    case "blackjack":
      return "blackjack";
    case "win":
      return "win";
    case "push":
      return "push";
    default:
      return (v.player_hands[0]?.value ?? 0) > 21 ? "bust" : "lose";
  }
}

/** A hand's chips at the result: a payout on a win, the stake swept on a loss, a nudge on a push. */
export function chipFor(outcome: string | null | undefined): {
  kind: ChipKind;
  sound: SoundCue;
  durationMs: number;
} {
  if (outcome === "win" || outcome === "blackjack") {
    return { kind: "payout", sound: "payout", durationMs: PAYOUT_MS };
  }
  if (outcome === "lose") return { kind: "collect", sound: "collect", durationMs: COLLECT_MS };
  return { kind: "nudge", sound: "nudge", durationMs: NUDGE_MS };
}

type Op = (s: Stage) => Stage;

/** Hand `k`'s first `n` cards count in its total. */
const countHand =
  (k: number, n: number): Op =>
  (s) => ({ ...s, counted: s.counted.map((c, i) => (i === k ? n : c)) });

/** Builds a timeline from changes at times (applied in time order, then in the order given). */
let chipCount = 0;
/** A chip's id, unique for the app's life: a moving chip's React key (#3720 review). */
export function nextChipId(): number {
  return ++chipCount;
}

class TimelineBuilder {
  private readonly ops: { at: number; seq: number; op: Op }[] = [];
  private readonly cueList: Cue[] = [];

  at(ms: number, op: Op): void {
    this.ops.push({ at: ms, seq: this.ops.length, op });
  }

  cue(ms: number, sound: SoundCue): void {
    this.cueList.push({ at: ms, sound });
  }

  /** A chip moving from `ms` for its duration (it goes when it arrives). */
  chip(ms: number, kind: ChipKind, hand: number, durationMs: number): void {
    const chip: ChipShown = { id: nextChipId(), kind, hand, durationMs };
    this.at(ms, (s) => ({ ...s, chips: [...s.chips, chip] }));
    this.at(ms + durationMs, (s) => ({ ...s, chips: s.chips.filter((c) => c !== chip) }));
  }

  build(
    start: Stage,
    end: Stage,
    slideMs: number,
    flips: boolean,
    resultAt: number | null
  ): Timeline {
    const sorted = [...this.ops].sort((a, b) => a.at - b.at || a.seq - b.seq);
    const frames: { at: number; stage: Stage }[] = [{ at: 0, stage: start }];
    let stage = start;
    for (const { at, op } of sorted) {
      stage = op(stage);
      const last = frames[frames.length - 1]!;
      if (last.at === at) frames[frames.length - 1] = { at, stage };
      else frames.push({ at, stage });
    }
    // The last stage is the settled round itself (nothing left out, no chip left moving).
    const endMs = frames[frames.length - 1]!.at;
    frames[frames.length - 1] = { at: endMs, stage: end };
    const cues = [...this.cueList].sort((a, b) => a.at - b.at);
    return { frames, cues, slideMs, flips, resultAt, endMs };
  }
}

/** The player's part of an action: where the felt starts, and when its last card lands. */
interface PlayerPart {
  readonly start: Stage;
  /** When the player's last card lands: the dealer's turn starts there. */
  readonly landed: number;
  readonly slideMs: number;
}

/** A new deal: player, dealer hole (face down), player, dealer up, 180 ms apart. */
function planDeal(b: TimelineBuilder, next: BlackjackState): PlayerPart | null {
  const nextCounts = counts(next);
  if (nextCounts.length !== 1 || nextCounts[0] !== 2 || next.dealer_hand.cards.length !== 2) {
    return null;
  }
  const start: Stage = {
    dealer: 0,
    holeDown: true,
    hands: [1],
    counted: [0],
    dealerCounted: 0,
    holeCounted: false,
    active: 0,
    result: false,
    revealed: 0,
    settled: false,
    chips: [],
  };
  b.cue(0, "deal");
  b.at(DEAL_STAGGER_MS, (s) => ({ ...s, dealer: 1 }));
  b.cue(DEAL_STAGGER_MS, "deal");
  b.at(2 * DEAL_STAGGER_MS, (s) => ({ ...s, hands: [2] }));
  b.cue(2 * DEAL_STAGGER_MS, "deal");
  b.at(3 * DEAL_STAGGER_MS, (s) => ({ ...s, dealer: 2 }));
  b.cue(3 * DEAL_STAGGER_MS, "deal");
  // Each card counts in its hand's total as it lands.
  b.at(DEAL_FLIGHT_MS, countHand(0, 1));
  b.at(DEAL_STAGGER_MS + DEAL_FLIGHT_MS, (s) => ({ ...s, dealerCounted: 1 }));
  b.at(2 * DEAL_STAGGER_MS + DEAL_FLIGHT_MS, countHand(0, 2));
  b.at(3 * DEAL_STAGGER_MS + DEAL_FLIGHT_MS, (s) => ({ ...s, dealerCounted: 2 }));
  return { start, landed: 3 * DEAL_STAGGER_MS + DEAL_FLIGHT_MS, slideMs: REFAN_MS };
}

/**
 * A split: the pair slides apart (300 ms), the second stake follows from the tray, then each of
 * the two hands is dealt its second card.
 */
function planSplit(
  b: TimelineBuilder,
  base: Stage,
  k: number,
  pCounts: readonly number[],
  next: BlackjackState
): PlayerPart | null {
  const nextCounts = counts(next);
  const before = [...pCounts.slice(0, k), 1, 1, ...pCounts.slice(k + 1)];
  if (before.some((n, i) => n !== nextCounts[i] && i !== k && i !== k + 1)) return null;
  b.chip(SPLIT_SLIDE_MS, "split", k + 1, SPLIT_CHIP_MS);
  b.cue(SPLIT_SLIDE_MS, "chipBet");
  const first = SPLIT_SLIDE_MS + SPLIT_CHIP_MS;
  const second = first + DEAL_STAGGER_MS;
  b.at(first, (s) => ({ ...s, hands: s.hands.map((n, i) => (i === k ? nextCounts[k]! : n)) }));
  b.cue(first, "deal");
  b.at(second, (s) => ({ ...s, hands: nextCounts }));
  b.cue(second, "deal");
  b.at(first + DEAL_FLIGHT_MS, countHand(k, nextCounts[k]!));
  b.at(second + DEAL_FLIGHT_MS, countHand(k + 1, nextCounts[k + 1]!));
  const landed = second + DEAL_FLIGHT_MS;
  const nextActive = next.phase === "player" ? next.active_hand_index : null;
  // Split aces are played out at once: the next hand to play is outlined once the cards land.
  if (nextActive !== null && nextActive !== k) b.at(landed, (s) => ({ ...s, active: nextActive }));
  const start = { ...base, hands: before, counted: before, active: k };
  return { start, landed, slideMs: SPLIT_SLIDE_MS };
}

/** A Hit or a Double (one card for the hand being played), or a Stand (none). */
function planPlay(
  b: TimelineBuilder,
  base: Stage,
  k: number,
  pCounts: readonly number[],
  next: BlackjackState
): PlayerPart | null {
  const nextCounts = counts(next);
  const nextActive = next.phase === "player" ? next.active_hand_index : null;
  const grew = nextCounts.findIndex((n, i) => n !== pCounts[i]);
  if (grew === -1) {
    // A Stand: the next hand to play is outlined (the rows re-lay), or the dealer plays.
    const slideMs = nextActive !== null ? SPLIT_SLIDE_MS : REFAN_MS;
    return { start: { ...base, active: nextActive ?? k }, landed: 0, slideMs };
  }
  if (nextCounts.some((n, i) => n !== (i === grew ? pCounts[i]! + 1 : pCounts[i]))) return null;
  b.cue(0, "deal");
  b.at(DEAL_FLIGHT_MS, countHand(grew, nextCounts[grew]!));
  const start = { ...base, hands: nextCounts, active: k };
  if (nextActive === null || nextActive === k) {
    return { start, landed: DEAL_FLIGHT_MS, slideMs: REFAN_MS };
  }
  // A split hand is done (bust, or doubled): the next one is outlined as its card lands.
  if ((next.player_hands[grew]?.value ?? 0) > 21) b.cue(DEAL_FLIGHT_MS, "bust");
  b.at(DEAL_FLIGHT_MS, (s) => ({ ...s, active: nextActive }));
  return { start, landed: DEAL_FLIGHT_MS, slideMs: SPLIT_SLIDE_MS };
}

/**
 * The dealer's turn, replayed from the settled round: the hole card turns, each draw ~600 ms
 * after the last, the result ~300 ms after the last card lands, and the chips after it (a split
 * round: one chime for the net, then each hand's tag and chips in turn). Returns when the result
 * shows.
 */
function planDealerTurn(b: TimelineBuilder, t0: number, next: BlackjackState): number {
  const shown = 2;
  b.at(t0, (s) => ({ ...s, holeDown: false, active: null }));
  b.cue(t0, "flip");
  // The dealer's total shows once the hole card's face is up (its turn ended).
  b.at(t0 + FLIP_MS, (s) => ({ ...s, holeCounted: true }));
  const draws = next.dealer_hand.cards.length - shown;
  for (let j = 1; j <= draws; j++) {
    const at = t0 + j * DEALER_PACE_MS;
    b.at(at, (s) => ({ ...s, dealer: shown + j }));
    b.cue(at, "deal");
    b.at(at + DEAL_FLIGHT_MS, (s) => ({ ...s, dealerCounted: shown + j }));
  }
  const lastLanding = draws > 0 ? t0 + draws * DEALER_PACE_MS + DEAL_FLIGHT_MS : t0 + FLIP_MS;
  const r = lastLanding + RESULT_DELAY_MS;
  const hands = next.player_hands.length;
  const split = hands > 1;
  b.at(r, (s) => ({ ...s, result: true, revealed: split ? 0 : hands }));
  b.cue(r, resultCue(next));
  let settleAt = r;
  for (let i = 0; i < hands; i++) {
    const at = r + CHIP_DELAY_MS + i * HAND_STAGGER_MS;
    const c = chipFor(split ? next.hand_outcomes[i] : next.outcome);
    if (split) b.at(at, (s) => ({ ...s, revealed: i + 1 }));
    b.chip(at, c.kind, i, c.durationMs);
    b.cue(at, c.sound);
    settleAt = Math.max(settleAt, at + c.durationMs);
  }
  b.at(settleAt, (s) => ({ ...s, settled: true }));
  return r;
}

/**
 * The motion of the player's action that took the felt from `prev` to `next` (both as the engine
 * settled them), or null when there is none to show: the felt then shows `next` at once (a new
 * hand's betting, or a change no action makes).
 */
export function planMotion(prev: BlackjackState, next: BlackjackState): Timeline | null {
  const nextCounts = counts(next);
  if (nextCounts.length === 0 || next.dealer_hand.cards.length < 2) return null;
  const b = new TimelineBuilder();
  let part: PlayerPart | null;
  if (prev.phase !== "player") {
    part = planDeal(b, next);
  } else {
    const pCounts = counts(prev);
    const k = Math.min(prev.active_hand_index, Math.max(0, pCounts.length - 1));
    // The same dealer cards so far, the hole card still face down.
    const base: Stage = { ...fullStage(prev), holeDown: true, settled: false };
    const dealerSame = prev.dealer_hand.cards.length === next.dealer_hand.cards.length;
    if (!dealerSame && next.phase === "player") part = null;
    else if (nextCounts.length === pCounts.length + 1) part = planSplit(b, base, k, pCounts, next);
    else if (nextCounts.length === pCounts.length) part = planPlay(b, base, k, pCounts, next);
    else part = null;
  }
  if (part === null) return null;
  const settles = showsResult(next.phase);
  const resultAt = settles ? planDealerTurn(b, part.landed, next) : null;
  return b.build(part.start, fullStage(next), part.slideMs, settles, resultAt);
}

// ── What the felt draws ───────────────────────────────────────────────────────

const engineCard = (c: CardResponse) => ({ rank: c.rank, suit: c.suit });

/** A hand of `cards`, its total that of the cards that count (`counts`, by place). */
function shownHand(
  cards: readonly CardResponse[],
  counts: (c: CardResponse, i: number) => boolean
): HandResponse {
  const up = cards.filter((c, i) => !c.face_down && counts(c, i)).map(engineCard);
  return { cards: [...cards], value: handValue(up), soft: isSoftHand(up) };
}

/**
 * The settled round `v`, cut to `stage`: the cards shown so far (the hole card face down until it
 * turns), the totals of the cards landed so far (the dealer's once the hole card has turned), and
 * the result only once it shows. Before the result the felt is drawn in
 * the player's phase (the dealer's total hidden while the hole card is down).
 */
export function stageView(v: BlackjackState, stage: Stage): BlackjackState {
  const dealerCards = v.dealer_hand.cards
    .slice(0, stage.dealer)
    .map((c, i) => (i === 0 && stage.holeDown ? { ...c, face_down: true } : c));
  const hands = stage.hands.map((n, i) =>
    shownHand(v.player_hands[i]?.cards.slice(0, n) ?? [], (_, j) => j < (stage.counted[i] ?? 0))
  );
  const split = hands.length > 1;
  // The whole result from when it shows (the net banner stays the same, #3720 review); each split
  // hand's own result shows as it is revealed (`Stage.revealed`, the felt's `revealedHands`).
  const result = <T>(list: readonly T[]): T[] => (stage.result ? [...list] : []);
  return {
    ...v,
    phase: stage.result ? v.phase : "player",
    dealer_hand: shownHand(
      dealerCards,
      (_, i) => i < stage.dealerCounted && (i > 0 || stage.holeCounted)
    ),
    player_hand: hands[Math.min(stage.active ?? 0, hands.length - 1)] ?? v.player_hand,
    player_hands: hands,
    hand_bets: split ? v.hand_bets.slice(0, hands.length) : v.hand_bets,
    // Every hand played while the dealer plays (none outlined, all dimmed).
    active_hand_index: stage.active ?? hands.length,
    outcome: stage.result ? v.outcome : null,
    payout: stage.result ? v.payout : 0,
    hand_outcomes: result(v.hand_outcomes),
    hand_payouts: result(v.hand_payouts),
  };
}

/** A string that changes whenever what the felt draws does (an events-only change keeps it). */
export function feltSignature(v: BlackjackState): string {
  return JSON.stringify([
    v.phase,
    v.chips,
    v.dealer_hand.cards,
    v.player_hands.map((h) => h.cards),
    v.active_hand_index,
    v.hand_outcomes,
    v.hand_payouts,
    v.outcome,
  ]);
}

// ── Card identity ─────────────────────────────────────────────────────────────

/** Each card's id, by hand: a card keeps its id (and its view) from its deal to the result. */
export interface CardIds {
  readonly dealer: readonly string[];
  readonly hands: readonly (readonly string[])[];
}

/**
 * The ids of `next`'s cards. Within a round (`prev` in the player's phase) a card keeps its id:
 * the dealer's and each hand's cards by place, and a split's second card moves to the new hand
 * (so it slides there instead of being dealt again). New cards, and every card of a new round or
 * of a state no action made (`prev` null), get new ids from `fresh`.
 */
export function assignCardIds(
  prev: { readonly view: BlackjackState; readonly ids: CardIds } | null,
  next: BlackjackState,
  fresh: () => string
): CardIds {
  const keep = (old: readonly string[] | undefined, n: number) =>
    Array.from({ length: n }, (_, i) => old?.[i] ?? fresh());
  const same = prev !== null && prev.view.phase === "player";
  if (!same) {
    return {
      dealer: keep(undefined, next.dealer_hand.cards.length),
      hands: next.player_hands.map((h) => keep(undefined, h.cards.length)),
    };
  }
  const dealer = keep(prev.ids.dealer, next.dealer_hand.cards.length);
  let old: (readonly string[] | undefined)[] = [...prev.ids.hands];
  if (next.player_hands.length === old.length + 1) {
    const k = Math.min(prev.view.active_hand_index, Math.max(0, old.length - 1));
    const pair = old[k] ?? [];
    old = [...old.slice(0, k), pair.slice(0, 1), pair.slice(1, 2), ...old.slice(k + 1)];
  }
  return { dealer, hands: next.player_hands.map((h, i) => keep(old[i], h.cards.length)) };
}

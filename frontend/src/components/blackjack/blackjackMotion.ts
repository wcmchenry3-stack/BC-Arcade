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
 * same clock. A natural (#3621) is planned with its deal: its moment and sting as the second card
 * lands (`momentAt`, `chimeAt`), and the naturals' edges as stages (`Stage.natural`).
 *
 * See docs/games/blackjack.md ("Motion and sound timing") and the design log,
 * docs/games/arcade-sound-design.md.
 */
import { handValue, isNaturalBlackjack, isSoftHand } from "../../game/blackjack/engine";
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
/** After a split, the hand to play is dealt its second card this long after the tap (mockup). */
export const SPLIT_DEAL_MS = 720;
/** A hand that becomes the one to play is dealt the card it held back this long after (mockup). */
export const ACTIVATE_DEAL_MS = 350;
/**
 * A tap that cuts a result short (owner decision, #3720): the result shows (the rest of the dealer's
 * cards, the banner with its chime, the chips landed and the count) and holds this long before the
 * next action runs, so the player always sees how the hand ended.
 */
export const SKIP_HOLD_MS = 400;
/** How far a push's nudge moves the stake (toward the player) before it settles back. */
export const NUDGE_PX = 14;

// ── The natural (owner decisions, #3739: direction B, "glint + sweep"; #3621) ──

/** The player's second card lands: the natural's moment starts (2 × stagger + flight). */
export const NATURAL_AT_MS = 2 * DEAL_STAGGER_MS + DEAL_FLIGHT_MS;
/** The two cards lift this far: up (ease-out), hold, then down. */
export const NATURAL_LIFT_PX = 7;
export const NATURAL_LIFT_UP_MS = 160;
export const NATURAL_LIFT_HOLD_MS = 520;
export const NATURAL_LIFT_DOWN_MS = 240;
/** The gold edge (2 px, an 8 px glow) fades in; it stays until the next deal. */
export const NATURAL_EDGE_IN_MS = 120;
export const NATURAL_EDGE_PX = 2;
export const NATURAL_GLOW_PX = 8;
/** A sheen band crosses each card once. */
export const NATURAL_GLINT_DELAY_MS = 60;
export const NATURAL_GLINT_MS = 380;
/** One diagonal light sweep crosses the felt, at about this peak opacity. */
export const NATURAL_SWEEP_DELAY_MS = 60;
export const NATURAL_SWEEP_MS = 560;
export const NATURAL_SWEEP_DEG = 18;
export const NATURAL_SWEEP_PEAK = 0.14;
/** The whole moment, from the second card's landing (the lift is its longest part). */
export const NATURAL_MOMENT_MS = NATURAL_LIFT_UP_MS + NATURAL_LIFT_HOLD_MS + NATURAL_LIFT_DOWN_MS;
/** The 3:2 payout chip is drawn this much larger, with a gold rim. */
export const NATURAL_CHIP_SCALE = 1.4;

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
  /** A natural's 3:2 payout: drawn larger, with a gold rim (#3621). */
  readonly natural?: boolean;
}

/** The naturals the felt marks (#3621): each a static edge on its hand's two cards. */
export interface NaturalEdges {
  /** The player's natural: a gold edge, until the next deal. */
  readonly player: boolean;
  /** The dealer's natural that beat (or pushed) the player: a cool-silver edge, once turned. */
  readonly dealer: boolean;
}

export const NO_NATURALS: NaturalEdges = { player: false, dealer: false };

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
  /** The naturals marked so far (#3621). */
  readonly natural: NaturalEdges;
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
  /**
   * When the result's chime plays, or null (none). Usually `resultAt`; a player's natural sounds
   * its sting as the second card lands, before the result shows (#3621). A tap that lands the
   * motion before then still plays it, once.
   */
  readonly chimeAt: number | null;
  /** When the player's natural moment (lift, glint, sweep) starts, or null (#3621). */
  readonly momentAt: number | null;
  /** When the last stage starts (the round is settled from then). */
  readonly endMs: number;
  /** The cards each hand still holds back after it (a split's second card), by hand. */
  readonly held: readonly number[];
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
    natural: naturalEdges(v),
  };
}

/**
 * A shown hand is a natural: two cards that make 21, the engine's own test (`isNaturalBlackjack`)
 * on its cards. Shared with the result's detail line (`feltResultFor`, #3741).
 */
export const isNaturalHand = (h: HandResponse): boolean => isNaturalBlackjack(h.cards);

/**
 * The naturals a settled round marks (#3621, owner decisions in #3739). One hand only: a split
 * hand's ace and ten make 21, not a natural (it pays 1:1). The player's natural gets a gold edge
 * (a 3:2 win, or a push against the dealer's natural). The dealer's natural gets a silver edge
 * when it decided the round: it beat a player who had not bust, or it pushed the player's
 * natural. Under the standard rules (#3741) the dealer peeks, so its natural settles the round at
 * the deal and always decides it (the player has no turn to bust in); it beats any other 21.
 */
export function naturalEdges(v: BlackjackState): NaturalEdges {
  const hand = v.player_hands[0];
  if (!showsResult(v.phase) || v.player_hands.length !== 1 || hand === undefined) {
    return NO_NATURALS;
  }
  const player = isNaturalHand(hand);
  const dealer =
    isNaturalHand(v.dealer_hand) && (player || (v.outcome === "lose" && hand.value <= 21));
  return player || dealer ? { player, dealer } : NO_NATURALS;
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
  chip(ms: number, kind: ChipKind, hand: number, durationMs: number, natural = false): void {
    const chip: ChipShown = {
      id: nextChipId(),
      kind,
      hand,
      durationMs,
      ...(natural ? { natural } : {}),
    };
    this.at(ms, (s) => ({ ...s, chips: [...s.chips, chip] }));
    this.at(ms + durationMs, (s) => ({ ...s, chips: s.chips.filter((c) => c !== chip) }));
  }

  build(
    start: Stage,
    end: Stage,
    slideMs: number,
    flips: boolean,
    times: Pick<Timeline, "resultAt" | "chimeAt" | "momentAt">,
    held: readonly number[]
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
    return { frames, cues, slideMs, flips, ...times, endMs, held };
  }
}

/** The player's part of an action: where the felt starts, and when its last card lands. */
interface PlayerPart {
  readonly start: Stage;
  /** When the player's last card lands: the dealer's turn starts there. */
  readonly landed: number;
  readonly slideMs: number;
  /** The cards each hand holds back after it. */
  readonly held: number[];
  /** A deal: when the player's second card lands (a natural's moment starts there, #3621). */
  readonly secondLanded?: number;
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
    natural: NO_NATURALS,
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
  // The player's second card lands: the one time the deal's total and a natural share (#3621).
  const secondLanded = NATURAL_AT_MS;
  b.at(secondLanded, countHand(0, 2));
  b.at(3 * DEAL_STAGGER_MS + DEAL_FLIGHT_MS, (s) => ({ ...s, dealerCounted: 2 }));
  const landed = 3 * DEAL_STAGGER_MS + DEAL_FLIGHT_MS;
  return { start, landed, slideMs: REFAN_MS, held: [0], secondLanded };
}

/**
 * A split (owner decision, #3720, as the mockup): the pair slides apart (300 ms), the second stake
 * follows from the tray, then only the hand to play is dealt its second card (~720 ms). The new
 * hand keeps its one card until it is played (its second is held back, `Timeline.held`). Split
 * aces, played out at once, are each dealt their card, in hand order.
 */
function planSplit(
  b: TimelineBuilder,
  base: Stage,
  k: number,
  p: { readonly counts: readonly number[]; readonly held: readonly number[] },
  next: BlackjackState
): PlayerPart | null {
  const nextCounts = counts(next);
  const full = [...p.counts.slice(0, k), 1, 1, ...p.counts.slice(k + 1)];
  if (full.some((n, i) => n !== nextCounts[i] && i !== k && i !== k + 1)) return null;
  const before = [...base.hands.slice(0, k), 1, 1, ...base.hands.slice(k + 1)];
  const held = [...p.held.slice(0, k), 0, 0, ...p.held.slice(k + 1)];
  b.chip(SPLIT_SLIDE_MS, "split", k + 1, SPLIT_CHIP_MS);
  b.cue(SPLIT_SLIDE_MS, "chipBet");
  const nextActive = next.phase === "player" ? next.active_hand_index : null;
  const start = { ...base, hands: before, counted: before, active: k };
  let landed = dealTo(b, SPLIT_DEAL_MS, k, nextCounts[k]! - 1, 1);
  const aces = next.player_hands[k]?.cards[0]?.rank === "A";
  if (!aces) {
    // The new hand's second card waits for its turn.
    held[k + 1] = nextCounts[k + 1]! - 1;
    if (nextActive === k) return { start, landed, slideMs: SPLIT_SLIDE_MS, held };
    // The hand to play was dealt 21 and stands on its own (#3764): as its card lands the outline
    // moves on, and the next hand is dealt its card on its own turn, as after a Stand.
    const played =
      nextActive === null
        ? activateRest(b, landed, k + 1, held)
        : activateThrough(b, landed, k + 1, nextActive, held);
    return { start, ...played, slideMs: SPLIT_SLIDE_MS };
  }
  landed = dealTo(b, SPLIT_DEAL_MS + DEAL_STAGGER_MS, k + 1, nextCounts[k + 1]! - 1, 1);
  const played =
    nextActive === null
      ? activateRest(b, landed, k + 2, held)
      : activateThrough(b, landed, k + 2, nextActive, held);
  return { start, ...played, slideMs: SPLIT_SLIDE_MS };
}

/**
 * Deals hand `k`'s cards `from` to `from + n - 1` (by place), the first at `at`, 180 ms apart, each
 * counting as it lands. Returns when the last lands.
 */
function dealTo(b: TimelineBuilder, at: number, k: number, from: number, n: number): number {
  for (let m = 0; m < n; m++) {
    const t = at + m * DEAL_STAGGER_MS;
    const shown = from + m + 1;
    b.at(t, (s) => ({ ...s, hands: s.hands.map((c, i) => (i === k ? shown : c)) }));
    b.cue(t, "deal");
    b.at(t + DEAL_FLIGHT_MS, countHand(k, shown));
  }
  return at + Math.max(0, n - 1) * DEAL_STAGGER_MS + DEAL_FLIGHT_MS;
}

/**
 * Hand `j` becomes the one to play at `at`: it is outlined, and the cards it was holding back (a
 * split's second card) are dealt ~350 ms later, as in the mockup. Returns when they land.
 */
function activate(
  b: TimelineBuilder,
  at: number,
  j: number,
  held: number[]
): { landed: number; held: number[] } {
  b.at(at, (s) => ({ ...s, active: j }));
  const n = held[j] ?? 0;
  if (n === 0) return { landed: at, held };
  const out = held.map((h, i) => (i === j ? 0 : h));
  return { landed: dealToHeld(b, at + ACTIVATE_DEAL_MS, j, n), held: out };
}

/**
 * Play moves on from hand `from` to hand `j` at `at`. A hand passed over on the way was dealt 21
 * and stood on its own (#3764): one still holding its card back is outlined and dealt it first,
 * so the felt never skips a card. Then `j` is outlined and dealt what it holds back.
 */
function activateThrough(
  b: TimelineBuilder,
  at: number,
  from: number,
  j: number,
  held: number[]
): { landed: number; held: number[] } {
  let step = { landed: at, held };
  for (let i = from; i < j; i++) {
    if ((step.held[i] ?? 0) > 0) step = activate(b, step.landed, i, step.held);
  }
  return activate(b, step.landed, j, step.held);
}

/**
 * The round's play is over from hand `from` on (every later hand stood on its own on 21, #3764):
 * each that still holds its card back is outlined and dealt it in turn, before the dealer's turn,
 * so no card is dealt with an earlier hand still outlined.
 */
function activateRest(
  b: TimelineBuilder,
  at: number,
  from: number,
  held: number[]
): { landed: number; held: number[] } {
  let step = { landed: at, held };
  for (let i = from; i < held.length; i++) {
    if ((step.held[i] ?? 0) > 0) step = activate(b, step.landed, i, step.held);
  }
  return step;
}

/** Deals the `n` cards hand `j` held back: they are its last. */
function dealToHeld(b: TimelineBuilder, at: number, j: number, n: number): number {
  for (let m = 0; m < n; m++) {
    const t = at + m * DEAL_STAGGER_MS;
    b.at(t, (s) => ({ ...s, hands: s.hands.map((c, i) => (i === j ? c + 1 : c)) }));
    b.cue(t, "deal");
    b.at(t + DEAL_FLIGHT_MS, (s) => ({
      ...s,
      counted: s.counted.map((c, i) => (i === j ? c + 1 : c)),
    }));
  }
  return at + (n - 1) * DEAL_STAGGER_MS + DEAL_FLIGHT_MS;
}

/** A Hit or a Double (one card for the hand being played), or a Stand (none). */
function planPlay(
  b: TimelineBuilder,
  base: Stage,
  k: number,
  p: { readonly counts: readonly number[]; readonly held: readonly number[] },
  next: BlackjackState
): PlayerPart | null {
  const nextCounts = counts(next);
  const nextActive = next.phase === "player" ? next.active_hand_index : null;
  const grew = nextCounts.findIndex((n, i) => n !== p.counts[i]);
  const held = [...p.held];
  if (grew === -1) {
    // A Stand: the next hand to play is outlined (the rows re-lay) and dealt what it held back,
    // or the dealer plays.
    const start = { ...base, active: k };
    if (nextActive === null) {
      const rest = activateRest(b, 0, k + 1, held);
      return { start, ...rest, slideMs: rest.landed > 0 ? SPLIT_SLIDE_MS : REFAN_MS };
    }
    return { start, ...activateThrough(b, 0, k + 1, nextActive, held), slideMs: SPLIT_SLIDE_MS };
  }
  if (nextCounts.some((n, i) => n !== (i === grew ? p.counts[i]! + 1 : p.counts[i]))) return null;
  b.cue(0, "deal");
  b.at(DEAL_FLIGHT_MS, countHand(grew, base.hands[grew]! + 1));
  const hands = base.hands.map((n, i) => (i === grew ? n + 1 : n));
  const start = { ...base, hands, active: k };
  if (nextActive === k) return { start, landed: DEAL_FLIGHT_MS, slideMs: REFAN_MS, held };
  if (nextActive === null) {
    // The round's play ends here. A later hand that stood on its own on 21 still holding its card
    // is outlined and dealt it before the dealer's turn (#3764).
    const rest = activateRest(b, DEAL_FLIGHT_MS, grew + 1, held);
    if (rest.landed > DEAL_FLIGHT_MS && (next.player_hands[grew]?.value ?? 0) > 21) {
      b.cue(DEAL_FLIGHT_MS, "bust");
    }
    const slideMs = rest.landed > DEAL_FLIGHT_MS ? SPLIT_SLIDE_MS : REFAN_MS;
    return { start, ...rest, slideMs };
  }
  // A split hand is done (bust, doubled, or 21, #3764): the next one is outlined as its card lands.
  if ((next.player_hands[grew]?.value ?? 0) > 21) b.cue(DEAL_FLIGHT_MS, "bust");
  const played = activateThrough(b, DEAL_FLIGHT_MS, grew + 1, nextActive, held);
  return { start, ...played, slideMs: SPLIT_SLIDE_MS };
}

/**
 * The dealer's turn, replayed from the settled round: the hole card turns, each draw ~600 ms
 * after the last, the result ~300 ms after the last card lands, and the chips after it (a split
 * round: one chime for the net, then each hand's tag and chips in turn). Returns when the result
 * shows.
 *
 * A deal that settles at once (a natural: the player's, or the dealer's found by the peek, #3741)
 * starts the turn as the dealer's up card lands: the hole card turns right after the deal.
 *
 * A natural (#3621): the dealer's natural shows its silver edge as the hole card's turn ends. On
 * the player's natural the result shows at the flip's end (no 300 ms wait) and, when it wins 3:2,
 * its chime has already played (the sting, as the second card landed: `stung`) and its payout
 * chip is the larger, gold-rimmed one.
 */
function planDealerTurn(
  b: TimelineBuilder,
  start: number,
  next: BlackjackState,
  held: number[],
  natural: { readonly edges: NaturalEdges; readonly stung: boolean }
): number {
  // A card still held back (none in play: every hand is played first) is dealt before the turn.
  let t0 = start;
  held.forEach((n, j) => {
    if (n > 0) t0 = dealToHeld(b, t0, j, n);
  });
  const shown = 2;
  b.at(t0, (s) => ({ ...s, holeDown: false, active: null }));
  b.cue(t0, "flip");
  // The dealer's total shows once the hole card's face is up (its turn ended).
  b.at(t0 + FLIP_MS, (s) => ({ ...s, holeCounted: true }));
  if (natural.edges.dealer) {
    b.at(t0 + FLIP_MS, (s) => ({ ...s, natural: { ...s.natural, dealer: true } }));
  }
  const draws = next.dealer_hand.cards.length - shown;
  for (let j = 1; j <= draws; j++) {
    const at = t0 + j * DEALER_PACE_MS;
    b.at(at, (s) => ({ ...s, dealer: shown + j }));
    b.cue(at, "deal");
    b.at(at + DEAL_FLIGHT_MS, (s) => ({ ...s, dealerCounted: shown + j }));
  }
  const lastLanding = draws > 0 ? t0 + draws * DEALER_PACE_MS + DEAL_FLIGHT_MS : t0 + FLIP_MS;
  const r = lastLanding + (natural.edges.player ? 0 : RESULT_DELAY_MS);
  const hands = next.player_hands.length;
  const split = hands > 1;
  b.at(r, (s) => ({ ...s, result: true, revealed: split ? 0 : hands }));
  if (!natural.stung) b.cue(r, resultCue(next));
  let settleAt = r;
  for (let i = 0; i < hands; i++) {
    const at = r + CHIP_DELAY_MS + i * HAND_STAGGER_MS;
    const c = chipFor(split ? next.hand_outcomes[i] : next.outcome);
    if (split) b.at(at, (s) => ({ ...s, revealed: i + 1 }));
    b.chip(at, c.kind, i, c.durationMs, natural.stung);
    b.cue(at, c.sound);
    settleAt = Math.max(settleAt, at + c.durationMs);
  }
  b.at(settleAt, (s) => ({ ...s, settled: true }));
  return r;
}

/** `full` with the cards each hand still holds back left out. */
export function withHeld(full: Stage, held: readonly number[]): Stage {
  if (!held.some((n) => n > 0)) return full;
  const hands = full.hands.map((n, i) => n - (held[i] ?? 0));
  return { ...full, hands, counted: hands };
}

/**
 * The motion of the player's action that took the felt from `prev` to `next` (both as the engine
 * settled them), or null when there is none to show: the felt then shows `next` at once (a new
 * hand's betting, or a change no action makes). `held`: the cards each of `prev`'s hands still
 * holds back (a split's second card waiting for its hand's turn), by hand.
 */
export function planMotion(
  prev: BlackjackState,
  next: BlackjackState,
  held: readonly number[] = []
): Timeline | null {
  const nextCounts = counts(next);
  if (nextCounts.length === 0 || next.dealer_hand.cards.length < 2) return null;
  const b = new TimelineBuilder();
  let part: PlayerPart | null;
  if (prev.phase !== "player") {
    part = planDeal(b, next);
  } else {
    const pCounts = counts(prev);
    const pHeld = pCounts.map((_, i) => held[i] ?? 0);
    const p = { counts: pCounts, held: pHeld };
    const k = Math.min(prev.active_hand_index, Math.max(0, pCounts.length - 1));
    // The same dealer cards so far, the hole card still face down; the held cards still held.
    const base: Stage = {
      ...withHeld(fullStage(prev), pHeld),
      holeDown: true,
      settled: false,
    };
    const dealerSame = prev.dealer_hand.cards.length === next.dealer_hand.cards.length;
    if (!dealerSame && next.phase === "player") part = null;
    else if (nextCounts.length === pCounts.length + 1) part = planSplit(b, base, k, p, next);
    else if (nextCounts.length === pCounts.length) part = planPlay(b, base, k, p, next);
    else part = null;
  }
  if (part === null) return null;
  const settles = showsResult(next.phase);
  const nextHeld = settles ? nextCounts.map(() => 0) : part.held;
  const end = withHeld(fullStage(next), nextHeld);
  if (!settles) {
    const times = { resultAt: null, chimeAt: null, momentAt: null };
    return b.build(part.start, end, part.slideMs, false, times, nextHeld);
  }
  // The natural (#3621). Only the opening deal makes the player's (it is the one part with a
  // `secondLanded`): a split hand's 21 is not one.
  const edges = naturalEdges(next);
  const at = edges.player ? (part.secondLanded ?? null) : null;
  // The sting lands with the second card, and is the round's chime (owner decision, #3739).
  const stingAt = at !== null && next.outcome === "blackjack" ? at : null;
  if (at !== null) b.at(at, (s) => ({ ...s, natural: { ...s.natural, player: true } }));
  if (stingAt !== null) b.cue(stingAt, "blackjack");
  const stung = stingAt !== null;
  const natural = { edges: { player: at !== null, dealer: edges.dealer }, stung };
  const resultAt = planDealerTurn(b, part.landed, next, [...part.held], natural);
  const times = { resultAt, chimeAt: stingAt ?? resultAt, momentAt: stingAt };
  return b.build(part.start, end, part.slideMs, true, times, nextHeld);
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

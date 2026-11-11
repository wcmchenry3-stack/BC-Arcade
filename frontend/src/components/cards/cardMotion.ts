/**
 * Card motion and its sound timing, shared by the card games (Solitaire #3572, FreeCell #3573).
 * The values both games' flights and sound cues use live here, with the core of their planners
 * (slot → flight), so the screens, the flight layer (`cardFlights.tsx`) and the tests agree.
 * Each game keeps its own planner (`solitaireMotion.ts`, `freecellMotion.ts`): where its cards
 * lie, and what else moves (Solitaire's turns, draws and recycles).
 *
 * The engines stay instant: an action commits its state at once, and the cards it moved are
 * drawn flying from where they were to where they now are. Every position comes from the
 * table's geometry, never from a measurement: a planner compares the card slots before and
 * after the action. See docs/games/solitaire.md and docs/games/freecell.md (Motion and sound
 * timing) and the design log, docs/games/arcade-sound-design.md.
 */
import type { PlayingCard } from "../../game/_shared/cards/types";
import type { PileCard } from "./pileTypes";

// ── Motion ────────────────────────────────────────────────────────────────────

/** A tapped single card's flight to contact (out-cubic). */
export const TAP_FLIGHT_MS = 200;
/** A run's flight (each card), and the delay between its cards (landing head first). */
export const RUN_FLIGHT_MS = 220;
export const RUN_STAGGER_MS = 15;
/** A dropped card settles from where the ghost was let go to its slot. */
export const DROP_SETTLE_MS = 110;
/**
 * Auto-Complete: each step's card flies this long to its foundation. The steps stay 120 ms
 * apart (the screens' JS timer), so about two cards are in the air.
 */
export const AUTO_FLIGHT_MS = 220;

/**
 * A card still sliding whose flight was called off, or now ends elsewhere, goes on from where it
 * is shown, for what is left of its flight, but never in less than this (a card about to land
 * must not snap).
 */
export const MIN_SLIDE_MS = 100;

/**
 * A flight reports its end from the UI thread (its timing's end callback, through runOnJS). If
 * that never arrives (an animation the system cut short reports `finished: false`), a JS
 * backstop this long after the flight's own end lands it instead, so a card is never left
 * hidden and a held result card is never left waiting.
 */
export const FLIGHT_BACKSTOP_MS = 250;

// ── Sound ─────────────────────────────────────────────────────────────────────

/** Measured peaks of the shared card sound files, in ms from their start (#3572, #3573). */
export const PEAK = {
  /** card-place: about 43 ms. */
  place: 43,
  /** card-flip: about 28 ms. */
  flip: 28,
  /** card-fan: hits at 27 / 66 / 99 ms. */
  fanFirst: 27,
  /** card-multi-move: its landing at 237 ms (pre-hits at 152 / 182 / 208 ms). */
  multiMove: 237,
  /** riffle-settle: 77 ms. */
  riffleSettle: 77,
} as const;

/** Card place is played this long before contact, so its transient lands on it. */
export const PLACE_LEAD_MS = 40;

/** Out-cubic: fast off the mark, settling into the slot. */
export function easeOutCubic(p: number): number {
  "worklet";
  const q = 1 - p;
  return 1 - q * q * q;
}

// ── Flights ───────────────────────────────────────────────────────────────────

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A card's identity: suit and rank (the piles key their views by index, so they are reused). */
export function cardKey(card: { readonly suit: string; readonly rank: number }): string {
  return `${card.suit}-${card.rank}`;
}

/** One card's flight (or turn in place), relative to the action's start. */
export interface FlightSpec {
  readonly key: string;
  /** The card drawn (game-neutral: FreeCell's cards have no `faceUp`, Solitaire's do). */
  readonly card: PileCard;
  readonly from: Point;
  readonly to: Point;
  readonly fromFaceUp: boolean;
  readonly toFaceUp: boolean;
  readonly delayMs: number;
  readonly durationMs: number;
  /**
   * The card's size at each end as a share of the board's card (FreeCell's top row is drawn
   * at 0.92 of the tableau card, #3573). Left out: 1. The flight scales about its top-left
   * corner, so `from` and `to` stay the card's corner at either end.
   */
  readonly fromScale?: number;
  readonly toScale?: number;
  /**
   * The size the flight is drawn at: the destination's own card, so it lands pixel-identical
   * with the card under it (no pop, #3573 owner). Left out: the board's card.
   */
  readonly size?: { readonly width: number; readonly height: number };
}

export interface MotionPlan {
  /** Bottom first: the turns in place, then the moved cards in their landing order. */
  readonly flights: readonly FlightSpec[];
  /** Cards that changed pile (and are seen to). */
  readonly moved: number;
  /** The moved cards' last contact; 0 when nothing moved. */
  readonly contactMs: number;
  /** The first moved card's edge-on point (a draw, a recycle), or null. */
  readonly firstEdgeMs: number | null;
  /** The uncovered card's edge-on point, or null. */
  readonly revealEdgeMs: number | null;
  /**
   * Earlier actions this one called off (it moves a card they had in flight, or lands a turn
   * they planned): their cues go.
   */
  readonly cancelled: readonly number[];
  /** Cards in flight that land where they are shown now (they need not move). */
  readonly settled: readonly string[];
  /**
   * A card turns face up in this plan for a turn an earlier action owed (a reveal or a drawn
   * card re-planned from the face shown): its flip is this action's to play, at `cueTimes().flip`,
   * since the engine's event for it belonged to the action called off.
   */
  readonly owesFlip: boolean;
}

/** A card in flight as it is drawn now, and the action that launched it. */
export interface Shown extends Point {
  readonly faceUp: boolean;
  /** The face its flight ends on. */
  readonly toFaceUp: boolean;
  /** Where its flight ends, and how long it has left. */
  readonly to: Point;
  readonly remainingMs: number;
  readonly action: number;
  /** Its drawn size now, as a share of the board's card; left out for a flight that never scales. */
  readonly scale?: number;
}

// ── The planners' shared core (slot → flight) ─────────────────────────────────

/** Where a card lies on the table. */
export interface Slot<C extends PlayingCard = PlayingCard> {
  readonly card: C;
  /** The pile's id, e.g. "t:3" (a game's own naming). */
  readonly pile: string;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  /** Drawn on the table (a pile's top card, every tableau card). */
  readonly visible: boolean;
  /** Its size as a share of the board's card (FreeCell's top row); 1 when left out. */
  readonly scale?: number;
}

export interface SlotMove<C extends PlayingCard = PlayingCard> {
  readonly from: Slot<C>;
  readonly to: Slot<C>;
}

/**
 * Every card in both boards, in `after`'s order: `moves` changed pile and `flies` says it is
 * seen to; `stays` kept its pile and is drawn where it lies.
 */
export function compareSlots<C extends PlayingCard>(
  before: ReadonlyMap<string, Slot<C>>,
  after: ReadonlyMap<string, Slot<C>>,
  flies: (from: Slot<C>, to: Slot<C>) => boolean
): { moves: SlotMove<C>[]; stays: SlotMove<C>[] } {
  const moves: SlotMove<C>[] = [];
  const stays: SlotMove<C>[] = [];
  for (const [key, to] of after) {
    const from = before.get(key);
    if (from === undefined) continue;
    if (from.pile !== to.pile) {
      if (flies(from, to)) moves.push({ from, to });
    } else if (to.visible) {
      stays.push({ from, to });
    }
  }
  return { moves, stays };
}

/** The kinds of action every card game moves cards with. */
export type MoveKind = "tap" | "drop" | "undo" | "auto";

/** Each moved card's flight time, and the delay between the cards, for `cards` moved cards. */
export function moveTiming(
  kind: MoveKind,
  cards: number
): { durationMs: number; staggerMs: number } {
  const run = cards > 1;
  if (kind === "drop") return { durationMs: DROP_SETTLE_MS, staggerMs: 0 };
  if (kind === "auto") return { durationMs: AUTO_FLIGHT_MS, staggerMs: 0 };
  // A tap, and an Undo (the cards fly back with a tap-move's flight, a run's for two or more).
  return run
    ? { durationMs: RUN_FLIGHT_MS, staggerMs: RUN_STAGGER_MS }
    : { durationMs: TAP_FLIGHT_MS, staggerMs: 0 };
}

/**
 * Where a moved card's flight starts: a drop from where the ghost was let go (its old slot plus
 * the ghost's offset), a card still in flight from where it is shown, otherwise its old slot.
 */
export function launchPoint(from: Point, drop: Point | undefined, shown: Shown | null): Point {
  if (drop) return { x: from.x + drop.x, y: from.y + drop.y };
  if (shown !== null) return { x: shown.x, y: shown.y };
  return { x: from.x, y: from.y };
}

// ── Cues ──────────────────────────────────────────────────────────────────────

/** When each of an action's sounds plays, in ms after the action. */
export interface CueTimes {
  /** Card place: `PLACE_LEAD_MS` before the last contact. */
  readonly place: number;
  /** The multi-card move: its landing peak on the run's last contact. */
  readonly multi: number;
  /** Card flip: its peak on the edge-on point of the reveal's turn, or of a Draw-1 card. */
  readonly flip: number;
  /** The Draw-3 fan: its first hit on the first card's edge-on point. */
  readonly fan: number;
  /** The riffle's settle (and the win; the recycle's settle): its peak on the last contact. */
  readonly settle: number;
  /** The last contact itself: the foundation effect. */
  readonly landed: number;
}

/** Reduce Motion: nothing moves, and every cue is at the instant of the action. */
export const INSTANT_CUES: CueTimes = { place: 0, multi: 0, flip: 0, fan: 0, settle: 0, landed: 0 };

export function cueTimes(plan: MotionPlan): CueTimes {
  const at = (ms: number) => Math.max(0, ms);
  const edge = plan.revealEdgeMs ?? plan.firstEdgeMs;
  return {
    place: at(plan.contactMs - PLACE_LEAD_MS),
    multi: at(plan.contactMs - PEAK.multiMove),
    flip: edge === null ? 0 : at(edge - PEAK.flip),
    fan: plan.firstEdgeMs === null ? 0 : at(plan.firstEdgeMs - PEAK.fanFirst),
    settle: at(plan.contactMs - PEAK.riffleSettle),
    landed: plan.contactMs,
  };
}

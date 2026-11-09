/**
 * Solitaire card motion and its sound timing (#3572, owner decision "A. Brisk", 2026-11-09).
 * Every value the flights and the sound cues use lives here, so the screen, the flight layer
 * and the tests agree. See docs/games/solitaire.md (Motion and sound timing) and the design log,
 * docs/games/arcade-sound-design.md.
 *
 * The engine stays instant: an action commits its state at once, and the cards it moved are
 * drawn flying from where they were to where they now are by the board's flight layer
 * (`cardFlights.tsx`). Every position here comes from the table geometry (`tableLayout`), never
 * from a measurement: the planner below compares the card slots before and after the action.
 */
import { SUITS, type Card, type SolitaireState } from "../../game/solitaire/types";

// ── Motion ────────────────────────────────────────────────────────────────────

/** A tapped single card's flight to contact (out-cubic). */
export const TAP_FLIGHT_MS = 200;
/** A tableau run's flight (each card), and the delay between its cards. */
export const RUN_FLIGHT_MS = 220;
export const RUN_STAGGER_MS = 15;
/** A dropped card settles from where the ghost was let go to its slot. */
export const DROP_SETTLE_MS = 110;
/** The uncovered card's turn, right after the moved card lands (no gap). */
export const REVEAL_TURN_MS = 140;
/** A stock draw: each card slides from the stock to the waste and turns on the way. */
export const DRAW_MS = 200;
/** Draw 3: the delay between the three cards (the fan's hits are about 36 ms apart). */
export const DRAW3_STAGGER_MS = 36;
/** The recycle: the waste slides back to the stock (turning face down). */
export const RECYCLE_MS = 220;
/**
 * Auto-Complete: each step's card flies this long to its foundation. The steps stay
 * `AUTO_STEP_MS` (120 ms, the screen's JS timer) apart, so about two cards are in the air.
 */
export const AUTO_FLIGHT_MS = 220;

/**
 * A flight reports its end from the UI thread (its timing's end callback, through runOnJS). If
 * that never arrives (an animation the system cut short reports `finished: false`), a JS
 * backstop this long after the flight's own end lands it instead, so a card is never left
 * hidden and a held win modal is never left waiting.
 */
export const FLIGHT_BACKSTOP_MS = 250;

// ── Sound ─────────────────────────────────────────────────────────────────────

/** Measured peaks of the sound files, in ms from their start (#3572 audition). */
export const PEAK = {
  /** card-place: about 43 ms. */
  place: 43,
  /** card-flip: about 28 ms. */
  flip: 28,
  /** card-fan: hits at 27 / 66 / 99 ms. */
  fanFirst: 27,
  /** card-multi-move: its landing at 237 ms. */
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

// ── Geometry ──────────────────────────────────────────────────────────────────

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The board's geometry, in the board's own coordinates (its top-left corner is 0, 0). */
export interface MotionLayout {
  readonly cardWidth: number;
  readonly cardHeight: number;
  /** Gap between neighbouring cards (the tableau's columns, the top row). */
  readonly gap: number;
  /** Gap between the top row and the tableau. */
  readonly rowGap: number;
  /** The board's width: the foundations sit flush with its right edge. */
  readonly boardWidth: number;
  readonly faceDownStep: number;
  /** Draw 3's waste fan step. */
  readonly wasteFanOffset: number;
  /** The face-up step the board draws for a state (it depends on the column heights). */
  readonly faceUpStep: (state: SolitaireState) => number;
}

/** Where a card lies on the table. */
interface Slot {
  readonly card: Card;
  /** "stock", "waste", "f:<suit>" or "t:<column>". */
  readonly pile: string;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  /** Drawn on the table: the top of the stock and of a foundation, the waste's shown cards, every tableau card. */
  readonly visible: boolean;
}

/** A card's identity: suit and rank (the tableau keys its views by index, so they are reused). */
export function cardKey(card: { readonly suit: string; readonly rank: number }): string {
  return `${card.suit}-${card.rank}`;
}

/** Every card's slot in `state`, by `cardKey`. */
function slotsOf(state: SolitaireState, layout: MotionLayout): Map<string, Slot> {
  const slots = new Map<string, Slot>();
  const { cardWidth, cardHeight, gap } = layout;
  state.stock.forEach((card, index) => {
    const visible = index === state.stock.length - 1;
    slots.set(cardKey(card), { card, pile: "stock", index, x: 0, y: 0, visible });
  });
  const shown = state.drawMode === 3 ? 3 : 1;
  const firstShown = Math.max(0, state.waste.length - shown);
  const wasteX = cardWidth + gap;
  state.waste.forEach((card, index) => {
    const fan = Math.max(0, index - firstShown);
    slots.set(cardKey(card), {
      card,
      pile: "waste",
      index,
      x: wasteX + fan * layout.wasteFanOffset,
      y: 0,
      visible: index >= firstShown,
    });
  });
  const foundationX = layout.boardWidth - 4 * cardWidth - 3 * gap;
  SUITS.forEach((suit, s) => {
    const pile = state.foundations[suit];
    pile.forEach((card, index) => {
      slots.set(cardKey(card), {
        card,
        pile: `f:${suit}`,
        index,
        x: foundationX + s * (cardWidth + gap),
        y: 0,
        visible: index === pile.length - 1,
      });
    });
  });
  const faceUpStep = layout.faceUpStep(state);
  const tableauY = cardHeight + layout.rowGap;
  state.tableau.forEach((column, col) => {
    let y = tableauY;
    column.forEach((card, index) => {
      slots.set(cardKey(card), {
        card,
        pile: `t:${col}`,
        index,
        x: col * (cardWidth + gap),
        y,
        visible: true,
      });
      y += card.faceUp ? faceUpStep : layout.faceDownStep;
    });
  });
  return slots;
}

// ── Planning ──────────────────────────────────────────────────────────────────

/**
 * What kind of action a state change came from: its timing. A stock draw or a recycle is told
 * apart by where the cards go, so Auto-Complete's draw steps slide like a tapped draw.
 */
export type MotionKind = "tap" | "drop" | "undo" | "auto" | "stock";

/** One card's flight (or turn in place), relative to the action's start. */
export interface FlightSpec {
  readonly key: string;
  readonly card: Card;
  readonly from: Point;
  readonly to: Point;
  readonly fromFaceUp: boolean;
  readonly toFaceUp: boolean;
  readonly delayMs: number;
  readonly durationMs: number;
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
  /** Cards in flight already showing the face they need: they land where they are. */
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
}

export interface PlanInput {
  readonly prev: SolitaireState;
  readonly next: SolitaireState;
  readonly kind: MotionKind;
  readonly layout: MotionLayout;
  /** A drop: the ghost's (lifted) offset from where its first card was picked up. */
  readonly drop?: Point;
  /** A card already in flight as it is shown now: a new action re-targets it from there. */
  readonly shownAt?: (key: string) => Shown | null;
}

interface Move {
  readonly from: Slot;
  readonly to: Slot;
}

/** Each moved card's flight time, and the delay between the cards, for an action. */
function timingOf(
  kind: MotionKind,
  moves: readonly Move[]
): { durationMs: number; staggerMs: number } {
  const run = moves.length > 1;
  const any = moves.length > 0;
  if (kind === "drop") return { durationMs: DROP_SETTLE_MS, staggerMs: 0 };
  // Undo flies the cards back with a tap-move's flight (a run's for two or more cards).
  if (kind === "undo") {
    return run
      ? { durationMs: RUN_FLIGHT_MS, staggerMs: RUN_STAGGER_MS }
      : { durationMs: TAP_FLIGHT_MS, staggerMs: 0 };
  }
  if (any && moves.every((m) => m.from.pile === "stock")) {
    return { durationMs: DRAW_MS, staggerMs: DRAW3_STAGGER_MS };
  }
  if (any && moves.every((m) => m.to.pile === "stock")) {
    return { durationMs: RECYCLE_MS, staggerMs: 0 };
  }
  if (kind === "auto") return { durationMs: AUTO_FLIGHT_MS, staggerMs: 0 };
  return run
    ? { durationMs: RUN_FLIGHT_MS, staggerMs: RUN_STAGGER_MS }
    : { durationMs: TAP_FLIGHT_MS, staggerMs: 0 };
}

/**
 * A called-off card still sliding goes on from where it is shown, for what is left of its
 * flight, but never in less than this (a card about to land must not snap).
 */
const MIN_SLIDE_MS = 100;

type Stay =
  | "leave"
  | "settle"
  | {
      readonly fromFaceUp: boolean;
      readonly owesFlip: boolean;
      /** Still sliding: it goes on from here, with no delay. Otherwise it turns in place. */
      readonly slide?: { readonly from: Point; readonly durationMs: number };
    };

/**
 * What a card that stayed in its pile does. A card already in flight goes on from where, and
 * with the face, it is shown, never from the state:
 * - "leave": its flight still ends where and how it should, and its action goes on (or it
 *   already shows the right face);
 * - a slide: it is still moving but its flight was called off or now ends elsewhere (Draw 3's
 *   fan when one of its cards is played on): on from its shown position, turning on the way;
 * - "settle": it sits in its slot showing the right face, but its turn heads the wrong way
 *   (an Undo before a reveal's edge-on point): it lands as it is, and the action that planned
 *   that turn is called off, so its flip never plays;
 * - a turn in place from the face shown (a reveal its new action takes over).
 */
function stayOf(t: Move, s: Shown | null, cancelled: ReadonlySet<number>): Stay {
  const target = t.to.card.faceUp;
  if (s === null) {
    return t.from.card.faceUp === target
      ? "leave"
      : { fromFaceUp: t.from.card.faceUp, owesFlip: false };
  }
  const endsRight = s.to.x === t.to.x && s.to.y === t.to.y && s.toFaceUp === target;
  if (endsRight && (!cancelled.has(s.action) || s.faceUp === target)) return "leave";
  if (s.x !== t.to.x || s.y !== t.to.y) {
    return {
      fromFaceUp: s.faceUp,
      owesFlip: target && !s.faceUp,
      slide: { from: { x: s.x, y: s.y }, durationMs: Math.max(s.remainingMs, MIN_SLIDE_MS) },
    };
  }
  if (s.faceUp === target) return "settle";
  return { fromFaceUp: s.faceUp, owesFlip: target };
}

/**
 * The flights for the action that turned `prev` into `next`. A card flies when it changed pile
 * and is drawn where it lands (or slides back into the stock, the recycle). A card that stayed
 * but turned over (the uncovered card) turns in place once the moved cards have landed; for an
 * Undo, at once.
 *
 * A card still in flight from an earlier action starts from where, and with the face, it is
 * shown. Moving it again calls that earlier action off: its pending sounds are cancelled
 * (`cancelled`), and a turn it had planned is planned again from the face shown now, so a
 * card about to be uncovered and covered again (an Undo mid-flight) never shows its face; if
 * its shown face is already the right one, it just lands (`settled`).
 */
export function planMotion(input: PlanInput): MotionPlan {
  const { prev, next, kind, layout, drop, shownAt } = input;
  const before = slotsOf(prev, layout);
  const after = slotsOf(next, layout);
  const moves: Move[] = [];
  const stays: Move[] = [];
  for (const [key, to] of after) {
    const from = before.get(key);
    if (from === undefined) continue;
    if (from.pile !== to.pile) {
      if (to.visible || (from.visible && to.pile === "stock")) moves.push({ from, to });
    } else if (to.visible) {
      stays.push({ from, to });
    }
  }
  const shown = (slot: Slot) => shownAt?.(cardKey(slot.card)) ?? null;
  const cancelled = new Set<number>();
  for (const m of moves) {
    const s = shown(m.to);
    if (s !== null) cancelled.add(s.action);
  }

  const toStock = moves.length > 0 && moves.every((m) => m.to.pile === "stock");
  const { durationMs, staggerMs } = timingOf(kind, moves);
  // Landing order: down the run, the drawn cards in turn. A recycled waste keeps its old order
  // on the way (its top card stays on top) and lands all at once.
  moves.sort((a, b) => (toStock ? a.from.index - b.from.index : a.to.index - b.to.index));

  let contactMs = 0;
  let firstEdgeMs: number | null = null;
  let owesFlip = false;
  const moved = moves.map((m, i): FlightSpec => {
    const s = shown(m.to);
    const delayMs = i * staggerMs;
    let from: Point = { x: m.from.x, y: m.from.y };
    if (drop) from = { x: from.x + drop.x, y: from.y + drop.y };
    else if (s !== null) from = { x: s.x, y: s.y };
    const fromFaceUp = s?.faceUp ?? m.from.card.faceUp;
    if (s !== null && !fromFaceUp && m.to.card.faceUp) owesFlip = true;
    contactMs = Math.max(contactMs, delayMs + durationMs);
    if (fromFaceUp !== m.to.card.faceUp) {
      const edge = delayMs + durationMs / 2;
      firstEdgeMs = firstEdgeMs === null ? edge : Math.min(firstEdgeMs, edge);
    }
    return {
      key: cardKey(m.to.card),
      card: m.to.card,
      from,
      to: { x: m.to.x, y: m.to.y },
      fromFaceUp,
      toFaceUp: m.to.card.faceUp,
      delayMs,
      durationMs,
    };
  });

  const turnDelay = kind === "undo" ? 0 : contactMs;
  const flights: FlightSpec[] = [];
  const settled: string[] = [];
  const calledOffTurns = new Set<number>();
  let revealEdgeMs: number | null = null;
  for (const t of stays) {
    const key = cardKey(t.to.card);
    const s = shown(t.to);
    const stay = stayOf(t, s, cancelled);
    if (stay === "leave") continue;
    if (stay === "settle") {
      settled.push(key);
      if (s !== null) calledOffTurns.add(s.action);
      continue;
    }
    if (stay.owesFlip) owesFlip = true;
    const at = { x: t.to.x, y: t.to.y };
    const turns = stay.fromFaceUp !== t.to.card.faceUp;
    if (stay.slide) {
      flights.push({
        key,
        card: t.to.card,
        from: stay.slide.from,
        to: at,
        fromFaceUp: stay.fromFaceUp,
        toFaceUp: t.to.card.faceUp,
        delayMs: 0,
        durationMs: stay.slide.durationMs,
      });
      if (turns) {
        const edge = stay.slide.durationMs / 2;
        firstEdgeMs = firstEdgeMs === null ? edge : Math.min(firstEdgeMs, edge);
      }
      continue;
    }
    flights.push({
      key,
      card: t.to.card,
      from: at,
      to: at,
      fromFaceUp: stay.fromFaceUp,
      toFaceUp: t.to.card.faceUp,
      delayMs: turnDelay,
      durationMs: REVEAL_TURN_MS,
    });
    revealEdgeMs = turnDelay + REVEAL_TURN_MS / 2;
  }
  flights.push(...moved);
  return {
    flights,
    moved: moves.length,
    contactMs,
    firstEdgeMs,
    revealEdgeMs,
    cancelled: [...new Set([...cancelled, ...calledOffTurns])],
    settled,
    owesFlip,
  };
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
  /** The last contact itself: the foundation sparkle. */
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

/**
 * Solitaire card motion and its sound timing (#3572, owner decision "A. Brisk", 2026-11-09).
 * The values shared with FreeCell (the flights' timing, the sound peaks, the cue table and the
 * planners' core) are in `components/cards/cardMotion.ts`; this is Solitaire's planner and its
 * own timing (the reveal's turn, the draws and the recycle). See docs/games/solitaire.md
 * (Motion and sound timing) and the design log, docs/games/arcade-sound-design.md.
 *
 * The engine stays instant: an action commits its state at once, and the cards it moved are
 * drawn flying from where they were to where they now are by the board's flight layer
 * (`components/cards/cardFlights.tsx`). Every position here comes from the table geometry
 * (`tableLayout`), never from a measurement: the planner below compares the card slots before
 * and after the action.
 */
import { SUITS, type Card, type SolitaireState } from "../../game/solitaire/types";
import {
  cardKey,
  compareSlots,
  launchPoint,
  MIN_SLIDE_MS,
  moveTiming,
  type FlightSpec,
  type MotionPlan,
  type Point,
  type Shown,
  type Slot as SharedSlot,
  type SlotMove,
} from "../cards/cardMotion";

// ── Motion ────────────────────────────────────────────────────────────────────
// The tap, run, drop and Auto-Complete flights are shared with FreeCell (cardMotion.ts).

/** The uncovered card's turn, right after the moved card lands (no gap). */
export const REVEAL_TURN_MS = 140;
/** A stock draw: each card slides from the stock to the waste and turns on the way. */
export const DRAW_MS = 200;
/** Draw 3: the delay between the three cards (the fan's hits are about 36 ms apart). */
export const DRAW3_STAGGER_MS = 36;
/** The recycle: the waste slides back to the stock (turning face down). */
export const RECYCLE_MS = 220;

// ── Geometry ──────────────────────────────────────────────────────────────────

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

/** Where a card lies on the table: its pile is "stock", "waste", "f:<suit>" or "t:<column>". */
type Slot = SharedSlot<Card>;

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

type Move = SlotMove<Card>;

/** Each moved card's flight time, and the delay between the cards, for an action. */
function timingOf(
  kind: MotionKind,
  moves: readonly Move[]
): { durationMs: number; staggerMs: number } {
  const any = moves.length > 0;
  // A drop settles; an Undo flies the cards back with a tap-move's flight (a run's for two or more).
  if (kind === "drop" || kind === "undo") return moveTiming(kind, moves.length);
  if (any && moves.every((m) => m.from.pile === "stock")) {
    return { durationMs: DRAW_MS, staggerMs: DRAW3_STAGGER_MS };
  }
  if (any && moves.every((m) => m.to.pile === "stock")) {
    return { durationMs: RECYCLE_MS, staggerMs: 0 };
  }
  return moveTiming(kind === "auto" ? "auto" : "tap", moves.length);
}

type Stay =
  | "leave"
  | "settle"
  | {
      readonly fromFaceUp: boolean;
      readonly owesFlip: boolean;
      /** Still sliding: it goes on from here, with no delay. Otherwise it turns in place. */
      readonly slide?: {
        readonly from: Point;
        readonly durationMs: number;
        /** The action it is in flight for: the slide stays that action's (#3712 review). */
        readonly owner: number;
      };
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
      slide: {
        from: { x: s.x, y: s.y },
        durationMs: Math.max(s.remainingMs, MIN_SLIDE_MS),
        owner: s.action,
      },
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
  // A card flies when it is drawn where it lands, or slides back into the stock (the recycle).
  const { moves, stays } = compareSlots(
    before,
    after,
    (from, to) => to.visible || (from.visible && to.pile === "stock")
  );
  const shown = (slot: Slot) => shownAt?.(cardKey(slot.card)) ?? null;
  const cancelled = new Set<number>();
  // The actions whose cues play a turn of a card this one takes over, when that is not the card's
  // own action (a turning slide, #3712 review): their turn's flip or fan is called off, and this
  // action owes it.
  const turnsTakenOver = new Set<number>();
  for (const m of moves) {
    const s = shown(m.to);
    if (s !== null) cancelled.add(s.action);
    if (s?.turnCuedBy !== undefined) turnsTakenOver.add(s.turnCuedBy);
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
    const from = launchPoint(m.from, drop, s);
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
    if (s?.turnCuedBy !== undefined) turnsTakenOver.add(s.turnCuedBy);
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
        owner: stay.slide.owner,
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
    cancelled: [...new Set([...cancelled, ...calledOffTurns, ...turnsTakenOver])],
    settled,
    owesFlip,
  };
}

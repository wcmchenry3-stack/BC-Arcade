/**
 * FreeCell card motion and its sound timing (#3573, owner decision "A. Match Solitaire",
 * 2026-11-11). The timing, the sound peaks, the cue table and the planners' core are shared
 * with Solitaire (`components/cards/cardMotion.ts`); this is FreeCell's planner: where its
 * cards lie, from the board's geometry. Every card is face up, so nothing turns.
 * See docs/games/freecell.md (Motion and sound timing).
 *
 * The free cells and foundations are drawn at 0.92 of the tableau card (#3607): a card flying
 * between the top row and the tableau scales on the way, drawn at its destination's size so it
 * lands pixel-identical (`FlightSpec.size`, owner).
 */
import { SUITS, type Card, type FreeCellState } from "../../game/freecell/types";
import { faceUpStepFor, type TableGeometry } from "../../game/_shared/cards/tableLayout";
import {
  cardKey,
  compareSlots,
  launchPoint,
  MIN_SLIDE_MS,
  moveTiming,
  type FlightSpec,
  type MotionPlan,
  type MoveKind,
  type Point,
  type Shown,
  type Slot,
} from "../cards/cardMotion";

/** The board's geometry, in the board view's own coordinates (its top-left corner is 0, 0). */
export interface FreeCellMotionLayout {
  /** The tableau's card. */
  readonly cardWidth: number;
  readonly cardHeight: number;
  /** The top row's card (the free cells and foundations). */
  readonly topCardWidth: number;
  readonly topCardHeight: number;
  /** Gap between neighbouring columns (the top row's slots sit over them). */
  readonly gap: number;
  /** The board's padding above the top row. */
  readonly padding: number;
  /** Gap between the top row and the tableau. */
  readonly rowGap: number;
  /** The face-up step the board draws for a state (it depends on the column heights). */
  readonly faceUpStep: (state: FreeCellState) => number;
}

/** The planner's layout for the geometry the board is drawn with (FreeCellBoard's own math). */
export function freeCellMotionLayout(geometry: TableGeometry): FreeCellMotionLayout {
  return {
    cardWidth: geometry.cardWidth,
    cardHeight: geometry.cardHeight,
    topCardWidth: geometry.topCardWidth,
    topCardHeight: geometry.topCardHeight,
    gap: geometry.gap,
    padding: geometry.padding,
    rowGap: geometry.rowGap,
    faceUpStep: (s) =>
      faceUpStepFor(
        geometry,
        s.tableau.map((pile) => ({ down: 0, up: pile.length }))
      ),
  };
}

/** Every card's slot in `state`, by `cardKey`: "c:<cell>", "f:<suit>" or "t:<column>". */
function slotsOf(state: FreeCellState, layout: FreeCellMotionLayout): Map<string, Slot<Card>> {
  const slots = new Map<string, Slot<Card>>();
  const columnX = (i: number) => i * (layout.cardWidth + layout.gap);
  const topScale = layout.topCardWidth / layout.cardWidth;
  state.freeCells.forEach((card, cell) => {
    if (card === null) return;
    slots.set(cardKey(card), {
      card,
      pile: `c:${cell}`,
      index: 0,
      x: columnX(cell),
      y: layout.padding,
      visible: true,
      scale: topScale,
    });
  });
  SUITS.forEach((suit, s) => {
    const pile = state.foundations[suit];
    pile.forEach((card, index) => {
      slots.set(cardKey(card), {
        card,
        pile: `f:${suit}`,
        index,
        x: columnX(4 + s),
        y: layout.padding,
        visible: index === pile.length - 1,
        scale: topScale,
      });
    });
  });
  const step = layout.faceUpStep(state);
  const tableauY = layout.padding + layout.topCardHeight + layout.rowGap;
  state.tableau.forEach((column, col) => {
    column.forEach((card, index) => {
      slots.set(cardKey(card), {
        card,
        pile: `t:${col}`,
        index,
        x: columnX(col),
        y: tableauY + index * step,
        visible: true,
      });
    });
  });
  return slots;
}

/** A flight's size fields: none for a tableau-to-tableau flight (as Solitaire's). */
function scaleOf(
  fromScale: number,
  toScale: number,
  topSize: { readonly width: number; readonly height: number }
): Pick<FlightSpec, "fromScale" | "toScale" | "size"> {
  if (fromScale === 1 && toScale === 1) return {};
  // Drawn at the destination's own size, so it lands pixel-identical (owner).
  return toScale === 1 ? { fromScale, toScale } : { fromScale, toScale, size: topSize };
}

export interface FreeCellPlanInput {
  readonly prev: FreeCellState;
  readonly next: FreeCellState;
  readonly kind: MoveKind;
  readonly layout: FreeCellMotionLayout;
  /** A drop: the ghost's (lifted) offset from where its first card was picked up. */
  readonly drop?: Point;
  /** A card already in flight as it is shown now: a new action re-targets it from there. */
  readonly shownAt?: (key: string) => Shown | null;
}

/**
 * The flights for the action that turned `prev` into `next`. A card flies when it changed pile
 * and is drawn where it lands (a card covered on a foundation is not). A run (a supermove, or
 * the Undo of one) lands head first, 15 ms apart.
 *
 * A card still in flight from an earlier action starts from where, and at the size, it is
 * shown: moving it again calls that earlier action off (`cancelled`: its pending sounds go). A
 * card shown already where it now lies (an Undo before it left, or a run's card still waiting
 * for its stagger) does not fly: it lands where it is (`settled`) and does not count toward the
 * contact, so the landing sound is never late for a card that never moved (#3573). A card
 * still in flight that stays in its pile, but whose slot moved, slides on to its new slot.
 */
export function planFreeCellMotion(input: FreeCellPlanInput): MotionPlan {
  const { prev, next, kind, layout, drop, shownAt } = input;
  const { moves, stays } = compareSlots(
    slotsOf(prev, layout),
    slotsOf(next, layout),
    (_, to) => to.visible
  );
  // Landing order: down the run, head first.
  moves.sort((a, b) => a.to.index - b.to.index);
  const { durationMs, staggerMs } = moveTiming(kind, moves.length);
  const topSize = { width: layout.topCardWidth, height: layout.topCardHeight };

  const flights: FlightSpec[] = [];
  const settled: string[] = [];
  const cancelled = new Set<number>();
  // A card still in flight from an earlier action that stays in its pile, but whose slot this
  // action moved (the board's face-up step changed with a column's height): it slides on from
  // where it is shown to its new slot, as Solitaire's (`stayOf`). Its landing stays its own
  // action's, so it does not count toward this one's contact.
  for (const t of stays) {
    const key = cardKey(t.to.card);
    const s = shownAt?.(key) ?? null;
    if (s === null || (s.to.x === t.to.x && s.to.y === t.to.y)) continue;
    if (s.x === t.to.x && s.y === t.to.y) {
      settled.push(key);
      continue;
    }
    const toScale = t.to.scale ?? 1;
    flights.push({
      key,
      card: t.to.card,
      from: { x: s.x, y: s.y },
      to: { x: t.to.x, y: t.to.y },
      fromFaceUp: true,
      toFaceUp: true,
      delayMs: 0,
      durationMs: Math.max(s.remainingMs, MIN_SLIDE_MS),
      ...scaleOf(s.scale ?? 1, toScale, topSize),
      // It stays its own action's: its landing sound, and a later call-off, go with it.
      owner: s.action,
    });
  }
  let contactMs = 0;
  let moved = 0;
  moves.forEach((m) => {
    const key = cardKey(m.to.card);
    const s = shownAt?.(key) ?? null;
    if (s !== null) cancelled.add(s.action);
    const from = launchPoint(m.from, drop, s);
    const fromScale = drop === undefined && s !== null ? (s.scale ?? 1) : (m.from.scale ?? 1);
    const toScale = m.to.scale ?? 1;
    // A drop always lands: its ghost was let go, even right on the slot (#3712 review).
    if (drop === undefined && from.x === m.to.x && from.y === m.to.y && fromScale === toScale) {
      if (s !== null) settled.push(key);
      return;
    }
    // The stagger counts only the cards that move (a settled card leaves no gap).
    const delayMs = moved * staggerMs;
    contactMs = Math.max(contactMs, delayMs + durationMs);
    moved++;
    flights.push({
      key,
      card: m.to.card,
      from,
      to: { x: m.to.x, y: m.to.y },
      fromFaceUp: true,
      toFaceUp: true,
      delayMs,
      durationMs,
      ...scaleOf(fromScale, toScale, topSize),
    });
  });
  return {
    flights,
    moved,
    contactMs,
    firstEdgeMs: null,
    revealEdgeMs: null,
    cancelled: [...cancelled],
    settled,
    owesFlip: false,
  };
}

/**
 * Drag-start geometry (#3397) — where the ghost card starts, in the
 * DragContainer's local coordinate space.
 *
 * Coordinate spaces in play when a pan activates:
 *
 * - **RNGH gesture space** — `absoluteX/Y` (the finger, relative to the root
 *   view) and `x/y` (the finger relative to the gesture view). So
 *   `absolute - local` is the gesture view's own origin in the same space as
 *   the finger, and is always consistent with where the finger is.
 * - **Reanimated `measure()` page space** — `pageX/Y` of the card wrapper and
 *   of the DragContainer. Both come from the same API at the same instant, so
 *   their difference is the card's position inside the container even when
 *   page space and RNGH space disagree by a constant (e.g. a status bar).
 * - **Container local space** — what DragOverlay draws in
 *   (`translateX/Y` from the container's top-left).
 *
 * The rule: never start the ghost far from the finger. A measured card origin
 * is used only when it agrees with the gesture-derived origin; otherwise the
 * gesture origin wins and the result is flagged `anomalous` for diagnostics.
 *
 * Everything here is a worklet over plain numbers: it runs on the UI thread
 * once, in the pan's `onStart`, never per frame.
 */

export interface PageRect {
  pageX: number;
  pageY: number;
  width: number;
  height: number;
}

/** The last container offset written by DragContainer.onLayout (or an
 *  earlier drag start). `width`/`height` 0 means it was never measured. */
export interface CachedContainer {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GesturePoint {
  absoluteX: number;
  absoluteY: number;
  x: number;
  y: number;
}

export interface DragOriginInput {
  /** `measure(viewRef)` of the card wrapper; null before its first layout. */
  card: PageRect | null;
  /** `measure(containerRef)` taken at drag start; null if it failed. */
  container: PageRect | null;
  cachedContainer: CachedContainer;
  gesture: GesturePoint;
  /** The dragged card's nominal size (dragCards[0]); used when `card` is null. */
  cardSize: { width: number; height: number };
  /** Overrides `dragTolerance(cardSize.height)`. */
  tolerance?: number;
}

export type CardSource = "measured" | "gesture";
export type ContainerSource = "measured" | "cached";

export interface DragOrigin {
  /** Ghost start, container-local. */
  x: number;
  y: number;
  /** The container offset the origin was computed against (page space). */
  containerX: number;
  containerY: number;
  cardSource: CardSource;
  containerSource: ContainerSource;
  /** Measured card origin minus gesture-derived origin (0 when no measure). */
  mismatchX: number;
  mismatchY: number;
  /** Fresh container measure minus the cached offset (0 when no fresh measure). */
  containerDriftX: number;
  containerDriftY: number;
  /** The card measure disagreed with the gesture by more than the tolerance. */
  cardMismatch: boolean;
  /** The finger sits far outside the card rect the origin implies. */
  fingerOutsideCard: boolean;
  /** The origin lies far outside the container's known bounds. */
  originOutsideContainer: boolean;
  /** No fresh container measure and none was ever cached (offset is 0,0). */
  containerUnknown: boolean;
  /** Any of the four flags above. */
  anomalous: boolean;
}

/** Floor of the agreement tolerance. 24 px is the largest `hitSlop` the card
 *  piles use (TableauColumn's buried-card stripe, #1248) and covers sub-pixel
 *  rounding plus SelectableCard's shake transform, none of which is a bug. */
export const MIN_DRAG_TOLERANCE = 24;

/** How far a measured card origin may sit from the gesture-derived one before
 *  it is rejected: max(24, cardHeight / 2). Half a card scales with the card
 *  (FreeCell's 40-wide cards vs Solitaire's 52) and is still far below the
 *  hundreds-of-pixels jump seen in #3397, so a bad measure can't slip through
 *  while ordinary rounding never trips it. */
export function dragTolerance(cardHeight: number): number {
  "worklet";
  return Math.max(MIN_DRAG_TOLERANCE, cardHeight / 2);
}

export function computeDragOrigin(input: DragOriginInput): DragOrigin {
  "worklet";
  const { card, container, cachedContainer, gesture, cardSize } = input;
  const tol = input.tolerance ?? dragTolerance(cardSize.height);

  // Gesture-derived card origin — same space as the finger, always available.
  const gestureX = gesture.absoluteX - gesture.x;
  const gestureY = gesture.absoluteY - gesture.y;

  // Container: a fresh measure beats the cached onLayout value, which can be
  // stale (measured mid navigation transition) or still the initial 0,0.
  let containerX: number;
  let containerY: number;
  let containerW: number;
  let containerH: number;
  let containerSource: ContainerSource;
  let containerDriftX = 0;
  let containerDriftY = 0;
  if (container !== null) {
    containerX = container.pageX;
    containerY = container.pageY;
    containerW = container.width;
    containerH = container.height;
    containerSource = "measured";
    containerDriftX = container.pageX - cachedContainer.x;
    containerDriftY = container.pageY - cachedContainer.y;
  } else {
    containerX = cachedContainer.x;
    containerY = cachedContainer.y;
    containerW = cachedContainer.width;
    containerH = cachedContainer.height;
    containerSource = "cached";
  }
  const containerUnknown = container === null && cachedContainer.width <= 0;

  // Card: the measure is preferred (same API and instant as the container
  // measure) only when it agrees with the gesture-derived origin.
  let pageX = gestureX;
  let pageY = gestureY;
  let cardSource: CardSource = "gesture";
  let mismatchX = 0;
  let mismatchY = 0;
  let cardMismatch = false;
  let cardW = cardSize.width;
  let cardH = cardSize.height;
  if (card !== null) {
    mismatchX = card.pageX - gestureX;
    mismatchY = card.pageY - gestureY;
    if (Math.abs(mismatchX) <= tol && Math.abs(mismatchY) <= tol) {
      pageX = card.pageX;
      pageY = card.pageY;
      cardSource = "measured";
      if (card.width > 0) cardW = card.width;
      if (card.height > 0) cardH = card.height;
    } else {
      cardMismatch = true;
    }
  }

  const x = pageX - containerX;
  const y = pageY - containerY;

  // The finger relative to the card the origin implies. The container term
  // cancels here, so this catches bad gesture-local coordinates, not a stale
  // container (that is what originOutsideContainer / containerUnknown are
  // for). 2 × tol: a hitSlop touch and a tolerated measure offset can stack.
  const fingerX = gesture.absoluteX - pageX;
  const fingerY = gesture.absoluteY - pageY;
  const slack = 2 * tol;
  const fingerOutsideCard =
    fingerX < -slack || fingerX > cardW + slack || fingerY < -slack || fingerY > cardH + slack;

  // The card must start inside the container it is drawn in. Skipped when the
  // container size is unknown.
  const originOutsideContainer =
    containerW > 0 &&
    containerH > 0 &&
    (x < -tol || x > containerW + tol || y < -tol || y > containerH + tol);

  return {
    x,
    y,
    containerX,
    containerY,
    cardSource,
    containerSource,
    mismatchX,
    mismatchY,
    containerDriftX,
    containerDriftY,
    cardMismatch,
    fingerOutsideCard,
    originOutsideContainer,
    containerUnknown,
    anomalous: cardMismatch || fingerOutsideCard || originOutsideContainer || containerUnknown,
  };
}

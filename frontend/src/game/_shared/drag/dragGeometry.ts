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
 *   their difference is the card's position inside the container.
 *
 * RNGH space and page space share an origin in this app: the
 * `GestureHandlerRootView` wraps the whole app at the root (flex 1,
 * `App.tsx`), Android runs edge-to-edge (`edgeToEdgeEnabled=true` in
 * `android/gradle.properties`), and the game screens are not modals. The
 * card cross-check below relies on that. If it is ever broken, the signature
 * is every drag flagged `cardMismatch` with the same `mismatchX/Y` across the
 * trace entries; the remedy is to calibrate that delta, not to widen the
 * tolerance.
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

/** True when a container measure is usable: non-null with a positive size. */
export function isValidContainerMeasure(m: PageRect | null): m is PageRect {
  "worklet";
  return m !== null && m.width > 0 && m.height > 0;
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
  // A fresh measure with no size is as useless as a failed one (a view that
  // is not laid out yet): fall back to the cache.
  const freshContainer = isValidContainerMeasure(container);
  if (freshContainer) {
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
  const containerUnknown = !freshContainer && cachedContainer.width <= 0;

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

// ---------------------------------------------------------------------------
// Rendered-ghost check (#3528)
// ---------------------------------------------------------------------------

/** DragOverlay draws the ghost this many px above `cardY` so the card face
 *  stays visible above the fingertip (`translateY: cardY - GHOST_LIFT`). */
export const GHOST_LIFT = 8;

export interface GhostOffsetInput {
  /** `measure()` of the ghost's Animated.View; null when it isn't laid out. */
  ghost: PageRect | null;
  /** The finger the rendered ghost was drawn for (RNGH `absoluteX/Y`). */
  fingerX: number;
  fingerY: number;
  /** Finger minus the ghost's (unlifted) page origin, recorded at onStart. */
  grabX: number;
  grabY: number;
  /** DragOverlay's upward lift, `GHOST_LIFT`. */
  lift: number;
  /** Base allowed |delta| on either axis, `dragTolerance(cardHeight)`. */
  tol: number;
  /** The finger's last step before the check frame. Added to `tol` per axis:
   *  a ghost one frame behind the finger (Reanimated can hold a frame while
   *  React commits) is lag, not an offset. */
  stepX?: number;
  stepY?: number;
  /** Measure-space expectation: the card's `measure()` page origin at onStart
   *  plus the finger's movement since, i.e. where the (unlifted) ghost should
   *  be if `measure()` page space is right. Null without a card measure. A
   *  constant offset between RNGH `absoluteX/Y` and `measure()` cancels out of
   *  the gesture-space delta (grab comes from the finger) but not this one. */
  measureExpected?: { x: number; y: number } | null;
  /** What DragOverlay asked for: the container offset the drag used and the
   *  ghost's `cardX/cardY`. When the ghost measures at the container origin
   *  although its transform is large, `measure()` ignored the transform. */
  rendered?: { containerX: number; containerY: number; cardX: number; cardY: number } | null;
}

/** `transformIgnored`: the measure did not include the ghost's transform, so
 *  the check can say nothing (breadcrumb only, never an event). */
export type GhostCheckStatus = "ok" | "fail" | "unmeasured" | "transformIgnored";

export interface GhostOffset {
  status: GhostCheckStatus;
  /** Rendered ghost page origin minus where the finger says it should be
   *  drawn (gesture space), px. Positive Y = drawn below. 0 when unmeasured. */
  deltaX: number;
  deltaY: number;
  /** The same against the measure-space expectation; 0 without one. */
  deltaMeasureX: number;
  deltaMeasureY: number;
  /** Which comparison failed. */
  failGesture: boolean;
  failMeasure: boolean;
  /** Where the (unlifted) ghost origin should be: finger − grab, page space. */
  expectedX: number;
  expectedY: number;
}

/**
 * The invariant the player sees (#3528): the ghost is drawn where the finger
 * says it should be. DragOverlay renders the ghost at
 * `container + cardY − lift`, and a correct drag keeps
 * `container + cardY == finger − grab`, so the rendered page origin must be
 * `(finger − grab) − (0, lift)` (gesture space). When the card was measured at
 * onStart it must also sit at `cardMeasured + finger movement − (0, lift)`
 * (measure space). Either delta beyond `tol + |step|` on an axis fails.
 */
export function computeGhostOffset(input: GhostOffsetInput): GhostOffset {
  "worklet";
  const { ghost, fingerX, fingerY, grabX, grabY, lift, tol } = input;
  const expectedX = fingerX - grabX;
  const expectedY = fingerY - grabY;
  const none = {
    deltaX: 0,
    deltaY: 0,
    deltaMeasureX: 0,
    deltaMeasureY: 0,
    failGesture: false,
    failMeasure: false,
    expectedX,
    expectedY,
  };
  if (ghost === null || !Number.isFinite(ghost.pageX) || !Number.isFinite(ghost.pageY)) {
    return { status: "unmeasured", ...none };
  }
  const rendered = input.rendered ?? null;
  if (
    rendered !== null &&
    Math.abs(ghost.pageX - rendered.containerX) < 1 &&
    Math.abs(ghost.pageY - rendered.containerY) < 1 &&
    (Math.abs(rendered.cardX) > tol || Math.abs(rendered.cardY - lift) > tol)
  ) {
    return { status: "transformIgnored", ...none };
  }
  const tolX = tol + Math.abs(input.stepX ?? 0);
  const tolY = tol + Math.abs(input.stepY ?? 0);
  const deltaX = ghost.pageX - expectedX;
  const deltaY = ghost.pageY - (expectedY - lift);
  const failGesture = Math.abs(deltaX) > tolX || Math.abs(deltaY) > tolY;
  const m = input.measureExpected ?? null;
  const deltaMeasureX = m === null ? 0 : ghost.pageX - m.x;
  const deltaMeasureY = m === null ? 0 : ghost.pageY - (m.y - lift);
  const failMeasure = Math.abs(deltaMeasureX) > tolX || Math.abs(deltaMeasureY) > tolY;
  return {
    status: failGesture || failMeasure ? "fail" : "ok",
    deltaX,
    deltaY,
    deltaMeasureX,
    deltaMeasureY,
    failGesture,
    failMeasure,
    expectedX,
    expectedY,
  };
}

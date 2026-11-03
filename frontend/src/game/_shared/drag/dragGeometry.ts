/**
 * Drag geometry.
 *
 * ## Where the ghost is drawn (#3531): finger − grab, nothing else
 *
 * The ghost is drawn by the root `DragGhostHost` (App.tsx), a full-window
 * layer inside `GestureHandlerRootView`, so its origin is RNGH's absolute
 * origin. Its (unlifted) window position is
 *
 *     ghost = finger − grab     (ghostPosition below; the host then lifts
 *                                it GHOST_LIFT px)
 *
 * where `finger` is RNGH `absoluteX/Y` and `grab` is the finger's offset
 * inside the grabbed card at activation, captured once in `onStart` from
 * RNGH itself: `e.x/y` (the gesture view hasn't moved). RNGH resets the
 * translation to 0 when the pan activates (iOS RNPanHandler, Android
 * PanGestureHandler.resetProgress, web), so the ghost starts exactly on the
 * card; the code subtracts `e.translationX/Y` anyway, which is a no-op today
 * and keeps the math right should a translation ever be reported there. The
 * card's own window position is `startFinger − grab` with
 * `startFinger = absolute − translation`: a snap-back springs there and a
 * cancel parks there. Every term is in one coordinate space, so the ghost
 * can't drift from the finger whatever the layout does.
 *
 * Rule: **never position the ghost from a layout measure.** Each earlier
 * fix (#1840, #2154, #3397) patched one of three spaces that had to agree:
 * RNGH gesture space, Reanimated `measure()` page space, and the
 * DragContainer the ghost used to be drawn in. A safe-area/header offset, a
 * stale container measure or a remount mid-drag showed up as a constant
 * card-vs-finger offset (#3527).
 *
 * Coordinate origin: on iOS RNGH `absoluteX/Y` are window coordinates
 * (`locationInView: window`); on Android they are relative to
 * `android.R.id.content` (captured when the handler is prepared); on web they
 * are `clientX/Y` (the viewport). The host is an absoluteFill child of the
 * root view, which fills the window/content view (flex 1 at the app root;
 * Android runs edge-to-edge, `edgeToEdgeEnabled=true`) or the viewport, so
 * the two origins are assumed to coincide. That assumption is verified only
 * on device (#3530). If it fails, the RN surface (where the host and every
 * `measure()` live) is offset from RNGH's origin: the ghost check reports
 * it as a `measureSpace` fail with a consistent delta (#3528, #3531).
 *
 * ## Drag-start diagnostics (#3397): computeDragOrigin
 *
 * `computeDragOrigin` no longer places the ghost. It is kept for the
 * `drag.start` breadcrumb and the `drag.positionMismatch` diagnostics, which
 * ask whether Reanimated `measure()` page space agrees with RNGH space:
 *
 * - **RNGH gesture space**: `absolute − local` is the gesture view's own
 *   origin in the same space as the finger.
 * - **`measure()` page space**: `pageX/Y` of the card wrapper and of the
 *   DragContainer. A card measure far from the gesture origin is flagged
 *   `cardMismatch`; the same `mismatchX/Y` on every drag would be a constant
 *   RNGH-vs-measure() offset (the ghost check's `measureSpace` kind).
 *
 * Everything here is a worklet over plain numbers. computeDragOrigin runs
 * once per drag in `onStart`, never per frame.
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
  /** The card's origin by the accepted source, container-local. Diagnostics
   *  only: the ghost is placed from the finger (#3531). */
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

/**
 * How far the RN surface may sit from RNGH's origin before the ghost check
 * reports it (`failKind: "measureSpace"`, #3531 review 2), in px, on each
 * axis. The surface offset is computed from onStart values only (the card's
 * gesture origin minus its `measure()`), so it has no frame lag and needs no
 * ghost measure; a fixed 12 px sits above every legitimate source and well
 * below a visible offset:
 *
 * | Source                                         | Bias on surfaceOffset |
 * | ---------------------------------------------- | --------------------- |
 * | Selected card: lift −6 and scale 1.03          | y −4 … −8, x ≈ −1     |
 * | Its lift spring overshooting                   | y ≈ −6.6              |
 * | Shake (rejected-move feedback)                 | \|x\| ≤ ~6           |
 * | Sub-pixel rounding                             | < 1                   |
 *
 * A stale card measure (the card moved or remounted) can exceed it once;
 * that is told apart by `measureSpaceConsistent` (dragDiagnostics.ts).
 */
export const SURFACE_OFFSET_TOL = 12;

/** True when a surface offset is known and beyond `tol` on either axis. */
export function surfaceOffsetFails(o: { x: number; y: number } | null, tol: number): boolean {
  "worklet";
  return o !== null && (Math.abs(o.x) > tol || Math.abs(o.y) > tol);
}

/** DragGhostHost draws the ghost this many px above `cardY` so the card face
 *  stays visible above the fingertip (`translateY: cardY - GHOST_LIFT`). */
export const GHOST_LIFT = 8;

/**
 * Where the ghost is drawn (#3531): `finger − grab`, raised `lift` px. Window
 * coordinates (RNGH's absolute origin, shared with the root DragGhostHost).
 * The pan stores the unlifted part in cardX/Y (inline, so onUpdate allocates
 * nothing) and the host applies GHOST_LIFT; the ghost check compares the
 * measured ghost with this.
 */
export function ghostPosition(
  fingerX: number,
  fingerY: number,
  grabX: number,
  grabY: number,
  lift: number
): { x: number; y: number } {
  "worklet";
  return { x: fingerX - grabX, y: fingerY - grabY - lift };
}

export interface GhostOffsetInput {
  /** `measure()` of the ghost's Animated.View; null when it isn't laid out. */
  ghost: PageRect | null;
  /** The finger the rendered ghost was drawn for (RNGH `absoluteX/Y`). */
  fingerX: number;
  fingerY: number;
  /** The finger's offset inside the card at activation (RNGH), recorded at
   *  onStart: the same grab the ghost is positioned with (#3531). */
  grabX: number;
  grabY: number;
  /** DragGhostHost's upward lift, `GHOST_LIFT`. */
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
   *  the gesture-space delta (grab comes from the finger) but not this one.
   *  With the ghost in the root host (#3531) the ghost's own measure is
   *  `finger − grab` in surface coordinates, so when the render check passes
   *  this delta equals the card's gesture origin minus its measure at
   *  onStart: the RN surface's offset from RNGH's origin, which the player
   *  sees as the ghost that far from the finger. */
  measureExpected?: { x: number; y: number } | null;
  /** The lag-free surface signal (#3531 review 2): the card's gesture origin
   *  (`absolute − x` at onStart) minus its `measure()` origin, i.e. where the
   *  RN surface sits in RNGH space. When given (non-null), it alone decides
   *  `failMeasure`, against the fixed `surfaceTol` (SURFACE_OFFSET_TOL), with
   *  no lag term; `deltaMeasure` is still reported. Null without a card
   *  measure: then the measure-space side cannot fail. Omitted (undefined):
   *  the #3528 rule, `deltaMeasure` against `tol + |step|`. */
  surfaceOffset?: { x: number; y: number } | null;
  surfaceTol?: number;
  /** What the host asked for: the origin the ghost is drawn from (the root
   *  host's, 0,0, since #3531) and the ghost's `cardX/cardY`. When the ghost
   *  measures at that origin although its transform is large, `measure()`
   *  ignored the transform. */
  rendered?: { containerX: number; containerY: number; cardX: number; cardY: number } | null;
  /** The finger at onStart (RNGH), when known (#3532). Then the gesture-space
   *  check accepts a ghost drawn for ANY finger position between this and
   *  `fingerX/Y` (the axis-aligned box they span), not only the latest one.
   *  `measure()` reads the shadow tree, which holds the transform of
   *  Reanimated's last commit; under load (a software-rendered emulator, a
   *  slow phone) that commit can be several frames old, so the measured ghost
   *  sits where the finger WAS, along the drag's path. That lag is not an
   *  offset. A constant offset (the host or the ghost drawn N px away from
   *  where the finger says) still lands outside the box unless the finger
   *  has already travelled more than N in the opposite direction, and is
   *  then caught by the next drag that doesn't. Omitted: the latest finger
   *  only (the #3528 rule). */
  pathStartX?: number;
  pathStartY?: number;
}

/** `transformIgnored`: the ghost measured at its host's origin although its
 *  transform is large. With today's Reanimated flags (synchronous UI props off,
 *  `measure()` includes the transform) that is a real render failure (ghost
 *  stuck at the screen's top-left); it is reported as a `transformIgnored` event. */
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
 * says it should be. DragGhostHost renders the ghost at `cardY − lift` from
 * the window origin, and the pan writes `cardY = finger − grab` (#3531), so
 * the rendered page origin must be `ghostPosition(finger, grab, lift)`
 * (gesture space). When the card was measured at
 * onStart it must also sit at `cardMeasured + finger movement − (0, lift)`
 * (measure space). Either delta beyond `tol + |step|` on an axis fails.
 */
/** How far `v` lies outside [min(a, b), max(a, b)] (just `a` without `b`):
 *  0 inside, signed outside. */
function outside(v: number, a: number, b: number | undefined): number {
  "worklet";
  const end = b === undefined ? a : b;
  const lo = Math.min(a, end);
  const hi = Math.max(a, end);
  if (v < lo) return v - lo;
  if (v > hi) return v - hi;
  return 0;
}

export function computeGhostOffset(input: GhostOffsetInput): GhostOffset {
  "worklet";
  const { ghost, fingerX, fingerY, grabX, grabY, lift, tol } = input;
  // Unlifted; the lift is applied per axis below.
  const expected = ghostPosition(fingerX, fingerY, grabX, grabY, 0);
  const expectedX = expected.x;
  const expectedY = expected.y;
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
  // The ghost's unlifted origin as rendered, against the finger path since
  // onStart (or the latest finger alone): the distance outside that range.
  const deltaX = outside(ghost.pageX + grabX, fingerX, input.pathStartX);
  const deltaY = outside(ghost.pageY + lift + grabY, fingerY, input.pathStartY);
  const failGesture = Math.abs(deltaX) > tolX || Math.abs(deltaY) > tolY;
  const m = input.measureExpected ?? null;
  const deltaMeasureX = m === null ? 0 : ghost.pageX - m.x;
  const deltaMeasureY = m === null ? 0 : ghost.pageY - (m.y - lift);
  const failMeasure =
    input.surfaceOffset === undefined
      ? Math.abs(deltaMeasureX) > tolX || Math.abs(deltaMeasureY) > tolY
      : surfaceOffsetFails(input.surfaceOffset, input.surfaceTol ?? SURFACE_OFFSET_TOL);
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

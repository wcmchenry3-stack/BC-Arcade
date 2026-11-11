import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";
import Animated from "react-native-reanimated";
import { useSharedValue, useAnimatedRef, runOnJS, withSpring } from "react-native-reanimated";
import type { SharedValue, AnimatedRef } from "react-native-reanimated";
import * as Sentry from "@sentry/react-native";
import type { CanonicalSuit } from "../decks/types";
import { recordDragStart } from "./dragDiagnostics";
import type { DragDiagnosticTags, DragStartDiagnostics } from "./dragDiagnostics";
import { idleGhostCheck } from "./ghostCheckState";
import type { GhostCheckState } from "./ghostCheckState";
import { clearDragDebugResult, isDragDebugEnabled, noteDragDebugDrop } from "./dragDebug";
import { clearGhost, publishGhost } from "./ghostHost";
import type { GhostHostDrag } from "./ghostHost";
import { createDragStore, IDLE_SNAPSHOT } from "./dragStore";
import type { DragSnapshot, DragStore } from "./dragStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DragCard {
  suit: CanonicalSuit;
  rank: number;
  faceDown?: boolean;
  /** Card size; the root ghost host draws the ghost at this size (#3531). */
  width: number;
  height: number;
  /** This card's top inside the ghost's stack, relative to the first dragged
   *  card: the pile's real offset (a tableau run, #3531). Omitted for a
   *  single card. */
  stackTop?: number;
  /** Compact corner index (#3622): a covered card's stripe in a compressed column. */
  compactIndex?: number;
}

export type DragSource =
  | { game: "solitaire"; type: "tableau"; col: number; fromIndex: number }
  | { game: "solitaire"; type: "waste" }
  | { game: "solitaire"; type: "foundation"; suit: string }
  | { game: "freecell"; type: "tableau"; col: number; fromIndex: number }
  | { game: "freecell"; type: "freecell"; cell: number }
  | { game: "freecell"; type: "foundation"; suit: string };

export interface DragState {
  cards: DragCard[];
  source: DragSource;
}

/**
 * Where the ghost was let go, as its (unlifted) offset from where its first card was picked
 * up: `finger − grab − origin`, in window dp. A board that animates the drop (Solitaire's
 * settle, #3572) starts it from the card's own slot plus this, less `GHOST_LIFT`.
 */
export interface DropOffset {
  readonly dx: number;
  readonly dy: number;
}

/**
 * Return true if the drop was accepted, false to trigger snap-back. `offset` comes with a
 * gesture's drop (DraggableCard); a drop delivered any other way has none.
 */
export type DropHandler = (source: DragSource, cards: DragCard[], offset?: DropOffset) => boolean;

export type Bounds = { x: number; y: number; width: number; height: number };

interface DropZoneEntry {
  onDrop: DropHandler;
  /** Re-measures the zone's window position. Called at drag-start so bounds
   *  reflect the current layout even if onLayout fired before the board settled
   *  (e.g. safe-area insets resolving late on notched iPhones). */
  refreshBounds?: () => void;
}

interface CachedDropZone {
  originalBounds: Bounds;
  inflatedBounds: Bounds;
}

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------

/**
 * The provider's API (#2264): shared values, refs and callbacks. Its identity
 * never changes during a drag, so reading it never re-renders a component on
 * drag start or end. The drag state lives in `store`; read it with
 * `useDragSelector`.
 */
export interface DragApi {
  /** The current drag and its legal zones (#2264). Read with `useDragSelector`
   *  in components, or `store.get()` in callbacks. */
  store: DragStore;

  // Reanimated shared values (readable from worklets)
  /** The ghost's (unlifted) WINDOW position: `finger − grab` (#3531). The
   *  root DragGhostHost draws it there; no layout measure is involved. */
  cardX: SharedValue<number>;
  cardY: SharedValue<number>;
  /** The dragged card's own window position, `startFinger − grab`, from the
   *  same gesture values: where a snap-back returns and a cancel parks. */
  originX: SharedValue<number>;
  originY: SharedValue<number>;
  /** DragContainer's page offset/size: drag-start diagnostics only (#3397).
   *  Never used to position the ghost (#3531). */
  containerOffsetX: SharedValue<number>;
  containerOffsetY: SharedValue<number>;
  /** Last measured container size; 0 until the first measure (#3397). */
  containerWidth: SharedValue<number>;
  containerHeight: SharedValue<number>;
  /** Date.now() of the last container measure; 0 = never (#3397). */
  containerMeasuredAt: SharedValue<number>;

  // Animated ref for the DragContainer — re-measured at drag start for the
  // diagnostics, and on a failed ghost check (#3528). Not for positioning.
  containerRef: AnimatedRef<Animated.View>;
  /** Animated ref on the root DragGhostHost's ghost view, so the pan worklet
   *  can measure where the ghost is actually rendered (#3528). */
  ghostRef: AnimatedRef<Animated.View>;
  /** True while the host's ghost view is mounted (set by DragGhostHost in a
   *  layout effect, cleared on unmount). The ghost check never measures
   *  `ghostRef` unless this is true: before the first mount the UI-side ref
   *  is null and `measure()` would throw (#3528). */
  ghostMounted: SharedValue<boolean>;
  /** The current drag's ghost-check state (#3528). One per provider, not per
   *  card: only one drag runs at a time. UI thread only; see ghostCheckState. */
  ghostCheck: SharedValue<GhostCheckState>;
  /** The finger's offset inside the dragged card (#3531), fixed at onStart.
   *  In the provider (not per card) so the debug overlay can read it (#3529). */
  grabX: SharedValue<number>;
  grabY: SharedValue<number>;
  /** Layout tags for drag diagnostics (#3528); `{}` when none were given. */
  diagnosticTags: DragDiagnosticTags;

  // JS-thread actions
  /** Starts a drag and returns its state, which identifies it to `cancelDrag`.
   *  `origin` is the drag-start geometry from DraggableCard (#3397), used only
   *  for diagnostics. */
  startDrag: (source: DragSource, cards: DragCard[], origin?: DragStartDiagnostics) => DragState;
  /** Hit-tests a drop at the finger; `offset` (a gesture's drop) is handed to the zone that takes it. */
  endDrag: (absoluteX: number, absoluteY: number, offset?: DropOffset) => void;
  snapBackAndClear: () => void;
  /** Ends the current drag immediately (no spring-back) and invalidates any
   *  snap-back still in flight. Used when a gesture can no longer report its
   *  own end: the app leaves the foreground, or the dragged card unmounts.
   *  With `only`, cancels only if that drag (from `startDrag`) is the
   *  current one, so a card can't cancel another card's drag. */
  cancelDrag: (reason: string, only?: DragState) => void;

  // Drop zone registry
  registerDropZone: (id: string, entry: DropZoneEntry) => void;
  unregisterDropZone: (id: string) => void;
  updateDropZoneLayout: (id: string, bounds: Bounds) => void;
}

/** The API plus the current drag state, as `useDragContext` returns it. */
export interface DragContextValue extends DragApi {
  dragState: DragState | null;
  legalTargetIds: ReadonlySet<string>;
}

const DragContext = createContext<DragApi | null>(null);

/** The provider's stable API. A component using only this never re-renders
 *  because a drag started or ended (#2264). */
export function useDragApi(): DragApi {
  const api = useContext(DragContext);
  if (!api) throw new Error("useDragContext must be used within DragProvider");
  return api;
}

/**
 * Selects a value from the drag state (#2264). The component re-renders only
 * when the selected value changes (`Object.is`), so select a primitive (a
 * boolean, a string), not a fresh object. A store change notifies at sync
 * priority; the root DragGhostHost subscribes the same way, so the ghost, the
 * source card and the zone highlights change in one commit.
 */
export function useDragSelector<T>(selector: (s: DragSnapshot) => T): T {
  const { store } = useDragApi();
  const get = () => selector(store.get());
  return useSyncExternalStore(store.subscribe, get, get);
}

/**
 * The API and the current drag state. Re-renders on EVERY drag start and end:
 * for tests and tools only. Board components use `useDragApi` and
 * `useDragSelector` instead (#2264).
 *
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export function useDragContext(): DragContextValue {
  const api = useDragApi();
  const snap = useSyncExternalStore(api.store.subscribe, api.store.get, api.store.get);
  return useMemo(
    () => ({ ...api, dragState: snap.dragState, legalTargetIds: snap.legalTargetIds }),
    [api, snap]
  );
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const SNAP_SPRING = { duration: 250, dampingRatio: 0.8 };
/** Clears a snap-back whose spring callback never arrives (an animation
 *  dropped while the app was inactive, say). Longer than SNAP_SPRING so the
 *  normal path always wins. */
export const SNAP_BACK_FALLBACK_MS = 600;
export interface DragProviderProps {
  children: React.ReactNode;
  getLegalDropIds?: (source: DragSource, cards: DragCard[]) => string[];
  snapRadiusFraction?: number;
  /** Fired once when a drop lands on a drop zone that refuses it (an illegal
   *  move), so a drag gets the same rejection feedback as a tap (#2202). Not
   *  fired for a drop on empty space, a cancelled gesture or an accepted drop. */
  onDropRejected?: (source: DragSource, cards: DragCard[]) => void;
  /** Layout context attached to drag diagnostics events (#3528), e.g.
   *  FreeCell's card size or Solitaire's draw mode. Tags only, never shown. */
  diagnosticTags?: DragDiagnosticTags;
}

const NO_TAGS: DragDiagnosticTags = {};

/** Hands a drop to a zone: with the ghost's offset only when the drop carries one. */
function deliverDrop(entry: DropZoneEntry, state: DragState, offset?: DropOffset): boolean {
  return offset === undefined
    ? entry.onDrop(state.source, state.cards)
    : entry.onDrop(state.source, state.cards, offset);
}

/** For the debug overlay's drop line (#3532): the legal zone whose cached
 *  bounds' centre is nearest the finger, with those bounds; null when no
 *  legal zone has bounds. JS end-of-drag path, debug builds only. */
function nearestLegalZone(
  legalIds: readonly string[],
  bounds: Map<string, CachedDropZone>,
  x: number,
  y: number
): { id: string; bounds: Bounds } | null {
  let best: { id: string; bounds: Bounds } | null = null;
  let bestSq = Infinity;
  for (const id of legalIds) {
    const b = bounds.get(id)?.originalBounds;
    if (!b) continue;
    const dx = x - (b.x + b.width / 2);
    const dy = y - (b.y + b.height / 2);
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) {
      bestSq = sq;
      best = { id, bounds: b };
    }
  }
  return best;
}

/** The debug overlay's snap-back line (#3532); a no-op while it is off. */
function noteSnapBackForDebug(
  hit: string | null,
  zones: number,
  missing: number,
  x: number,
  y: number,
  legalIds: readonly string[],
  bounds: Map<string, CachedDropZone>
): void {
  if (!isDragDebugEnabled()) return;
  noteDragDebugDrop({
    kind: "snapBack",
    hit,
    zones,
    missing,
    fingerX: x,
    fingerY: y,
    near: nearestLegalZone(legalIds, bounds, x, y),
  });
}

export function DragProvider({
  children,
  getLegalDropIds,
  snapRadiusFraction = 0.35,
  onDropRejected,
  diagnosticTags = NO_TAGS,
}: DragProviderProps) {
  const onDropRejectedRef = useRef(onDropRejected);
  useEffect(() => {
    onDropRejectedRef.current = onDropRejected;
  }, [onDropRejected]);
  // Props the callbacks read through a ref, so the callbacks (and with them
  // the context value) keep one identity however the board passes these
  // (#2264). Read on the JS thread at drag start / layout time only.
  const getLegalDropIdsRef = useRef(getLegalDropIds);
  const snapRadiusFractionRef = useRef(snapRadiusFraction);
  useLayoutEffect(() => {
    getLegalDropIdsRef.current = getLegalDropIds;
    snapRadiusFractionRef.current = snapRadiusFraction;
  }, [getLegalDropIds, snapRadiusFraction]);
  // The drag state (#2264): not React state, so the provider never re-renders
  // on a drag. Subscribers select what they draw from it.
  const [store] = useState(createDragStore);

  const cardX = useSharedValue(0);
  const cardY = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const containerOffsetX = useSharedValue(0);
  const containerOffsetY = useSharedValue(0);
  const containerWidth = useSharedValue(0);
  const containerHeight = useSharedValue(0);
  const containerMeasuredAt = useSharedValue(0);
  const containerRef = useAnimatedRef<Animated.View>();
  const ghostRef = useAnimatedRef<Animated.View>();
  const ghostMounted = useSharedValue(false);
  const ghostCheck = useSharedValue<GhostCheckState>(idleGhostCheck);
  const grabX = useSharedValue(0);
  const grabY = useSharedValue(0);
  // Incremented each time a drag starts or is cancelled; a snap-back captures
  // it and only clears if no newer drag has begun since (#2772).
  //
  // This MUST live on the JS thread. It used to be a shared value, but a JS
  // write to a shared value is applied on the UI thread asynchronously and a
  // JS read returns a cached copy until the UI thread has applied it. When a
  // gesture's start and end reach the JS thread back to back (a short flick,
  // a system-cancelled touch, or any moment the JS thread is busy — e.g. the
  // pause/save work an iOS `inactive` transition now triggers, #2750),
  // snapBackAndClear read the *old* generation while the spring callback on
  // the UI thread compared against the *new* one, so clearDrag never ran:
  // the ghost card froze on screen and every drop target kept its highlight.
  const dragGenRef = useRef(0);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dropZonesRef = useRef<Map<string, DropZoneEntry>>(new Map());
  const dropZoneBoundsRef = useRef<Map<string, CachedDropZone>>(new Map());
  const dragStateRef = useRef<DragState | null>(null);
  // The current drag's legal zone ids, for the debug overlay's drop line only.
  const legalIdsRef = useRef<readonly string[]>([]);

  // The drag this provider shows in the root ghost host (#3531). Published
  // and cleared in startDrag / clearDrag, in the same call as the drag store
  // update. Both stores notify at sync priority from the same JS task, so
  // the host's update batches with the source card dimming itself: one
  // commit, no frame with both or neither. Nothing is published between
  // drags.
  const ghostEntryRef = useRef<GhostHostDrag | null>(null);
  const hideGhost = useCallback(() => {
    if (ghostEntryRef.current === null) return;
    clearGhost(ghostEntryRef.current);
    ghostEntryRef.current = null;
  }, []);
  // A screen unmounting mid-drag takes its ghost with it.
  useEffect(() => hideGhost, [hideGhost]);

  const cancelFallback = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const clearDrag = useCallback(() => {
    cancelFallback();
    dragStateRef.current = null;
    hideGhost();
    store.set(IDLE_SNAPSHOT);
  }, [cancelFallback, hideGhost, store]);

  /** Clears only if no newer drag started since `gen` was captured. */
  const clearIfCurrent = useCallback(
    (gen: number) => {
      if (dragGenRef.current === gen) clearDrag();
    },
    [clearDrag]
  );

  const cancelDrag = useCallback(
    (reason: string, only?: DragState) => {
      if (dragStateRef.current === null) return;
      if (only !== undefined && dragStateRef.current !== only) return;
      const source = dragStateRef.current.source;
      noteDragDebugDrop({ kind: "cancelled", reason });
      dragGenRef.current += 1;
      // Park the ghost at the origin so nothing can flash at the last finger
      // position before the next drag's own onStart writes.
      cardX.value = originX.value;
      cardY.value = originY.value;
      clearDrag();
      Sentry.addBreadcrumb({
        category: "drag",
        level: "info",
        message: "drag.cancelled",
        data: { reason, source: JSON.stringify(source) },
      });
    },
    [cardX, cardY, clearDrag, originX, originY]
  );

  // The app leaving the foreground mid-drag (iOS `inactive` for Control
  // Center, a notification, an edge swipe; or `background`) cancels the touch
  // natively, but that cancel can be lost while the JS thread is suspended or
  // busy with the pause/save work. Drop any drag outright so nothing is left
  // floating on return (#2772).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next !== "active") cancelDrag(`appState:${next}`);
    });
    return () => sub?.remove();
  }, [cancelDrag]);

  useEffect(() => cancelFallback, [cancelFallback]);

  const startDrag = useCallback(
    (source: DragSource, cards: DragCard[], origin?: DragStartDiagnostics) => {
      dragGenRef.current += 1;
      cancelFallback();
      // The previous drag's debug result goes now, synchronously, before any
      // check result for this drag can arrive (#3529).
      clearDragDebugResult();
      const state: DragState = { cards, source };
      dragStateRef.current = state;
      const entry: GhostHostDrag = {
        cards,
        cardX,
        cardY,
        ghostRef,
        ghostMounted,
        debug: { grabX, grabY, ghostCheck },
      };
      ghostEntryRef.current = entry;
      publishGhost(entry);
      const getLegal = getLegalDropIdsRef.current;
      const legalIds = getLegal ? getLegal(source, cards) : [];
      store.set({ dragState: state, legalTargetIds: new Set(legalIds) });
      legalIdsRef.current = legalIds;

      // Re-measure every drop zone at drag-start so the hit-test uses current
      // window coordinates. onLayout + rAF bounds can be stale when safe-area
      // insets or navigation animations settle after the initial render.
      let zonesWithBounds = 0;
      for (const [id, entry] of dropZonesRef.current) {
        entry.refreshBounds?.();
        if (dropZoneBoundsRef.current.has(id)) zonesWithBounds++;
      }

      Sentry.addBreadcrumb({
        category: "drag",
        level: "info",
        message: "drag.start",
        data: {
          source: JSON.stringify(source),
          cards: cards.length,
          legalZones: legalIds.length,
          registeredZones: dropZonesRef.current.size,
          boundsPreRefresh: zonesWithBounds,
          ...(origin
            ? { cardSource: origin.cardSource, containerSource: origin.containerSource }
            : {}),
        },
      });
      if (origin) recordDragStart(origin, source.game, dragGenRef.current);
      return state;
    },
    [cancelFallback, store, cardX, cardY, ghostRef, ghostMounted, grabX, grabY, ghostCheck]
  );

  const snapBackAndClear = useCallback(() => {
    // Nothing to return: the drop already cleared it (onFinalize after an
    // accepted onEnd), or it was cancelled.
    if (dragStateRef.current === null) return;
    // Capture the generation on the JS thread (see dragGenRef). If a new drag
    // begins before the spring finishes, the generation moves on and this
    // snap-back's clear is skipped — the new drag owns the state now.
    const gen = dragGenRef.current;
    cardX.value = withSpring(originX.value, SNAP_SPRING);
    cardY.value = withSpring(originY.value, SNAP_SPRING, () => {
      "worklet";
      runOnJS(clearIfCurrent)(gen);
    });
    // Never let a lost spring callback strand the drag.
    cancelFallback();
    fallbackTimerRef.current = setTimeout(() => {
      fallbackTimerRef.current = null;
      clearIfCurrent(gen);
    }, SNAP_BACK_FALLBACK_MS);
  }, [cancelFallback, cardX, cardY, clearIfCurrent, originX, originY]);

  const endDrag = useCallback(
    (absoluteX: number, absoluteY: number, offset?: DropOffset) => {
      const state = dragStateRef.current;
      if (!state) return;

      const totalZones = dropZonesRef.current.size;
      let missingBounds = 0;
      let hitButRejected = 0;
      let closestZoneId: string | null = null;
      let closestDistanceSq = Infinity;
      let rejectedZoneId: string | null = null;

      // Synchronous hit-test against pre-cached bounds (populated via onLayout in
      // DropTarget, refreshed at drag-start). No async bridge calls at drop time.
      for (const [id, entry] of dropZonesRef.current) {
        const cached = dropZoneBoundsRef.current.get(id);
        if (!cached) {
          missingBounds++;
          continue;
        }

        const { originalBounds, inflatedBounds } = cached;

        const inOriginal =
          absoluteX >= originalBounds.x &&
          absoluteX <= originalBounds.x + originalBounds.width &&
          absoluteY >= originalBounds.y &&
          absoluteY <= originalBounds.y + originalBounds.height;

        if (inOriginal) {
          // Original-bounds hit always takes priority over any inflated-only match.
          const accepted = deliverDrop(entry, state, offset);
          if (accepted) {
            Sentry.addBreadcrumb({
              category: "drag",
              level: "info",
              message: "drag.accepted",
              data: { zone: id, fingerX: absoluteX, fingerY: absoluteY },
            });
            noteDragDebugDrop({ kind: "accepted", zone: id, snapped: false });
            clearDrag();
            return;
          }
          hitButRejected++;
          rejectedZoneId = id;
        } else {
          const inInflated =
            absoluteX >= inflatedBounds.x &&
            absoluteX <= inflatedBounds.x + inflatedBounds.width &&
            absoluteY >= inflatedBounds.y &&
            absoluteY <= inflatedBounds.y + inflatedBounds.height;

          if (inInflated) {
            const centerX = originalBounds.x + originalBounds.width / 2;
            const centerY = originalBounds.y + originalBounds.height / 2;
            const dx = absoluteX - centerX;
            const dy = absoluteY - centerY;
            const distanceSq = dx * dx + dy * dy;

            if (distanceSq < closestDistanceSq) {
              closestZoneId = id;
              closestDistanceSq = distanceSq;
            }
          }
        }
      }

      if (closestZoneId !== null) {
        const entry = dropZonesRef.current.get(closestZoneId)!;
        const accepted = deliverDrop(entry, state, offset);
        if (accepted) {
          Sentry.addBreadcrumb({
            category: "drag",
            level: "info",
            message: "drag.accepted",
            data: {
              zone: closestZoneId,
              fingerX: absoluteX,
              fingerY: absoluteY,
              snappedFromInflated: true,
            },
          });
          noteDragDebugDrop({ kind: "accepted", zone: closestZoneId, snapped: true });
          clearDrag();
          return;
        }
        hitButRejected++;
      }

      // Snap back. Only escalate to a Sentry issue when bounds were missing (a real bug —
      // stale onLayout coords meant the hit-test skipped zones). Normal invalid drops
      // (user moved card to an illegal stack) are breadcrumbs only to avoid Sentry noise.
      if (missingBounds > 0) {
        Sentry.captureMessage("drag.snapBack: missing zone bounds at drop time", {
          level: "info",
          tags: { subsystem: "drag", game: state.source.game },
          extra: {
            source: JSON.stringify(state.source),
            fingerX: absoluteX,
            fingerY: absoluteY,
            totalZones,
            missingBounds,
            hitButRejected,
          },
        });
      } else {
        Sentry.addBreadcrumb({
          category: "drag",
          level: "info",
          message: "drag.snapBack",
          data: {
            source: JSON.stringify(state.source),
            fingerX: absoluteX,
            fingerY: absoluteY,
            totalZones,
            hitButRejected,
          },
        });
      }
      // A non-null closest zone got here only by refusing the card.
      noteSnapBackForDebug(
        rejectedZoneId ?? closestZoneId,
        totalZones,
        missingBounds,
        absoluteX,
        absoluteY,
        legalIdsRef.current,
        dropZoneBoundsRef.current
      );
      if (hitButRejected > 0) onDropRejectedRef.current?.(state.source, state.cards);
      snapBackAndClear();
    },
    [clearDrag, snapBackAndClear]
  );

  const registerDropZone = useCallback((id: string, entry: DropZoneEntry) => {
    dropZonesRef.current.set(id, entry);
  }, []);

  const unregisterDropZone = useCallback((id: string) => {
    dropZonesRef.current.delete(id);
    dropZoneBoundsRef.current.delete(id);
  }, []);

  const updateDropZoneLayout = useCallback((id: string, bounds: Bounds) => {
    const snapRadiusFraction = snapRadiusFractionRef.current;
    const inflatedBounds: Bounds = {
      x: bounds.x - snapRadiusFraction * bounds.width,
      y: bounds.y - snapRadiusFraction * bounds.height,
      width: bounds.width * (1 + 2 * snapRadiusFraction),
      height: bounds.height * (1 + 2 * snapRadiusFraction),
    };
    dropZoneBoundsRef.current.set(id, {
      originalBounds: bounds,
      inflatedBounds,
    });
  }, []);

  // One identity for the provider's life unless `diagnosticTags` changes
  // (#2264): every member is a shared value, a ref, the store or a stable
  // callback.
  const value = useMemo<DragApi>(
    () => ({
      store,
      cardX,
      cardY,
      originX,
      originY,
      containerOffsetX,
      containerOffsetY,
      containerWidth,
      containerHeight,
      containerMeasuredAt,
      containerRef,
      ghostRef,
      ghostMounted,
      ghostCheck,
      grabX,
      grabY,
      diagnosticTags,
      startDrag,
      endDrag,
      snapBackAndClear,
      cancelDrag,
      registerDropZone,
      unregisterDropZone,
      updateDropZoneLayout,
    }),
    [
      store,
      cardX,
      cardY,
      originX,
      originY,
      containerOffsetX,
      containerOffsetY,
      containerWidth,
      containerHeight,
      containerMeasuredAt,
      containerRef,
      ghostRef,
      ghostMounted,
      ghostCheck,
      grabX,
      grabY,
      diagnosticTags,
      startDrag,
      endDrag,
      snapBackAndClear,
      cancelDrag,
      registerDropZone,
      unregisterDropZone,
      updateDropZoneLayout,
    ]
  );

  return <DragContext.Provider value={value}>{children}</DragContext.Provider>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when the given cardSource is part of the currently dragged stack. */
export function isCardInDragStack(activeSource: DragSource, cardSource: DragSource): boolean {
  if (activeSource.game !== cardSource.game || activeSource.type !== cardSource.type) return false;
  switch (activeSource.type) {
    case "tableau":
      return (
        cardSource.type === "tableau" &&
        activeSource.col === cardSource.col &&
        cardSource.fromIndex >= activeSource.fromIndex
      );
    case "freecell":
      return cardSource.type === "freecell" && activeSource.cell === cardSource.cell;
    case "waste":
      return true;
    case "foundation":
      return (
        cardSource.type === "foundation" &&
        (activeSource as { suit: string }).suit === (cardSource as { suit: string }).suit
      );
  }
}

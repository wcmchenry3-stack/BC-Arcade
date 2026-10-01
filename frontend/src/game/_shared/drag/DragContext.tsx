import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";
import Animated from "react-native-reanimated";
import { useSharedValue, useAnimatedRef, runOnJS, withSpring } from "react-native-reanimated";
import type { SharedValue, AnimatedRef } from "react-native-reanimated";
import * as Sentry from "@sentry/react-native";
import type { CanonicalSuit } from "../decks/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DragCard {
  suit: CanonicalSuit;
  rank: number;
  faceDown?: boolean;
  width: number;
  height: number;
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

/** Return true if the drop was accepted, false to trigger snap-back. */
export type DropHandler = (source: DragSource, cards: DragCard[]) => boolean;

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

export interface DragContextValue {
  // React state (JS thread)
  dragState: DragState | null;
  legalTargetIds: Set<string>;

  // Reanimated shared values (readable from worklets)
  cardX: SharedValue<number>;
  cardY: SharedValue<number>;
  originX: SharedValue<number>;
  originY: SharedValue<number>;
  containerOffsetX: SharedValue<number>;
  containerOffsetY: SharedValue<number>;

  // Animated ref for the DragContainer — allows worklets to re-measure it on drag start.
  containerRef: AnimatedRef<Animated.View>;

  // JS-thread actions
  /** Starts a drag and returns its state, which identifies it to `cancelDrag`. */
  startDrag: (source: DragSource, cards: DragCard[]) => DragState;
  endDrag: (absoluteX: number, absoluteY: number) => void;
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

const DragContext = createContext<DragContextValue | null>(null);

export function useDragContext(): DragContextValue {
  const ctx = useContext(DragContext);
  if (!ctx) throw new Error("useDragContext must be used within DragProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const SNAP_SPRING = { duration: 250, dampingRatio: 0.8 };
/** Clears a snap-back whose spring callback never arrives (an animation
 *  dropped while the app was inactive, say). Longer than SNAP_SPRING so the
 *  normal path always wins. */
export const SNAP_BACK_FALLBACK_MS = 600;
const EMPTY_IDS: ReadonlySet<string> = new Set();

export interface DragProviderProps {
  children: React.ReactNode;
  getLegalDropIds?: (source: DragSource, cards: DragCard[]) => string[];
  snapRadiusFraction?: number;
}

export function DragProvider({
  children,
  getLegalDropIds,
  snapRadiusFraction = 0.35,
}: DragProviderProps) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [legalTargetIds, setLegalTargetIds] = useState<Set<string>>(new Set());

  const cardX = useSharedValue(0);
  const cardY = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const containerOffsetX = useSharedValue(0);
  const containerOffsetY = useSharedValue(0);
  const containerRef = useAnimatedRef<Animated.View>();
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

  const cancelFallback = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const clearDrag = useCallback(() => {
    cancelFallback();
    setDragState(null);
    setLegalTargetIds(EMPTY_IDS as Set<string>);
    dragStateRef.current = null;
  }, [cancelFallback]);

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
    (source: DragSource, cards: DragCard[]) => {
      dragGenRef.current += 1;
      cancelFallback();
      const state: DragState = { cards, source };
      dragStateRef.current = state;
      setDragState(state);
      const legalIds = getLegalDropIds ? getLegalDropIds(source, cards) : [];
      setLegalTargetIds(new Set(legalIds));

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
        },
      });
      return state;
    },
    [cancelFallback, getLegalDropIds]
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
    (absoluteX: number, absoluteY: number) => {
      const state = dragStateRef.current;
      if (!state) return;

      const totalZones = dropZonesRef.current.size;
      let missingBounds = 0;
      let hitButRejected = 0;
      let closestZoneId: string | null = null;
      let closestDistanceSq = Infinity;

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
          const accepted = entry.onDrop(state.source, state.cards);
          if (accepted) {
            Sentry.addBreadcrumb({
              category: "drag",
              level: "info",
              message: "drag.accepted",
              data: { zone: id, fingerX: absoluteX, fingerY: absoluteY },
            });
            clearDrag();
            return;
          }
          hitButRejected++;
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
        const accepted = entry.onDrop(state.source, state.cards);
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

  const updateDropZoneLayout = useCallback(
    (id: string, bounds: Bounds) => {
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
    },
    [snapRadiusFraction]
  );

  const value: DragContextValue = {
    dragState,
    legalTargetIds,
    cardX,
    cardY,
    originX,
    originY,
    containerOffsetX,
    containerOffsetY,
    containerRef,
    startDrag,
    endDrag,
    snapBackAndClear,
    cancelDrag,
    registerDropZone,
    unregisterDropZone,
    updateDropZoneLayout,
  };

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

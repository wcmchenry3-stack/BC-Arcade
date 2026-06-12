import React, { createContext, useCallback, useContext, useRef, useState } from "react";
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
  | { game: "freecell"; type: "freecell"; cell: number };

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
  startDrag: (source: DragSource, cards: DragCard[]) => void;
  endDrag: (absoluteX: number, absoluteY: number) => void;
  snapBackAndClear: () => void;

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
  // Incremented each time a new drag starts; the snap-back callback compares
  // against the generation it captured to avoid clearing a superseding drag.
  const dragGeneration = useSharedValue(0);

  const dropZonesRef = useRef<Map<string, DropZoneEntry>>(new Map());
  const dropZoneBoundsRef = useRef<Map<string, CachedDropZone>>(new Map());
  const dragStateRef = useRef<DragState | null>(null);

  const clearDrag = useCallback(() => {
    setDragState(null);
    setLegalTargetIds(new Set());
    dragStateRef.current = null;
  }, []);

  const startDrag = useCallback(
    (source: DragSource, cards: DragCard[]) => {
      dragGeneration.value += 1;
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
    },
    [dragGeneration, getLegalDropIds]
  );

  const snapBackAndClear = useCallback(() => {
    // Capture the generation at the moment snap-back starts. If a new drag
    // begins before the spring callback fires (interrupting it), the generation
    // will have incremented and clearDrag will be skipped — the new drag's own
    // lifecycle owns the cleanup. Without this guard, the snap-back callback
    // could clear a drag that started after this one.
    const gen = dragGeneration.value;
    cardX.value = withSpring(originX.value, SNAP_SPRING);
    cardY.value = withSpring(originY.value, SNAP_SPRING, () => {
      "worklet";
      if (dragGeneration.value === gen) runOnJS(clearDrag)();
    });
  }, [cardX, cardY, clearDrag, dragGeneration, originX, originY]);

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

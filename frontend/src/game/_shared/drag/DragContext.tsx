import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import Animated from "react-native-reanimated";
import { useSharedValue, useAnimatedRef, runOnJS, withSpring } from "react-native-reanimated";
import type { SharedValue, AnimatedRef } from "react-native-reanimated";
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

interface DropZoneEntry {
  getMeasurement: () => { x: number; y: number; width: number; height: number } | null;
  onDrop: DropHandler;
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
}

export function DragProvider({ children, getLegalDropIds }: DragProviderProps) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [legalTargetIds, setLegalTargetIds] = useState<Set<string>>(new Set());

  const cardX = useSharedValue(0);
  const cardY = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const containerOffsetX = useSharedValue(0);
  const containerOffsetY = useSharedValue(0);
  const containerRef = useAnimatedRef<Animated.View>();

  const dropZonesRef = useRef<Map<string, DropZoneEntry>>(new Map());
  const dragStateRef = useRef<DragState | null>(null);

  const clearDrag = useCallback(() => {
    setDragState(null);
    setLegalTargetIds(new Set());
    dragStateRef.current = null;
  }, []);

  const startDrag = useCallback(
    (source: DragSource, cards: DragCard[]) => {
      const state: DragState = { cards, source };
      dragStateRef.current = state;
      setDragState(state);
      if (getLegalDropIds) {
        setLegalTargetIds(new Set(getLegalDropIds(source, cards)));
      }
    },
    [getLegalDropIds]
  );

  const snapBackAndClear = useCallback(() => {
    cardX.value = withSpring(originX.value, SNAP_SPRING);
    cardY.value = withSpring(originY.value, SNAP_SPRING, (finished) => {
      "worklet";
      if (finished) runOnJS(clearDrag)();
    });
  }, [cardX, cardY, clearDrag, originX, originY]);

  const endDrag = useCallback(
    (absoluteX: number, absoluteY: number) => {
      const state = dragStateRef.current;
      if (!state) return;

      for (const [, zone] of dropZonesRef.current) {
        const bounds = zone.getMeasurement();
        if (!bounds) continue;
        if (
          absoluteX >= bounds.x &&
          absoluteX <= bounds.x + bounds.width &&
          absoluteY >= bounds.y &&
          absoluteY <= bounds.y + bounds.height
        ) {
          const accepted = zone.onDrop(state.source, state.cards);
          if (accepted) {
            clearDrag();
            return;
          }
        }
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
  }, []);

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

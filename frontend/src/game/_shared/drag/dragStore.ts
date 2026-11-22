/**
 * The drag state store (#2264, #3554).
 *
 * DragProvider keeps the state that changes when a drag starts and ends (the
 * active drag and its legal drop zones) here, not in React state, so the
 * provider never re-renders on a drag and its context value (the API: shared
 * values, refs and stable callbacks) never changes identity. Components read
 * the store through `useDragSelector` (DragContext.tsx), a
 * `useSyncExternalStore` that re-renders a component only when its own
 * selected value changes: a DraggableCard when "am I in the dragged stack"
 * flips, a DropTarget when its highlight / dim state flips.
 *
 * Without this, each drag start and end re-rendered every DraggableCard and
 * DropTarget on the board (~52 cards and 16 zones in FreeCell) before the
 * ghost could mount, which on a slow phone could outlast a short first drag.
 *
 * JS thread only. Never written per frame: once at a drag's start, once at its
 * end (or cancel).
 */
import type { DragState } from "./DragContext";

export interface DragSnapshot {
  readonly dragState: DragState | null;
  /** Ids of the zones that accept the current drag; empty between drags. */
  readonly legalTargetIds: ReadonlySet<string>;
}

export interface DragStore {
  /** The current snapshot; a new object only when `set` changes it. */
  readonly get: () => DragSnapshot;
  readonly set: (next: DragSnapshot) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

const EMPTY_IDS: ReadonlySet<string> = new Set();
export const IDLE_SNAPSHOT: DragSnapshot = { dragState: null, legalTargetIds: EMPTY_IDS };

export function createDragStore(): DragStore {
  let snapshot = IDLE_SNAPSHOT;
  const listeners = new Set<() => void>();
  return {
    get: () => snapshot,
    set: (next) => {
      if (
        next.dragState === snapshot.dragState &&
        next.legalTargetIds === snapshot.legalTargetIds
      ) {
        return;
      }
      snapshot = next;
      for (const l of listeners) l();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

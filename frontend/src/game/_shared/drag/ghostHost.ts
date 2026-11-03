/**
 * The root ghost host's store (#3531).
 *
 * The drag ghost is drawn by ONE `DragGhostHost`, mounted at the app root
 * inside `GestureHandlerRootView` (App.tsx), so it shares RNGH's absolute
 * coordinate origin: the ghost's window position is `finger − grab` with no
 * layout measure in between (see dragGeometry.ts). The `DragProvider` of the
 * screen being played publishes its active drag here; the host renders it.
 *
 * A module-level store (subscribed to by the host), not a React
 * context: the host sits above the navigator, outside every DragProvider.
 * Only one drag runs at a time, so it holds at most one entry. A provider
 * clears only the entry it published, so a provider unmounting late (a
 * screen popped while another is shown) can't clear another's drag.
 */
import type Animated from "react-native-reanimated";
import type { AnimatedRef, SharedValue } from "react-native-reanimated";
import type { DragCard } from "./DragContext";
import type { GhostCheckState } from "./ghostCheckState";

export interface GhostHostDrag {
  /** The dragged cards; their width/height size the ghost (no
   *  CardSizeContext in the host) and `stackTop` fans a tableau run. */
  readonly cards: readonly DragCard[];
  /** The ghost's (unlifted) window position. */
  readonly cardX: SharedValue<number>;
  readonly cardY: SharedValue<number>;
  /** The publishing provider's ghost ref and mounted flag (#3528 check). */
  readonly ghostRef: AnimatedRef<Animated.View>;
  readonly ghostMounted: SharedValue<boolean>;
  /** What the drag debug overlay reads (#3529); the host ignores it. The
   *  provider's grab and per-drag check state, UI-thread reads only. */
  readonly debug?: {
    readonly grabX: SharedValue<number>;
    readonly grabY: SharedValue<number>;
    readonly ghostCheck: SharedValue<GhostCheckState>;
  };
}

let current: GhostHostDrag | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Shows `drag` in the root host, replacing any other entry. */
export function publishGhost(drag: GhostHostDrag): void {
  if (current === drag) return;
  current = drag;
  emit();
}

/** Removes `drag` from the host if it is still the one shown. */
export function clearGhost(drag: GhostHostDrag): void {
  if (current !== drag) return;
  current = null;
  emit();
}

export function subscribeGhost(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getGhost(): GhostHostDrag | null {
  return current;
}

/**
 * usePourAnimation (#2981) — the Sort screen's one in-flight pour.
 *
 * A pour is `{ from, to, holdMs }` while it animates and `null` otherwise, so
 * "is a pour running" is just `pour !== null`. The move itself lands when the
 * animation ends, never before, on the board the pour was made on:
 *
 *   - Full motion: SortBoard calls `complete()` the moment its ghost overlay
 *     is removed, so the new board and the overlay's removal share a render.
 *   - Reduce Motion: BottleView only tilts and SortBoard never calls back, so
 *     a `reduceMotionMs` timer lands it instead (`complete()` is a no-op).
 *
 * `start` refuses a second pour while one is running (it returns false), and
 * `cancel` drops a pour without landing it (a reset or level change, #2297).
 * The timer is cleared on unmount, so nothing lands on an unmounted screen.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface Pour {
  readonly from: number;
  readonly to: number;
  /** How long the stream runs, in ms (SortBoard's `pourHoldMs`). */
  readonly holdMs: number;
}

interface PendingPour<S> {
  readonly snapshot: S;
  readonly from: number;
  readonly to: number;
}

interface PourAnimationOptions<S> {
  readonly reduceMotion: boolean;
  /** How long a Reduce Motion pour runs before it lands. */
  readonly reduceMotionMs: number;
  /** Lands a pour on the board it was made on (`snapshot`). */
  readonly onLand: (snapshot: S, from: number, to: number) => void;
}

export function usePourAnimation<S>({
  reduceMotion,
  reduceMotionMs,
  onLand,
}: PourAnimationOptions<S>) {
  const [pour, setPour] = useState<Pour | null>(null);
  /** Mirrors `pour` synchronously, so a second tap in the same frame is refused. */
  const activeRef = useRef(false);
  /** The full-motion pour waiting on SortBoard's `complete()`. */
  const pendingRef = useRef<PendingPour<S> | null>(null);
  /** The Reduce Motion pour's landing timer. */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLandRef = useRef(onLand);
  useEffect(() => {
    onLandRef.current = onLand;
  });

  const land = useCallback((p: PendingPour<S>) => {
    activeRef.current = false;
    setPour(null);
    onLandRef.current(p.snapshot, p.from, p.to);
  }, []);

  const start = useCallback(
    (snapshot: S, from: number, to: number, holdMs: number): boolean => {
      if (activeRef.current) return false;
      activeRef.current = true;
      setPour({ from, to, holdMs });
      if (reduceMotion) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          land({ snapshot, from, to });
        }, reduceMotionMs);
      } else {
        pendingRef.current = { snapshot, from, to };
      }
      return true;
    },
    [reduceMotion, reduceMotionMs, land]
  );

  /** SortBoard's `onPourComplete`: lands the pending pour, if there is one. */
  const complete = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    land(pending);
  }, [land]);

  /** Drops the running pour, its animation and its move, without landing it. */
  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    activeRef.current = false;
    setPour(null);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    []
  );

  return { pour, start, complete, cancel };
}

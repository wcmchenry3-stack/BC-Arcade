/**
 * When MahjongScreen writes its game to AsyncStorage (#2961).
 *
 * A tap that only selects a tile, a hint, or the clock starting on the first
 * tap changes nothing worth a write: the save is rewritten only when the
 * board, its undo history or the banked clock change (`samePersisted`). A
 * change made while the clock runs (a match, an undo, a shuffle) is written
 * `SAVE_DEBOUNCE_MS` after the last such change, so a run of quick matches
 * is one write. Any other change (a new deal, a pause, the clock stopping at
 * a deadlock) is written at once: those are rare, and with no running clock
 * to pause, leaving the game wouldn't flush a pending write (below).
 *
 * Nothing waits on the debounce when it matters:
 * - leaving (another screen covers the game, or the app goes to the
 *   background) pauses the running clock, and `saveOnLeave` writes that
 *   paused state at once, superseding the pending write;
 * - the screen setting the game to null (New Game) writes the pending one;
 * - unmounting writes the pending one in the cleanup and cancels the timer,
 *   so no timer can fire after the screen is gone and overwrite the save of
 *   a game another screen has started since;
 * - `discardSave` (the board is finished: a win, or a deadlock recorded as a
 *   loss) cancels the pending write before it clears the slot, so a stale
 *   write can't bring the finished board back.
 *
 * A cleared board is never written: the win clears the save.
 */

import { useCallback, useEffect, useRef } from "react";
import type { MahjongState } from "./types";
import { clearGame, saveGame } from "./storage";

export const SAVE_DEBOUNCE_MS = 500;

/** The fields a save is rewritten for; `selected` and a starting clock aren't among them. */
function samePersisted(a: MahjongState, b: MahjongState): boolean {
  return (
    a.tiles === b.tiles &&
    a.undoStack === b.undoStack &&
    a.accumulatedMs === b.accumulatedMs &&
    a.paused === b.paused &&
    a.shufflesLeft === b.shufflesLeft &&
    a.isDeadlocked === b.isDeadlocked
  );
}

export interface MahjongPersistence {
  /** Write `state` now, superseding any pending write (`usePausableClock`'s `saveOnLeave`). */
  saveNow: (state: MahjongState) => void;
  /** Cancel any pending write and clear the saved game. */
  discardSave: () => void;
}

/**
 * Persist `state` as it changes. Nothing is written until `loadedRef` is
 * true: the mount's load must not be overwritten by the empty first render.
 */
export function useMahjongPersistence(
  state: MahjongState | null,
  loadedRef: { readonly current: boolean }
): MahjongPersistence {
  const savedRef = useRef<MahjongState | null>(null);
  const pendingRef = useRef<MahjongState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = null;
  }, []);

  const write = useCallback(
    (s: MahjongState) => {
      cancel();
      savedRef.current = s;
      saveGame(s).catch(() => {});
    },
    [cancel]
  );

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (pending !== null) write(pending);
  }, [write]);

  useEffect(() => {
    if (!loadedRef.current) return;
    if (state === null) {
      flush();
      return;
    }
    if (state.isComplete) {
      // The win clears the slot: nothing on disk to compare a later state to.
      cancel();
      savedRef.current = null;
      return;
    }
    const saved = savedRef.current;
    if (saved !== null && samePersisted(saved, state)) {
      // Back to what is on disk (a selection on top of it): nothing to write.
      cancel();
      return;
    }
    if (pendingRef.current !== null && samePersisted(pendingRef.current, state)) {
      // A selection on top of the pending write: write the newest state, on
      // the same schedule.
      pendingRef.current = state;
      return;
    }
    if (state.startedAt === null) {
      write(state);
      return;
    }
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    pendingRef.current = state;
    timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [state, loadedRef, cancel, write, flush]);

  // Unmount: write what is pending now, and leave no timer behind.
  useEffect(() => flush, [flush]);

  const saveNow = useCallback(
    (s: MahjongState) => {
      if (loadedRef.current) write(s);
    },
    [loadedRef, write]
  );

  const discardSave = useCallback(() => {
    cancel();
    savedRef.current = null;
    clearGame().catch(() => {});
  }, [cancel]);

  return { saveNow, discardSave };
}

/**
 * When MahjongScreen writes its game to AsyncStorage (#2961).
 *
 * A tap that only selects a tile, a hint, the clock starting on the first
 * tap, or a paused clock resuming changes nothing worth a write: the save is
 * rewritten only when the board, its undo history or the banked clock change
 * (`sameBoard`), or when the save holds a selection the player has since
 * changed or cleared (`saveStands`), so a relaunch never restores a stale
 * selection. A running or a paused clock with the same banked time load the
 * same way (`clockOnLoad`: under way, restarted from the load). A game just
 * read from storage is already saved (`adoptSaved`): a load costs no write.
 * A change made while the clock runs (a match, an undo, a shuffle) is written
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

/**
 * The same board, history and banked time. Neither `startedAt` nor `paused`
 * counts: a clock starting, pausing or resuming with the same banked time
 * loads the same way.
 */
function sameBoard(a: MahjongState, b: MahjongState): boolean {
  return (
    a.tiles === b.tiles &&
    a.undoStack === b.undoStack &&
    a.accumulatedMs === b.accumulatedMs &&
    a.shufflesLeft === b.shufflesLeft &&
    a.isDeadlocked === b.isDeadlocked
  );
}

/**
 * The save of `saved` still stands for `state`: the same board, and no
 * selection on disk that `state` has changed or cleared. A selection made
 * since a save without one isn't worth a write.
 */
function saveStands(saved: MahjongState, state: MahjongState): boolean {
  return (
    sameBoard(saved, state) && (saved.selected === null || saved.selected.id === state.selected?.id)
  );
}

export interface MahjongPersistence {
  /** Write `state` now, superseding any pending write (`usePausableClock`'s `saveOnLeave`). */
  saveNow: (state: MahjongState) => void;
  /** Cancel any pending write and clear the saved game. */
  discardSave: () => void;
  /** Pass a game just read from storage through this before setting it: it is saved already. */
  adoptSaved: (loaded: MahjongState) => MahjongState;
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
    if (saved !== null && saveStands(saved, state)) {
      // What is on disk still stands (a selection or a resume on top of it).
      cancel();
      return;
    }
    if (pendingRef.current !== null && sameBoard(pendingRef.current, state)) {
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

  const adoptSaved = useCallback((loaded: MahjongState) => {
    savedRef.current = loaded;
    return loaded;
  }, []);

  return { saveNow, discardSave, adoptSaved };
}

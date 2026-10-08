import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

/** What a restore hands the screen: the loaded game, or null for a clean slot. */
export type RestoredHandler<T> = (loaded: T | null) => void;

export interface PersistedGameStateOptions<T> {
  /**
   * Reads the saved game, resolving null for a clean slot. Called once, on
   * mount. Anything else the screen reads at the same time (its stats) can
   * load alongside it here.
   */
  load: () => Promise<T | null>;
  /** Writes the game. Called after every state change once the load has landed. */
  save: (state: T) => Promise<unknown>;
  /** Deletes the save: what the returned `clear` calls. */
  clear?: () => Promise<unknown>;
}

export interface PersistedGameState<T> {
  state: T | null;
  setState: Dispatch<SetStateAction<T | null>>;
  /**
   * The latest committed state, for callbacks and timers that can't close
   * over `state`. Written when a commit brings a new state (this hook's
   * effect, so before the effects the screen declares after it). A screen
   * may also write a state it has just set but not yet rendered to it
   * (Solitaire's Auto Complete steps); only the next new state overwrites it.
   */
  stateRef: MutableRefObject<T | null>;
  /** True until the load lands (or fails). */
  loading: boolean;
  /**
   * Becomes true when the load lands, before the loaded state is set. Until
   * then nothing is saved, so a state set early can't overwrite the save
   * still being read.
   */
  hasLoadedRef: { readonly current: boolean };
  /** Deletes the save (`options.clear`), ignoring a failure. */
  clear: () => void;
  /** Set by `useGameRestored`; called once when the load lands. */
  readonly restoredRef: MutableRefObject<RestoredHandler<T> | null>;
}

/**
 * A game screen's saved game (#3087): restored on mount, saved on every
 * change after that. Its state is the screen's game state.
 *
 * - The load runs once, on mount. One that lands after unmount sets nothing.
 * - When it lands, `hasLoadedRef` turns true, the state is set to what it
 *   loaded (null for a clean slot), the screen's `useGameRestored` handler
 *   runs with it, and `loading` ends, all in one batch.
 * - Nothing is saved until the load has landed, so a state set before it (or
 *   the initial null) never overwrites a resumable save.
 * - Every non-null state after that is saved, the loaded one included. A
 *   null state (no game, pre-game) saves nothing: the screen clears the save
 *   itself where it ends a game (`clear`).
 * - A load that rejects ends `loading` and leaves `hasLoadedRef` false, so
 *   the screen saves nothing.
 *
 * The save effect runs where the hook is called, so the screen calls it
 * before its completion effect: a winning move is saved first, and the
 * completion's `clearGame()` then removes it.
 *
 * Throttling and debouncing stay with the screen: Mahjong's debounced saves
 * keep their own hook (`components/mahjong/useMahjongPersistence.ts`).
 */
export function usePersistedGameState<T>(
  options: PersistedGameStateOptions<T>
): PersistedGameState<T> {
  // The latest callbacks, so the mount-only load and stable `clear` read this render's.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const [state, setState] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);
  const stateRef = useRef<T | null>(null);
  const restoredRef = useRef<RestoredHandler<T> | null>(null);

  useEffect(() => {
    let alive = true;
    optionsRef.current.load().then(
      (loaded) => {
        if (!alive) return;
        hasLoadedRef.current = true;
        setState(loaded);
        restoredRef.current?.(loaded);
        setLoading(false);
      },
      () => {
        if (alive) setLoading(false);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    stateRef.current = state;
    if (!hasLoadedRef.current || state === null) return;
    optionsRef.current.save(state).catch(() => {});
  }, [state]);

  const clear = useCallback(() => {
    optionsRef.current.clear?.().catch(() => {});
  }, []);

  return { state, setState, stateRef, loading, hasLoadedRef, clear, restoredRef };
}

/**
 * What the screen does with a restore: called once, when the load lands on a
 * still-mounted screen, with what it loaded (null for a clean slot), just
 * after the state is set to it. The place for the restore's side effects
 * (`syncResume()`, a resumed win's guards, timers) or for a different start:
 * a `setState` here (a fresh deal on a clean slot, a save adjusted by
 * `usePausableClock`'s `adoptLoaded`) replaces the loaded state in the same
 * batch, so only the replacement renders and is saved.
 *
 * A hook of its own, called after `usePersistedGameState`, so the handler can
 * use what the screen builds on that hook's state (the play clock, a deal).
 */
export function useGameRestored<T>(
  game: Pick<PersistedGameState<T>, "restoredRef">,
  onRestored: RestoredHandler<T>
): void {
  const { restoredRef } = game;
  useEffect(() => {
    restoredRef.current = onRestored;
  });
}

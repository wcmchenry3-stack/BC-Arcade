import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

/**
 * What a restore hands the screen: the loaded game, or null for a clean slot,
 * and the load's `info` when it resolved a `LoadResult` (#3127).
 */
export type RestoredHandler<T, I = never> = (loaded: T | null, info: I) => void;

/**
 * A load's game plus what the restore handler needs to know about how it was
 * read (a failure's reason, whether it resumed a save), for a screen whose
 * `load` has more to report than the game (Daily Word, #3127). The load only
 * returns it: acting on it (clearing a stale save, showing an error) is the
 * handler's job, since the handler runs only for the load that lands.
 */
export class LoadResult<T, I> {
  constructor(
    readonly loaded: T | null,
    readonly info: I
  ) {}
}

export interface PersistedGameStateOptions<T, I = never> {
  /**
   * Reads the saved game, resolving null for a clean slot. Called on mount
   * and on each `reload()`. Anything else the screen reads at the same time
   * (its stats) can load alongside it here. With an `I`, it resolves a
   * `LoadResult` whose `info` goes to the `useGameRestored` handler.
   *
   * It must be side-effect-free (#3127): it returns data and writes nothing,
   * no storage and no refs. A load that is dropped (unmount, a later
   * `reload()`, StrictMode's double mount) still runs to the end, so a write
   * in it could land after a newer load's. Side effects go in the
   * `useGameRestored` handler, which runs only for the load that lands.
   */
  load: () => Promise<[I] extends [never] ? T | null : LoadResult<T, I>>;
  /** Writes the game. Called after every state change once the load has landed. */
  save: (state: T) => Promise<unknown>;
  /** Deletes the save: what the returned `clear` calls. */
  clear?: () => Promise<unknown>;
}

export interface PersistedGameState<T, I = never> {
  state: T | null;
  setState: Dispatch<SetStateAction<T | null>>;
  /**
   * The latest committed state, for callbacks and timers that can't close
   * over `state`. Written at layout time when a commit brings a new state,
   * so before any passive effect or later handler reads it. A screen
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
  /**
   * Runs the load again, as on mount: `loading` turns true, and a load still
   * in flight is dropped. For a screen whose load can fail and offers a Retry
   * (Daily Word, #3109). It lands like the first one: the state is set to what
   * it loaded and the `useGameRestored` handler runs again.
   */
  reload: () => void;
  /**
   * Internal: the handler `useGameRestored` registers, called once when the
   * load lands. Screens pass the whole result to `useGameRestored` and never
   * touch this.
   */
  readonly restoredRef: MutableRefObject<RestoredHandler<T, I> | null>;
}

/**
 * A game screen's saved game (#3087): restored on mount, saved on every
 * change after that. Its state is the screen's game state.
 *
 * - The load runs once, on mount, and again on each `reload()`. One that
 *   lands after unmount, or after a later `reload()`, sets nothing. So the
 *   load must be side-effect-free: its side effects go in the restore
 *   handler (#3127).
 * - When it lands, `hasLoadedRef` turns true, the state is set to what it
 *   loaded (null for a clean slot), the screen's `useGameRestored` handler
 *   runs with it, and `loading` ends, all in one batch.
 * - Nothing is saved until the load has landed (the mount load or a
 *   `reload()`), so a state set before it (or the initial null) never
 *   overwrites a resumable save.
 * - Every non-null state after that is saved, the loaded one included. A
 *   null state (no game, pre-game) saves nothing: the screen clears the save
 *   itself where it ends a game (`clear`).
 * - A load that rejects ends `loading` and leaves `hasLoadedRef` false, so
 *   the screen saves nothing.
 *
 * The save effect runs where the hook is called, so the screen calls it
 * before its completion effect (`useCompletionTransition`): a winning move is
 * saved first, and the completion's `clear()` then removes it.
 *
 * Throttling and debouncing stay with the screen: Mahjong's debounced saves
 * keep their own hook (`game/mahjong/useMahjongPersistence.ts`).
 */
export function usePersistedGameState<T, I = never>(
  options: PersistedGameStateOptions<T, I>
): PersistedGameState<T, I> {
  // The latest callbacks, so the mount-only load and stable `clear` read this
  // render's. A layout effect, so a load landing between a commit and its
  // passive effects still reads that commit's callbacks.
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const [state, setState] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);
  const stateRef = useRef<T | null>(null);
  const restoredRef = useRef<RestoredHandler<T, I> | null>(null);

  // Bumped by every load, so only the latest one lands; each load's own
  // `cancelled` drops it after unmount (the alive guard).
  const loadSeqRef = useRef(0);
  const startLoad = useCallback(() => {
    const seq = ++loadSeqRef.current;
    let cancelled = false;
    const alive = () => !cancelled && loadSeqRef.current === seq;
    optionsRef.current.load().then(
      (result) => {
        if (!alive()) return;
        hasLoadedRef.current = true;
        if (result instanceof LoadResult) {
          const { loaded, info } = result as LoadResult<T, I>;
          setState(loaded);
          restoredRef.current?.(loaded, info);
        } else {
          const loaded = result as T | null;
          setState(loaded);
          // No `I`: the handler takes the game alone.
          (restoredRef.current as ((loaded: T | null) => void) | null)?.(loaded);
        }
        setLoading(false);
      },
      () => {
        if (alive()) setLoading(false);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // A reload's load is cancelled on unmount too.
  const cancelLoadRef = useRef<() => void>(() => {});
  useEffect(() => {
    cancelLoadRef.current = startLoad();
    const cancelLoad = cancelLoadRef;
    return () => cancelLoad.current();
  }, [startLoad]);

  // Saves pause until the reload lands, so a state set meanwhile never
  // overwrites the save being reloaded.
  const reload = useCallback(() => {
    hasLoadedRef.current = false;
    setLoading(true);
    cancelLoadRef.current = startLoad();
  }, [startLoad]);

  // Mirrored at layout time, so a handler that runs between a commit and its
  // passive effects reads the committed state. Only a new state writes it, so
  // a state the screen wrote ahead of its commit survives other re-renders.
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!hasLoadedRef.current || state === null) return;
    optionsRef.current.save(state).catch(() => {});
  }, [state]);

  const clear = useCallback(() => {
    optionsRef.current.clear?.().catch(() => {});
  }, []);

  return { state, setState, stateRef, loading, hasLoadedRef, clear, reload, restoredRef };
}

/**
 * What the screen does with a restore: called once, when the load lands on a
 * still-mounted screen, with what it loaded (null for a clean slot) and the
 * load's `info` (when it resolved a `LoadResult`), just after the state is
 * set to it. Only the load that lands calls it, never a dropped one, so it is
 * the place for the restore's side effects (`syncResume()`, a resumed win's
 * guards, timers, clearing a stale save, #3127) or for a different start:
 * a `setState` here (a fresh deal on a clean slot, a save adjusted by
 * `usePausableClock`'s `adoptLoaded`) replaces the loaded state in the same
 * batch, so only the replacement renders and is saved.
 *
 * A hook of its own, called after `usePersistedGameState`, so the handler can
 * use what the screen builds on that hook's state (the play clock, a deal).
 */
export function useGameRestored<T, I = never>(
  game: Pick<PersistedGameState<T, I>, "restoredRef">,
  onRestored: RestoredHandler<T, I>
): void {
  const { restoredRef } = game;
  // A layout effect, so a load landing before this commit's passive effects
  // flush still calls this render's handler.
  useLayoutEffect(() => {
    restoredRef.current = onRestored;
  });
}

import { useEffect, useRef } from "react";

/**
 * An engine event: either an object tagged by `type` (Hearts, FreeCell,
 * Sudoku, Mahjong) or a bare string literal (2048, Solitaire).
 */
type AnyGameEvent = string | { readonly type: string };

/** The tag an event is dispatched on: the string itself, or its `type`. */
type EventType<T extends AnyGameEvent> = T extends string
  ? T
  : T extends { readonly type: infer K extends string }
    ? K
    : never;

/** The members of `T` whose tag is `K`. */
type EventOfType<T extends AnyGameEvent, K> = T extends string
  ? T extends K
    ? T
    : never
  : T extends { readonly type: K }
    ? T
    : never;

type GameEventHandlers<T extends AnyGameEvent> = {
  [K in EventType<T>]?: (event: EventOfType<T, K>) => void;
};

function typeOf(event: AnyGameEvent): string {
  return typeof event === "string" ? event : event.type;
}

/**
 * Fires registered callbacks for each unprocessed event in `events`, in array
 * order, then calls `onClear` (when given) so the caller can clear the array
 * from game state.
 *
 * Identity-based deduplication: the same array reference is never processed
 * twice, so re-renders between the effect firing and the state update are safe.
 * A state copied with `{ ...state }` (a clock pause or resume) keeps the same
 * array and fires nothing; only an engine action that emits a new array does.
 *
 * `onClear` is optional. Screens that read `events` again after they fire
 * (Solitaire's win cascade), or whose engine replaces the array on every
 * action (2048, Sudoku, Mahjong), leave it in state and rely on the identity
 * check alone.
 */
export function useGameEvents<T extends AnyGameEvent>(
  events: readonly T[] | undefined,
  handlers: GameEventHandlers<T>,
  onClear?: () => void
): void {
  const handlersRef = useRef(handlers);
  const onClearRef = useRef(onClear);
  const lastProcessedRef = useRef<readonly T[] | undefined>(undefined);

  // Keep refs current without adding them to the effect dep array.
  useEffect(() => {
    handlersRef.current = handlers;
    onClearRef.current = onClear;
  });

  useEffect(() => {
    if (!events || events.length === 0 || events === lastProcessedRef.current) return;
    lastProcessedRef.current = events;
    const current = handlersRef.current as Record<string, ((e: T) => void) | undefined>;
    for (const event of events) {
      current[typeOf(event)]?.(event);
    }
    onClearRef.current?.();
  }, [events]);
}

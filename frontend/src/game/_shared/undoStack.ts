/**
 * Capped undo history (#2986).
 *
 * `pushCapped` is the bare bounded push (oldest entry evicted first).
 * `withUndo` is the snapshot form Solitaire and FreeCell use: the previous
 * state, with its own `undoStack` emptied so snapshots never nest, goes on top
 * of the history attached to the next state. Mahjong stores deltas rather than
 * snapshots (#2961), so it uses `pushCapped` directly.
 */

/** Default history depth shared by the card and tile engines. */
export const UNDO_CAP = 50;

/** `stack` with `entry` on top, keeping at most the newest `cap` entries. */
export function pushCapped<E>(stack: readonly E[], entry: E, cap: number = UNDO_CAP): E[] {
  const next = [...stack, entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** A state that carries its own snapshot history. */
export interface Undoable<T> {
  readonly undoStack: readonly T[];
}

/**
 * `next` with an undo history of `prev.undoStack` plus a snapshot of `prev`
 * (its `undoStack` cleared to `[]`), capped at `cap`.
 */
export function withUndo<T extends Undoable<T>>(
  prev: T,
  next: Omit<T, "undoStack">,
  cap: number = UNDO_CAP
): T {
  const snapshot: T = { ...prev, undoStack: [] };
  return { ...next, undoStack: pushCapped(prev.undoStack, snapshot, cap) } as unknown as T;
}

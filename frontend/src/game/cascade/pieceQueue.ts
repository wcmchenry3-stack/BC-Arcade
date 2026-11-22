import { selectNextTier } from "./spawnSelector";

export interface PieceQueue {
  current: number;
  next: number;
}

export function createPieceQueue(history: number[] = [], rng?: () => number): PieceQueue {
  const current = selectNextTier(history, false, rng);
  const next = selectNextTier([...history, current], false, rng);
  return { current, next };
}

export function advanceQueue(
  queue: PieceQueue,
  history: number[],
  isInDanger = false,
  rng?: () => number
): PieceQueue {
  return { current: queue.next, next: selectNextTier(history, isInDanger, rng) };
}

/** The queue's test seed (`__cascade_setSeed`): a small Lehmer generator, the same every run. */
export function createSeededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (Math.imul(48271, s) + (s >>> 16)) | 0;
    return (s >>> 0) / 0x100000000;
  };
}

/** A new game's queue and the history the spawn selector reads (moved from the screen, #3699). */
export function makeQueue(rng?: () => number): { queue: PieceQueue; history: number[] } {
  const queue = createPieceQueue([], rng);
  return { queue, history: [queue.current, queue.next] };
}

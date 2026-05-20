import { selectNextTier } from "./spawnSelector2";

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

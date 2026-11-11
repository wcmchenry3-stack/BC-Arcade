/**
 * Direct sampling of the real piece queue (#2893): piece frequency per tier and drought length
 * per tier, with no physics. It calls `createPieceQueue` / `advanceQueue` with the same history
 * rule as the screen, so it measures the selector the game uses. `inDanger` pins the danger
 * flag (the pile near the lid) to measure the selector's danger mode too.
 */
import { advanceQueue, createPieceQueue } from "../pieceQueue";
import { DROUGHT_WINDOW } from "../spawnSelector";
import { DEFAULT_CONSTANTS, streamRng } from "./config";

export interface QueueSample {
  /** Share of drops per tier (index = tier), over all seeds. Sums to 1. */
  share: number[];
  /** Longest run of consecutive drops without the tier, over all seeds (0 if not droppable). */
  maxDrought: number[];
  draws: number;
}

export function sampleQueue(
  seeds: number,
  draws: number,
  inDanger: boolean,
  tiers: number = DEFAULT_CONSTANTS.maxTier + 1,
  droppable: number[] = DEFAULT_CONSTANTS.droppableTiers
): QueueSample {
  const counts = new Array<number>(tiers).fill(0);
  const maxDrought = new Array<number>(tiers).fill(0);
  for (let seed = 1; seed <= seeds; seed++) {
    const rng = streamRng(seed, "queue");
    let queue = createPieceQueue([], rng);
    let history = [queue.current, queue.next];
    const runs = new Array<number>(tiers).fill(0);
    for (let i = 0; i < draws; i++) {
      const tier = queue.current;
      queue = advanceQueue(queue, history, inDanger, rng);
      history = [...history, queue.next].slice(-DROUGHT_WINDOW);
      counts[tier]!++;
      for (const d of droppable) {
        runs[d] = d === tier ? 0 : runs[d]! + 1;
        maxDrought[d] = Math.max(maxDrought[d]!, runs[d]!);
      }
    }
  }
  const total = seeds * draws;
  return { share: counts.map((n) => n / total), maxDrought, draws: total };
}

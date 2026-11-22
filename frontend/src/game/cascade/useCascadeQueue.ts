/**
 * Cascade's piece queue and a game's seeds (moved out of `CascadeScreen.tsx` in #3858, which
 * seeded live play so a game's `game_started` can record them).
 *
 * Each game has two seeds (`replay.ts` `newSeeds`): the queue's, which draws the tiers the queue
 * offers (`pieceQueue.ts`, the same generator as the `__cascade_setSeed` test seam), and the
 * engine's, which draws the drop nudge (`CascadeEngine` `seed`). The first game's are drawn on
 * mount, so its queue is seeded from the first render; `reseed()` draws a new game's.
 * Test builds may still replace both (`__cascade_setSeed`) or script the queue (`seedQueue`).
 */
import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { createSeededRng, makeQueue, type PieceQueue } from "./pieceQueue";
import { newSeeds, type CascadeSeeds } from "./replay";

export interface CascadeQueue {
  readonly queueRef: MutableRefObject<PieceQueue>;
  readonly queueHistoryRef: MutableRefObject<number[]>;
  readonly queueRngRef: MutableRefObject<(() => number) | undefined>;
  /** Test builds only (#3719): tiers the queue still has to offer, after `next`, before it goes random. */
  readonly queueScriptRef: MutableRefObject<number[]>;
  /** The game's seeds, for `game_started` and the engine. */
  readonly seedsRef: MutableRefObject<CascadeSeeds>;
  /** A new game: new seeds, and a fresh queue drawn from the new queue seed. */
  readonly reseed: () => void;
}

/** A game's seeds and the queue drawn from its queue seed. */
function freshGame() {
  const seeds = newSeeds();
  const rng = createSeededRng(seeds.queue);
  // The queue and the history the spawn selector reads come from one makeQueue() call.
  return { seeds, rng, ...makeQueue(rng) };
}

export function useCascadeQueue(): CascadeQueue {
  const [first] = useState(freshGame);
  const seedsRef = useRef<CascadeSeeds>(first.seeds);
  const queueRef = useRef<PieceQueue>(first.queue);
  const queueHistoryRef = useRef<number[]>(first.history);
  const queueRngRef = useRef<(() => number) | undefined>(first.rng);
  const queueScriptRef = useRef<number[]>([]);

  const reseed = useCallback(() => {
    const game = freshGame();
    seedsRef.current = game.seeds;
    queueRngRef.current = game.rng;
    queueRef.current = game.queue;
    queueHistoryRef.current = game.history;
  }, []);

  return { queueRef, queueHistoryRef, queueRngRef, queueScriptRef, seedsRef, reseed };
}

/**
 * Sort Puzzle BFS solver (#1176).
 *
 * Pure TypeScript. No side effects. Mirrors the backend BFS in
 * backend/sort/generate_levels.py but returns the move sequence rather
 * than a boolean.
 *
 * Performance: capped at 200 000 visited states (matches backend generator).
 * States beyond the cap return null — the puzzle is assumed solvable but the
 * path is too long to compute client-side in real time. In practice only
 * levels 16–20 (7–8 colors) approach this limit.
 */

import { isValidPour, applyPour, isComplete } from "./engine";
import type { Move, SortState } from "./types";

const BFS_CAP = 200_000;

// ---------------------------------------------------------------------------
// State serialisation for the visited set
// ---------------------------------------------------------------------------

function key(state: SortState): string {
  return state.bottles.map((b) => b.join(",")).join("|");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * BFS over the move graph. Returns the shortest sequence of moves to solve
 * `state`, or null if unsolvable (or if the BFS cap is hit).
 */
export function solve(state: SortState): Move[] | null {
  if (isComplete(state)) return [];

  const visited = new Set<string>([key(state)]);
  // Each queue entry: [currentState, movesFromRoot]. head is an index cursor
  // so dequeue is O(1) — Array.shift() would be O(n) on large state spaces.
  const queue: Array<[SortState, Move[]]> = [[state, []]];
  let head = 0;

  while (head < queue.length) {
    if (visited.size >= BFS_CAP) return null;

    const [cur, moves] = queue[head++];

    for (let from = 0; from < cur.bottles.length; from++) {
      for (let to = 0; to < cur.bottles.length; to++) {
        if (from === to) continue;
        if (!isValidPour(cur.bottles[from], cur.bottles[to])) continue;

        const next = applyPour(cur, from, to);
        const k = key(next);
        if (visited.has(k)) continue;

        const path = [...moves, { from, to }];
        if (next.isComplete) return path;

        visited.add(k);
        queue.push([next, path]);
      }
    }
  }

  return null;
}

/**
 * Returns the first move of the optimal solution path, or null if no
 * solution is found within the BFS cap.
 */
export function getNextHint(state: SortState): Move | null {
  const path = solve(state);
  return path && path.length > 0 ? path[0] : null;
}

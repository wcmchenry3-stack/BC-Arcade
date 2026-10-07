/**
 * Sort Puzzle BFS solver (#1176).
 *
 * Pure TypeScript. No side effects. Uses the same pour rules as the backend's
 * level solver (`successors` in backend/sort/fast_solver.py) and its
 * reference pour simulator (`_moves` / `_apply` in
 * backend/sort/verify_levels.py), and returns the move sequence.
 *
 * Performance: capped at 200 000 visited states.
 * States beyond the cap return null — the puzzle is assumed solvable but the
 * path is too long to compute client-side in real time. In practice only
 * levels 16–20 (7–8 colors) approach this limit.
 */

import { isValidPour, applyPour, isComplete } from "./engine";
import type { Move, SortState } from "./types";

const BFS_CAP = 200_000;
const YIELD_EVERY = 1_000;

// ---------------------------------------------------------------------------
// State serialisation for the visited set
// ---------------------------------------------------------------------------

function key(state: SortState): string {
  return state.bottles.map((b) => b.join(",")).join("|");
}

// ---------------------------------------------------------------------------
// BFS (single implementation, driven sync or async)
// ---------------------------------------------------------------------------

interface Node {
  state: SortState;
  parent: number; // index into the node list; -1 for the root
  move: Move | null; // move that led here from the parent
}

function pathTo(nodes: readonly Node[], index: number, last: Move): Move[] {
  const path: Move[] = [last];
  for (let i = index; i > 0; i = nodes[i]!.parent) path.push(nodes[i]!.move!);
  return path.reverse();
}

/**
 * BFS over the move graph. Yields once per dequeued state (so an async driver
 * can hand control back to the event loop) and returns the shortest move
 * sequence, or null if unsolvable / the BFS cap is hit.
 */
function* bfs(state: SortState): Generator<void, Move[] | null> {
  if (isComplete(state)) return [];

  const visited = new Set<string>([key(state)]);
  // head is an index cursor so dequeue is O(1) — Array.shift() would be O(n).
  const nodes: Node[] = [{ state, parent: -1, move: null }];
  let head = 0;

  while (head < nodes.length) {
    if (visited.size >= BFS_CAP) return null;
    yield;

    const index = head++;
    const cur = nodes[index]!.state;

    for (let from = 0; from < cur.bottles.length; from++) {
      for (let to = 0; to < cur.bottles.length; to++) {
        if (from === to) continue;
        if (!isValidPour(cur.bottles[from]!, cur.bottles[to]!)) continue;

        const next = applyPour(cur, from, to);
        const k = key(next);
        if (visited.has(k)) continue;

        if (next.isComplete) return pathTo(nodes, index, { from, to });

        visited.add(k);
        nodes.push({ state: next, parent: index, move: { from, to } });
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Shortest solution for `state`, or null if unsolvable (or the BFS cap is hit). */
export function solve(state: SortState): Move[] | null {
  const it = bfs(state);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/**
 * Async BFS that yields to the JS event loop every YIELD_EVERY dequeued
 * states so the UI stays responsive during long solves (levels 16–20).
 */
export async function solveAsync(state: SortState): Promise<Move[] | null> {
  const it = bfs(state);
  let dequeued = 0;
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    if (++dequeued % YIELD_EVERY === 0) await new Promise<void>((res) => setTimeout(res, 0));
  }
}

/**
 * First move of the optimal solution, off the main thread tick so the UI
 * stays responsive.
 */
export async function getNextHintAsync(state: SortState): Promise<Move | null> {
  const path = await solveAsync(state);
  return path?.[0] ?? null;
}

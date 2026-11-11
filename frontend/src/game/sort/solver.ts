/**
 * Sort Puzzle solver (#1176, #3686).
 *
 * Pure TypeScript. No side effects. A port of the backend's level solver
 * (`solve` / `successors` in backend/sort/fast_solver.py), which the level
 * generator uses to prove every served level solvable. Same method:
 *
 * - A state is keyed with its bottles sorted, so bottle permutations (two
 *   empty bottles swapped, a run moved to "the other" empty bottle) are one
 *   state.
 * - A full single-colour bottle is inert, so it is dropped from the state.
 * - Of several empty bottles only the first is tried, and a single-colour
 *   bottle is never poured into an empty one (that only permutes bottles).
 * - Best-first on `runs - colours` (a lower bound on the pours left), ties
 *   newest-first, exactly the Python `(h, -counter)` heap order.
 *
 * The search keeps a visited set over the whole reachable space, so
 * "unsolvable" is a proof; running out of budget is "unknown". The old plain
 * BFS (capped at 200 000 states, bottle order kept in the key) gave up on
 * every level with two empty bottles from level 11 up, so Hint showed nothing.
 *
 * Parity with the backend is pinned by `__tests__/fixtures/solverParity.json`
 * (see docs/games/sort.md, "Client-Side Engine").
 */

import { isComplete } from "./engine";
import { BOTTLE_DEPTH, type Move, type SortState } from "./types";

/**
 * Distinct states the search may visit before the verdict is "unknown". The
 * backend's generator uses the same 200 000. Measured worst case over 20
 * fixed-seed sets of all 23 levels is 7 894 states (seed 6, level 22; see
 * docs/games/sort.md), so the budget is about 25 times what any served level
 * needs; it only bounds time spent on a pathological board.
 */
const SOLVE_BUDGET = 200_000;
const YIELD_EVERY = 1_000;

export type SolveVerdict =
  { verdict: "solvable"; moves: Move[] } | { verdict: "unsolvable" } | { verdict: "unknown" };

// A solver state: bottles as strings of one-character colour codes, bottom
// first, sorted, with full single-colour bottles removed.
type Canon = readonly string[];

const isFull = (s: string): boolean =>
  s.length === BOTTLE_DEPTH && countChar(s, s[0]!) === BOTTLE_DEPTH;

function countChar(s: string, c: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === c) n++;
  return n;
}

function canon(bottles: readonly string[]): Canon {
  return bottles.filter((b) => !isFull(b)).sort();
}

/** Solved when no non-full bottle holds anything (only empties are left). */
const solved = (s: Canon): boolean => s.every((b) => b === "");

const keyOf = (s: Canon): string => s.join("|");

/** Bottles as one-character codes, in the board's own order. */
function codes(state: SortState): string[] {
  const map = new Map<string, string>();
  return state.bottles.map((b) =>
    b
      .map((c) => {
        let code = map.get(c);
        if (code === undefined) {
          code = String.fromCharCode(65 + map.size);
          map.set(c, code);
        }
        return code;
      })
      .join("")
  );
}

function runs(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (i === 0 || s[i] !== s[i - 1]) n++;
  return n;
}

function heuristic(state: Canon): number {
  let r = 0;
  const colours = new Set<string>();
  for (const b of state) {
    r += runs(b);
    for (const c of b) colours.add(c);
  }
  return r - colours.size;
}

interface Succ {
  from: number;
  to: number;
  state: Canon;
}

/** Every state one pour away, with indices into `state`. */
function successors(state: Canon): Succ[] {
  const out: Succ[] = [];
  const byTop = new Map<string, number[]>();
  state.forEach((s, j) => {
    if (s.length > 0 && s.length < BOTTLE_DEPTH) {
      const top = s[s.length - 1]!;
      const list = byTop.get(top);
      if (list) list.push(j);
      else byTop.set(top, [j]);
    }
  });
  // Sorted, so an empty bottle comes first; the others are the same target.
  const hasEmpty = state.length > 0 && state[0] === "";
  for (let i = 0; i < state.length; i++) {
    const src = state[i]!;
    if (src === "") continue;
    const c = src[src.length - 1]!;
    let restLen = src.length;
    while (restLen > 0 && src[restLen - 1] === c) restLen--;
    const run = src.length - restLen;
    const targets = (byTop.get(c) ?? []).filter((j) => j !== i);
    if (hasEmpty && restLen > 0) targets.push(0);
    for (const j of targets) {
      const dst = state[j]!;
      const k = Math.min(run, BOTTLE_DEPTH - dst.length);
      const newDst = dst + c.repeat(k);
      const bottles = [...state];
      bottles[i] = src.slice(0, src.length - k);
      // Only the destination can fill up; a full single-colour bottle is inert.
      if (newDst.length === BOTTLE_DEPTH && countChar(newDst, c) === BOTTLE_DEPTH) {
        bottles.splice(j, 1);
      } else {
        bottles[j] = newDst;
      }
      bottles.sort();
      out.push({ from: i, to: j, state: bottles });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Binary min-heap ordered by (h, tie); tie is the negated counter, so among
// equal scores the newest entry pops first.
// ---------------------------------------------------------------------------

interface Entry {
  h: number;
  tie: number;
  state: Canon;
}

const before = (a: Entry, b: Entry): boolean => a.h < b.h || (a.h === b.h && a.tie < b.tie);

class MinHeap {
  private readonly items: Entry[] = [];

  get size(): number {
    return this.items.length;
  }

  push(e: Entry): void {
    const a = this.items;
    let i = a.length;
    a.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(e, a[p]!)) break;
      a[i] = a[p]!;
      i = p;
    }
    a[i] = e;
  }

  pop(): Entry {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= a.length) break;
        if (c + 1 < a.length && before(a[c + 1]!, a[c]!)) c++;
        if (!before(a[c]!, last)) break;
        a[i] = a[c]!;
        i = c;
      }
      a[i] = last;
    }
    return top;
  }
}

// ---------------------------------------------------------------------------
// Search (single implementation, driven sync or async)
// ---------------------------------------------------------------------------

function pour(bottles: string[], i: number, j: number): void {
  const src = bottles[i]!;
  const dst = bottles[j]!;
  const c = src[src.length - 1]!;
  let run = 0;
  while (run < src.length && src[src.length - 1 - run] === c) run++;
  const k = Math.min(run, BOTTLE_DEPTH - dst.length);
  bottles[i] = src.slice(0, src.length - k);
  bottles[j] = dst + c.repeat(k);
}

/**
 * Map pours between bottle contents onto the board's own indices. A state is a
 * multiset of bottles, so any bottle holding the source's contents (and any
 * other holding the destination's) is an equivalent choice.
 */
function toMoves(board: string[], steps: [string, string][]): Move[] {
  const bottles = [...board];
  return steps.map(([src, dst]) => {
    const from = bottles.indexOf(src);
    const to = bottles.findIndex((b, n) => b === dst && n !== from);
    pour(bottles, from, to);
    return { from, to };
  });
}

/**
 * Best-first search. Yields once per expanded state so an async driver can
 * hand control back to the event loop.
 */
function* search(state: SortState, budget: number): Generator<void, SolveVerdict> {
  if (isComplete(state)) return { verdict: "solvable", moves: [] };
  const board = codes(state);
  const start = canon(board);
  if (solved(start)) return { verdict: "solvable", moves: [] };

  // Each state maps to (previous state key, source contents, destination contents).
  type Link = { prev: string; src: string; dst: string } | null;
  const parent = new Map<string, Link>([[keyOf(start), null]]);
  let tie = 0;
  const frontier = new MinHeap();
  frontier.push({ h: heuristic(start), tie: -tie++, state: start });

  while (frontier.size > 0) {
    yield;
    const cur = frontier.pop();
    const curKey = keyOf(cur.state);
    for (const { from, to, state: nxt } of successors(cur.state)) {
      const k = keyOf(nxt);
      if (parent.has(k)) continue;
      parent.set(k, { prev: curKey, src: cur.state[from]!, dst: cur.state[to]! });
      if (solved(nxt)) {
        const steps: [string, string][] = [];
        for (let link = parent.get(k) ?? null; link; link = parent.get(link.prev) ?? null) {
          steps.push([link.src, link.dst]);
        }
        return { verdict: "solvable", moves: toMoves(board, steps.reverse()) };
      }
      if (parent.size >= budget) return { verdict: "unknown" };
      frontier.push({ h: heuristic(nxt), tie: -tie++, state: nxt });
    }
  }
  return { verdict: "unsolvable" };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decide `state`: a solution as pours into the board as shown, a proof that
 * none exists, or "unknown" when the budget ran out.
 * @internal Exported for tests; no production caller until #2768 (knip --production, #3126).
 */
export function solveBoard(state: SortState, budget: number = SOLVE_BUDGET): SolveVerdict {
  const it = search(state, budget);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/**
 * Same as `solveBoard`, yielding to the JS event loop every YIELD_EVERY
 * expanded states so the UI stays responsive during long solves.
 * @internal Exported for tests; no production caller until #2768 (knip --production, #3126).
 */
export async function solveBoardAsync(
  state: SortState,
  budget: number = SOLVE_BUDGET
): Promise<SolveVerdict> {
  const it = search(state, budget);
  let expanded = 0;
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    if (++expanded % YIELD_EVERY === 0) await new Promise<void>((res) => setTimeout(res, 0));
  }
}

const movesOrNull = (r: SolveVerdict): Move[] | null => (r.verdict === "solvable" ? r.moves : null);

/**
 * A solution for `state`, or null if unsolvable or undecided within the budget.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export function solve(state: SortState): Move[] | null {
  return movesOrNull(solveBoard(state));
}

/** Async `solve`; yields to the event loop during long searches. */
export async function solveAsync(state: SortState): Promise<Move[] | null> {
  return movesOrNull(await solveBoardAsync(state));
}

/**
 * First pour of a solution, off the main thread tick so the UI stays
 * responsive.
 */
export async function getNextHintAsync(state: SortState): Promise<Move | null> {
  const path = await solveAsync(state);
  return path?.[0] ?? null;
}

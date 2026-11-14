/**
 * Client solver parity with the backend's fast_solver (#3686).
 *
 * `fixtures/solverParity.json` is exported by
 * `backend/scripts/sort_export_solver_fixture.py` (see docs/games/sort.md).
 * Boards are lists of one-letter-per-unit strings, "" for an empty bottle; the
 * letters stand in for colours (the solver only compares them).
 */

import { readFileSync } from "fs";
import { join } from "path";

import { SORT_LEVELS } from "../catalog";
import { applyPour, initState, isComplete, isValidPour } from "../engine";
import { solveBoard, solveBoardAsync, getNextHintAsync, solve } from "../solver";
import type { Color, Move, SortState } from "../types";

interface CatalogSet {
  levels: string[][];
  states: number[];
}
interface FixtureBoard {
  name: string;
  kind: "dead-shuffle" | "dead-play" | "mid-game";
  bottles: string[];
  verdict: "solvable" | "unsolvable";
  states: number;
}
interface Fixture {
  catalog: CatalogSet;
  boards: FixtureBoard[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "solverParity.json"), "utf8")
) as Fixture;

function toState(bottles: string[]): SortState {
  return initState(bottles.map((b) => b.split("") as unknown as (Color | "")[]));
}

function replay(state: SortState, moves: readonly Move[]): void {
  let s = state;
  for (const m of moves) {
    expect(m.from).not.toBe(m.to);
    expect(isValidPour(s.bottles[m.from]!, s.bottles[m.to]!)).toBe(true);
    s = applyPour(s, m.from, m.to);
  }
  expect(isComplete(s)).toBe(true);
}

describe("fixture shape", () => {
  it("has every catalog level and all three board kinds", () => {
    expect(fixture.catalog.levels).toHaveLength(SORT_LEVELS.length);
    expect(fixture.catalog.states).toHaveLength(SORT_LEVELS.length);
    expect(new Set(fixture.boards.map((b) => b.kind))).toEqual(
      new Set(["dead-shuffle", "dead-play", "mid-game"])
    );
  });
});

/** A board as the fixture writes it: letters in order of first appearance. */
function lettered(bottles: readonly (readonly string[])[]): string[] {
  const letters = new Map<string, string>();
  return bottles.map((b) =>
    b
      .map((c) => {
        if (!letters.has(c)) letters.set(c, String.fromCharCode(65 + letters.size));
        return letters.get(c)!;
      })
      .join("")
  );
}

describe("Hint finds a move on every catalog level (all 120 levels)", () => {
  it("the fixture is the catalog: same boards, bottle for bottle", () => {
    SORT_LEVELS.forEach((level, i) => {
      expect(fixture.catalog.levels[i]).toEqual(lettered(level.bottles));
    });
  });

  it.each(
    fixture.catalog.levels.map(
      (bottles, i) => [i + 1, bottles, fixture.catalog.states[i]!] as const
    )
  )("level %i: solved and the solution replays", (_n, bottles, states) => {
    const state = toState(bottles);
    // Same search as the backend: the state count matches exactly, so the
    // budget below is the backend's own count for this level.
    const r = solveBoard(state, states);
    expect(r.verdict).toBe("solvable");
    if (r.verdict === "solvable") {
      expect(r.moves.length).toBeGreaterThan(0);
      replay(state, r.moves);
    }
  });

  it("the worst catalog level stays well inside the default budget", () => {
    expect(Math.max(...fixture.catalog.states)).toBeLessThan(20_000);
  });
});

describe("regression: late two-empty levels (plain BFS hit its 200 000 cap)", () => {
  it("solves a 14-colour, 2-empty level within 20 000 states and hints a first pour", async () => {
    // The last catalog level: 14 colours and 2 empty bottles.
    const bottles = fixture.catalog.levels[fixture.catalog.levels.length - 1]!;
    expect(bottles).toHaveLength(16);
    const state = toState(bottles);
    const r = solveBoard(state, 20_000);
    expect(r.verdict).toBe("solvable");
    const hint = await getNextHintAsync(state);
    expect(hint).not.toBeNull();
    expect(isValidPour(state.bottles[hint!.from]!, state.bottles[hint!.to]!)).toBe(true);
    expect(solve(state)).not.toBeNull();
  });
});

describe("parity with fast_solver on boards", () => {
  it.each(fixture.boards.map((b) => [b.name, b] as const))("%s", (_name, board) => {
    const state = toState(board.bottles);
    const budget = board.states + 1;
    const r = solveBoard(state, budget);
    expect(r.verdict).toBe(board.verdict);
    if (r.verdict === "solvable") replay(state, r.moves);
  });

  it("returns unknown, not a wrong verdict, when the budget is spent", () => {
    const board = fixture.boards.find((b) => b.states > 100)!;
    expect(solveBoard(toState(board.bottles), 5).verdict).toBe("unknown");
  });

  it("the async driver gives the same verdict as the sync one", async () => {
    for (const board of fixture.boards.slice(0, 6)) {
      const state = toState(board.bottles);
      expect(await solveBoardAsync(state)).toEqual(solveBoard(state));
    }
  });

  it("legacy solve() is null for a proven-dead board", () => {
    const dead = fixture.boards.find((b) => b.verdict === "unsolvable")!;
    expect(solve(toState(dead.bottles))).toBeNull();
  });
});

describe("solveAsync yields to the event loop", () => {
  it("lets a timer fire during a long search", async () => {
    // The costliest catalog level expands well over YIELD_EVERY (1 000) states.
    const { states, levels } = fixture.catalog;
    const worst = states.indexOf(Math.max(...states));
    expect(states[worst]).toBeGreaterThan(2_000);
    const state = toState(levels[worst]!);
    let ticked = false;
    setTimeout(() => {
      ticked = true;
    }, 0);
    await solveBoardAsync(state);
    expect(ticked).toBe(true);
  });
});

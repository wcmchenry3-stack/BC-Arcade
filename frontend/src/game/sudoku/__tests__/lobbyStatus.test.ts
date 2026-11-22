import AsyncStorage from "@react-native-async-storage/async-storage";

import { enterDigit, loadPuzzle, selectCell } from "../engine";
import { getLobbyStatus, isResumable } from "../lobbyStatus";
import { saveGame } from "../storage";
import type { SudokuState } from "../types";

const rng0 = () => 0;

/** The puzzle with its first empty cell filled in (the solution's digit): one undo step. */
function withOneEntry(): SudokuState {
  const s = loadPuzzle("easy", "classic", rng0);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (!s.grid[r]?.[c]?.given) {
        const digit = Number(s.solution[r * 9 + c]) as Parameters<typeof enterDigit>[1];
        return enterDigit(selectCell(s, r, c), digit);
      }
    }
  }
  throw new Error("no empty cell");
}

describe("sudoku isResumable (#4008)", () => {
  it("does not resume nothing, an untouched puzzle, or a solved one", () => {
    expect(isResumable(null)).toBe(false);
    expect(isResumable(loadPuzzle("easy", "classic", rng0))).toBe(false);
    expect(isResumable({ ...withOneEntry(), isComplete: true })).toBe(false);
  });

  it("resumes a puzzle with an entry made", () => {
    expect(isResumable(withOneEntry())).toBe(true);
  });
});

describe("sudoku getLobbyStatus (#4008)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("is Resume for a puzzle in progress, and nothing for an untouched one", async () => {
    await saveGame(loadPuzzle("easy", "classic", rng0));
    expect(await getLobbyStatus()).toBeUndefined();
    await saveGame(withOneEntry());
    expect(await getLobbyStatus()).toEqual({ kind: "resume" });
  });

  it("is Resume for a mini puzzle in progress", async () => {
    const mini = loadPuzzle("easy", "mini", rng0);
    const empty = mini.grid
      .flatMap((row, r) => row.map((cell, c) => ({ cell, r, c })))
      .find((x) => !x.cell.given);
    if (!empty) throw new Error("no empty cell");
    const digit = Number(mini.solution[empty.r * 6 + empty.c]) as Parameters<typeof enterDigit>[1];
    await saveGame(enterDigit(selectCell(mini, empty.r, empty.c), digit));
    expect(await getLobbyStatus()).toEqual({ kind: "resume" });
  });

  it("shows no best: Sudoku's bests are per mode and difficulty", async () => {
    expect(await getLobbyStatus()).toBeUndefined();
  });

  it("reads an invalid save as no resume, and leaves it stored", async () => {
    await AsyncStorage.setItem("sudoku_game", JSON.stringify({ _v: 1, difficulty: "easy" }));
    expect(await getLobbyStatus()).toBeUndefined();
    expect(await AsyncStorage.getItem("sudoku_game")).not.toBeNull();
  });
});

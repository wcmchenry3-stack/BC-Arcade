/**
 * A scripted, seeded Sudoku game played through the real engine and recorded
 * through the real GameRecorder (#3288): the golden replay's input.
 *
 * `playGolden` drives the same `applyRecorded` the screen uses, so what is
 * recorded is what the engine did. It covers pencil notes (some left on the
 * board), an erase, an undo that restores notes, a wrong entry, a hint and
 * actions that change nothing, then fills the rest of the grid but one cell.
 */

import type { EnqueueEventInput } from "../../../_shared/gameEventClient";
import { GameRecorder } from "../../../_shared/gameRecorder";
import { loadPuzzle, selectCell, toggleNotesMode } from "../../engine";
import { applyRecorded, createEntryLog, unitOfEntry, type PadAction } from "../../replay";
import type { CellValue, Difficulty, SudokuState, Variant } from "../../types";
import { variantConfig } from "../../types";

export interface Recording {
  /** The recorder's saved events, in order. */
  readonly saved: EnqueueEventInput[];
  /** Run the idle task, if one is waiting. */
  readonly idle: () => void;
  /** Play one pad action as the screen does; returns the next state. */
  readonly play: (state: SudokuState, action: PadAction) => SudokuState;
  /** Hand the open chunk over (what the screen does when the game ends). */
  readonly finish: () => void;
}

/** A recorder and entry log wired as the screen wires them, with a manual idle clock. */
export function startRecording(
  options: { enabled?: () => boolean; count?: number; sink?: boolean } = {}
): Recording {
  const saved: EnqueueEventInput[] = [];
  const tasks: (() => void)[] = [];
  let t = 0;
  const recorder = new GameRecorder<"sudoku">({
    gameType: "sudoku",
    sink: {
      canAccept: () => true,
      enqueueMany: (batch) => {
        saved.push(...batch);
        return true;
      },
    },
    now: () => (t += 10),
    schedule: (task) => tasks.push(task),
    ...(options.enabled ? { enabled: options.enabled } : {}),
  });
  recorder.startSession();
  const log = createEntryLog((first, entries) => {
    recorder.beginUnit(unitOfEntry(first));
    recorder.record("entries", { i: first, e: entries });
    recorder.closeUnit();
  });
  if (options.count) log.reset(options.count);
  const idle = () => {
    while (tasks.length > 0) tasks.shift()?.();
  };
  return {
    saved,
    idle,
    play: (state, action) => {
      const applied = applyRecorded(state, action);
      if (!applied) return state;
      log.push(applied.entry);
      return applied.next;
    },
    finish: () => {
      log.flush();
      recorder.endSession();
    },
  };
}

function solutionAt(s: SudokuState, cell: number): CellValue {
  return (s.solution.charCodeAt(cell) - 48) as CellValue;
}

function select(s: SudokuState, cell: number): SudokuState {
  const { size } = variantConfig(s.variant);
  const row = Math.floor(cell / size);
  const col = cell % size;
  // `selectCell` deselects an already selected cell: select only when not there.
  return s.selectedRow === row && s.selectedCol === col ? s : selectCell(s, row, col);
}

export interface Golden {
  readonly state: SudokuState;
  readonly puzzle: string;
  readonly difficulty: Difficulty;
  readonly variant: Variant;
  readonly saved: EnqueueEventInput[];
  /** Entries recorded, by op. */
  readonly counts: Record<number, number>;
}

/** Play the scripted game. `rng` picks the puzzle, so the game is the same every run. */
export function playGolden(difficulty: Difficulty, variant: Variant, rng: () => number): Golden {
  const rec = startRecording();
  let s = loadPuzzle(difficulty, variant, rng);
  const puzzle = s.puzzle;
  const { size } = variantConfig(variant);
  const empties: number[] = [];
  for (let i = 0; i < puzzle.length; i++) if (puzzle[i] === "0") empties.push(i);
  if (empties.length < 12) throw new Error("the script needs at least 12 empty cells");
  const [e0, e1, e2, e3, e4, e5, e6, e7] = empties as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const digit = (d: number) => ({ kind: "digit", digit: d as CellValue }) as const;
  const note = (cell: number, d: number) => {
    s = toggleNotesMode(select(s, cell));
    s = rec.play(s, digit(d));
    s = toggleNotesMode(s);
  };

  // actions that change nothing are not recorded: no selection, a given, an
  // erase of an empty cell, an undo with nothing to undo
  s = rec.play(s, digit(1));
  s = rec.play(s, { kind: "erase" });
  s = rec.play(s, { kind: "undo" });
  s = rec.play(s, { kind: "hint" });
  const given = puzzle.split("").findIndex((c) => c !== "0");
  s = rec.play(select(s, given), digit(5));
  s = rec.play(s, { kind: "erase" });

  // e0: two notes, one toggled off again, then the digit (which clears the notes)
  note(e0, solutionAt(s, e0));
  note(e0, (solutionAt(s, e0) % size) + 1);
  note(e0, solutionAt(s, e0));
  s = rec.play(select(s, e0), digit(solutionAt(s, e0)));

  // e1: a wrong entry (a digit a peer already holds), erased, then the right one
  const peerDigit = (cell: number): number => {
    const row = Math.floor(cell / size);
    for (let c = 0; c < size; c++) {
      const v = Number(puzzle[row * size + c]);
      if (v !== 0 && v !== solutionAt(s, cell)) return v;
    }
    throw new Error("no wrong peer digit");
  };
  s = rec.play(select(s, e1), digit(peerDigit(e1) as CellValue));
  s = rec.play(s, { kind: "erase" });
  s = rec.play(s, digit(solutionAt(s, e1)));

  // e2: placed, undone (back to empty), placed again
  s = rec.play(select(s, e2), digit(solutionAt(s, e2)));
  s = rec.play(s, { kind: "undo" });

  // e3 and e4 keep their notes to the end
  note(e3, 1);
  note(e3, 2);
  note(e3, 3);
  note(e4, 4);

  // a digit placed, a note added after it, then an undo: the undo restores the
  // notes as they stood before the digit, so the later note is gone
  s = rec.play(select(s, e2), digit(solutionAt(s, e2)));
  s = rec.play(select(s, e5), digit(solutionAt(s, e5)));
  note(e4, 5);
  s = rec.play(s, { kind: "undo" });

  // e6: a hint on an empty selected cell
  s = rec.play(select(s, e6), { kind: "hint" });

  // the rest of the grid but e3, e4 and e5, then e5 last
  for (const cell of empties) {
    if (cell === e3 || cell === e4 || cell === e5 || cell === e7) continue;
    if (s.grid[Math.floor(cell / size)]![cell % size]!.value !== 0) continue;
    s = rec.play(select(s, cell), digit(solutionAt(s, cell)));
  }
  s = rec.play(select(s, e5), digit(solutionAt(s, e5)));
  // e7 gets a note too, then the game stops one cell short
  note(e7, 9);

  rec.finish();
  const counts: Record<number, number> = {};
  for (const ev of rec.saved) {
    for (const entry of (ev.data as { e: number[][] }).e) {
      counts[entry[0]!] = (counts[entry[0]!] ?? 0) + 1;
    }
  }
  return { state: s, puzzle, difficulty, variant, saved: rec.saved, counts };
}

/** The grid as one digit per cell. */
export function valuesOf(s: SudokuState): string {
  return s.grid.map((row) => row.map((c) => c.value).join("")).join("");
}

/** Cell index -> sorted note digits, only cells with notes. */
export function notesOf(s: SudokuState): Record<number, string> {
  const out: Record<number, string> = {};
  const size = s.grid.length;
  s.grid.forEach((row, r) =>
    row.forEach((c, col) => {
      if (c.notes.size > 0) out[r * size + col] = [...c.notes].sort((a, b) => a - b).join("");
    })
  );
  return out;
}

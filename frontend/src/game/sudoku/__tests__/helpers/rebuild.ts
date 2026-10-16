/**
 * Rebuild a Sudoku grid from a game's recorded events alone (#3288): the givens
 * string from `game_started` plus the `entries` events, nothing from the
 * engine. It is the reader of the format, written independently of the engine,
 * so a recorder change that loses information fails the golden replay.
 *
 * It mirrors what the engine does to the grid: a digit, a hint or an erase
 * clears the cell's notes and pushes an undo snapshot (capped at the engine's
 * UNDO_STACK_LIMIT); a note toggles one digit and pushes nothing; an undo
 * restores the last snapshot — values, notes and the error count with it.
 * Toggling a note also trims that digit from every peer (same row, column or
 * box) that holds the digit as its value and has it as a note — a filled cell
 * can carry notes, since notes mode works on any non-given cell.
 */

import { OP_DIGIT, OP_ERASE, OP_HINT, OP_NOTE, OP_UNDO } from "../../replay";
import { UNDO_STACK_LIMIT } from "../../types";

export interface RecordedEventLike {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface Rebuilt {
  /** One digit per cell, `0` = empty. */
  readonly values: string;
  /** Cell index -> its notes as a sorted digit string, only cells with notes. */
  readonly notes: Readonly<Record<number, string>>;
  /** The error count the flagged entries add up to, undos taken into account. */
  readonly errors: number;
  /** How many entries were applied. */
  readonly entries: number;
}

interface Snapshot {
  values: number[];
  notes: Set<number>[];
  errors: number;
}

function isPeer(a: number, b: number, size: number, boxRows: number, boxCols: number): boolean {
  if (a === b) return false;
  const [ra, ca, rb, cb] = [Math.floor(a / size), a % size, Math.floor(b / size), b % size];
  if (ra === rb || ca === cb) return true;
  return (
    Math.floor(ra / boxRows) === Math.floor(rb / boxRows) &&
    Math.floor(ca / boxCols) === Math.floor(cb / boxCols)
  );
}

export function rebuildFromEvents(puzzle: string, events: readonly RecordedEventLike[]): Rebuilt {
  const size = Math.round(Math.sqrt(puzzle.length));
  const [boxRows, boxCols] = size === 6 ? [2, 3] : [3, 3];
  const values = [...puzzle].map(Number);
  let notes = values.map(() => new Set<number>());
  let errors = 0;
  let applied = 0;
  const stack: Snapshot[] = [];
  const push = () => {
    stack.push({ values: [...values], notes: notes.map((n) => new Set(n)), errors });
    if (stack.length > UNDO_STACK_LIMIT) stack.shift();
  };

  for (const event of events) {
    if (event.type !== "entries") continue;
    const data = event.data as { i: number; e: number[][] };
    // `i` is the ordinal of the chunk's first entry: a gap is a lost chunk.
    if (data.i !== applied) {
      throw new Error(`hole in the entries: expected ${applied}, got ${data.i}`);
    }
    for (const entry of data.e) {
      const [op, cell, digit, flag] = entry as [number, number, number, number | undefined];
      applied += 1;
      switch (op) {
        case OP_DIGIT:
          push();
          values[cell] = digit;
          notes[cell]!.clear();
          if (flag === 1) errors += 1;
          break;
        case OP_NOTE: {
          const n = notes[cell]!;
          if (n.has(digit)) n.delete(digit);
          else n.add(digit);
          for (let peer = 0; peer < values.length; peer++) {
            if (values[peer] === digit && isPeer(cell, peer, size, boxRows, boxCols)) {
              notes[peer]!.delete(digit);
            }
          }
          break;
        }
        case OP_ERASE:
          push();
          values[cell] = 0;
          notes[cell]!.clear();
          break;
        case OP_UNDO: {
          const snap = stack.pop();
          if (!snap) throw new Error("undo with nothing to undo");
          snap.values.forEach((v, i) => {
            values[i] = v;
          });
          notes = snap.notes;
          errors = snap.errors;
          break;
        }
        case OP_HINT:
          push();
          values[cell] = digit;
          notes[cell]!.clear();
          break;
        default:
          throw new Error(`unknown op ${op}`);
      }
    }
  }

  const noteMap: Record<number, string> = {};
  notes.forEach((n, i) => {
    if (n.size > 0) noteMap[i] = [...n].sort((a, b) => a - b).join("");
  });
  return { values: values.join(""), notes: noteMap, errors, entries: applied };
}

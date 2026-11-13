/**
 * Sudoku motion (#3774): every timing stays under its story ceiling, so the game never feels slow,
 * and #3775's sound can be timed to the same numbers. Also which cells a unit's sweep covers, and
 * how a move's events become motion.
 */
import {
  CLASH_BLINK_DELAY_MS,
  CLASH_BLINK_DIM,
  CLASH_BLINK_EDGE_MS,
  CLASH_BLINK_OFF_MS,
  CLASH_BLINK_TOTAL_MS,
  ERROR_PULSE_MS,
  ERROR_PULSE_PEAK,
  PLACE_FROM_SCALE,
  PLACE_MS,
  SOLVED_BEAT_MS,
  UNIT_CELL_MS,
  UNIT_PEAK,
  UNIT_SWEEP_MS,
  UNIT_SWEEP_START_MS,
  UNIT_SWEEP_TOTAL_MS,
  WAVE_CELL_MS,
  WAVE_PEAK,
  WAVE_STAGGER_MS,
  WAVE_TOTAL_MS,
  deriveMotion,
  unitCells,
  unitSweepDelayMs,
  waveDelayMs,
} from "../motion";
import type { GameEvent, SudokuState } from "../types";

// The story's ceilings (#3774, owner-approved "Calm"), kept here rather than exported.
const CEILING = {
  place: 150,
  errorPulse: 380,
  clashBlink: 300,
  unitSweep: 450,
  unitTotal: 550,
  waveCell: 300,
  waveStagger: 600,
  waveTotal: 900,
  solvedBeat: 1000,
};

describe("Sudoku motion", () => {
  it("a digit lands in 150 ms or less, from a little smaller", () => {
    expect(PLACE_MS).toBeLessThanOrEqual(CEILING.place);
    expect(PLACE_FROM_SCALE).toBe(0.9);
  });

  it("an error pulses the cell once in 380 ms or less, and the clash ring blinks once, quickly", () => {
    expect(ERROR_PULSE_MS).toBeLessThanOrEqual(CEILING.errorPulse);
    expect(ERROR_PULSE_PEAK).toBeGreaterThan(0);
    expect(ERROR_PULSE_PEAK).toBeLessThan(1);
    expect(CLASH_BLINK_TOTAL_MS).toBe(
      CLASH_BLINK_DELAY_MS + CLASH_BLINK_OFF_MS + 2 * CLASH_BLINK_EDGE_MS
    );
    expect(CLASH_BLINK_TOTAL_MS).toBeLessThanOrEqual(CEILING.clashBlink);
    // It dims, never off: the ring stays readable.
    expect(CLASH_BLINK_DIM).toBeGreaterThan(0);
    expect(CLASH_BLINK_DIM).toBeLessThan(1);
  });

  it("a unit's sweep takes 450 ms or less and is over by 550 ms", () => {
    expect(UNIT_SWEEP_MS).toBeLessThanOrEqual(CEILING.unitSweep);
    expect(UNIT_SWEEP_TOTAL_MS).toBeLessThanOrEqual(CEILING.unitTotal);
    expect(UNIT_SWEEP_START_MS + UNIT_SWEEP_MS).toBeLessThanOrEqual(UNIT_SWEEP_TOTAL_MS);
    expect(UNIT_CELL_MS).toBeLessThan(UNIT_SWEEP_MS);
    expect(UNIT_PEAK).toBeLessThan(0.5); // a soft glow
  });

  it("the sweep goes cell by cell and ends within the sweep whatever the unit's length", () => {
    for (const count of [6, 9]) {
      const delays = Array.from({ length: count }, (_, i) => unitSweepDelayMs(i, count));
      expect(delays[0]).toBe(UNIT_SWEEP_START_MS);
      for (let i = 1; i < count; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1]!);
      expect(delays[count - 1]! + UNIT_CELL_MS).toBe(UNIT_SWEEP_START_MS + UNIT_SWEEP_MS);
      expect(delays[count - 1]! + UNIT_CELL_MS).toBeLessThanOrEqual(UNIT_SWEEP_TOTAL_MS);
    }
    expect(unitSweepDelayMs(0, 1)).toBe(UNIT_SWEEP_START_MS);
  });

  it("the solved wave is 900 ms in all, with each cell 300 ms and 600 ms from corner to corner", () => {
    expect(WAVE_CELL_MS).toBeLessThanOrEqual(CEILING.waveCell);
    expect(WAVE_STAGGER_MS).toBeLessThanOrEqual(CEILING.waveStagger);
    expect(WAVE_TOTAL_MS).toBe(WAVE_STAGGER_MS + WAVE_CELL_MS);
    expect(WAVE_TOTAL_MS).toBeLessThanOrEqual(CEILING.waveTotal);
    expect(WAVE_PEAK).toBeLessThan(0.5);
  });

  it("the wave runs corner to corner along the diagonals, on both boards", () => {
    for (const size of [6, 9]) {
      expect(waveDelayMs(0, 0, size)).toBe(0);
      expect(waveDelayMs(size - 1, size - 1, size)).toBe(WAVE_STAGGER_MS);
      // The same diagonal, the same moment.
      expect(waveDelayMs(1, 2, size)).toBe(waveDelayMs(2, 1, size));
      expect(waveDelayMs(1, 2, size)).toBeLessThan(waveDelayMs(2, 2, size));
      // Every cell is done within the wave.
      expect(waveDelayMs(size - 1, size - 1, size) + WAVE_CELL_MS).toBeLessThanOrEqual(
        WAVE_TOTAL_MS
      );
    }
  });

  it("the card follows the solving move by 1.0 s (owner), the wave inside it", () => {
    expect(SOLVED_BEAT_MS).toBe(CEILING.solvedBeat);
    expect(WAVE_TOTAL_MS).toBeLessThanOrEqual(SOLVED_BEAT_MS);
  });
});

describe("unitCells", () => {
  it("a row runs left to right, a column top to bottom", () => {
    expect(unitCells("row", 4, "classic")).toEqual([36, 37, 38, 39, 40, 41, 42, 43, 44]);
    expect(unitCells("col", 2, "classic")).toEqual([2, 11, 20, 29, 38, 47, 56, 65, 74]);
    expect(unitCells("row", 1, "mini")).toEqual([6, 7, 8, 9, 10, 11]);
    expect(unitCells("col", 5, "mini")).toEqual([5, 11, 17, 23, 29, 35]);
  });

  it("a 3 x 3 box is read in reading order from its top-left cell's index", () => {
    // The engine's box index is the index of its top-left cell: row 3, column 6.
    expect(unitCells("box", 3 * 9 + 6, "classic")).toEqual([33, 34, 35, 42, 43, 44, 51, 52, 53]);
    expect(unitCells("box", 0, "classic")).toEqual([0, 1, 2, 9, 10, 11, 18, 19, 20]);
  });

  it("Mini's boxes are 2 rows by 3 columns", () => {
    // Rows 2-3, columns 3-5.
    expect(unitCells("box", 2 * 6 + 3, "mini")).toEqual([15, 16, 17, 21, 22, 23]);
    expect(unitCells("box", 4 * 6, "mini")).toEqual([24, 25, 26, 30, 31, 32]);
  });
});

describe("deriveMotion", () => {
  const base = { selectedRow: 2, selectedCol: 3, variant: "classic" } as const;
  const state = (events: GameEvent[] | undefined, over: Partial<SudokuState> = {}) =>
    ({ ...base, events, ...over }) as Pick<
      SudokuState,
      "events" | "selectedRow" | "selectedCol" | "variant"
    >;

  it("is null when the move placed nothing", () => {
    expect(deriveMotion(state(undefined))).toBeNull();
    expect(deriveMotion(state([]))).toBeNull();
  });

  it("a digit lands in the selected cell", () => {
    const m = deriveMotion(state([{ type: "digitPlace" }]))!;
    expect(m.placed).toBe(2 * 9 + 3);
    expect(m.error).toBe(false);
    expect(m.units).toEqual([]);
  });

  it("an illegal digit is an error", () => {
    const m = deriveMotion(state([{ type: "digitPlace" }, { type: "errorEntered" }]))!;
    expect(m.error).toBe(true);
  });

  it("takes the unit and index of each unitComplete event", () => {
    const m = deriveMotion(
      state([
        { type: "digitPlace" },
        { type: "unitComplete", unit: "row", index: 2 },
        { type: "unitComplete", unit: "box", index: 3 },
      ])
    )!;
    expect(m.units).toEqual([
      { unit: "row", index: 2 },
      { unit: "box", index: 3 },
    ]);
  });

  it("the solving move has no unit sweeps: the wave stands in for them", () => {
    const m = deriveMotion(
      state([
        { type: "digitPlace" },
        { type: "unitComplete", unit: "row", index: 2 },
        { type: "puzzleComplete" },
      ])
    )!;
    expect(m.units).toEqual([]);
  });

  it("has no cell when none is selected, and a new id for each move", () => {
    const a = deriveMotion(
      state([{ type: "digitPlace" }], { selectedRow: null, selectedCol: null })
    )!;
    const b = deriveMotion(state([{ type: "digitPlace" }]))!;
    expect(a.placed).toBeNull();
    expect(b.id).not.toBe(a.id);
  });
});

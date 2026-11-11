import {
  clockOf,
  forSave,
  onLoad,
  pauseGame,
  resumeGame,
  withClockOf,
  withMoveClock,
} from "../playClock";
import type { FreeCellState } from "../types";

function board(overrides: Partial<FreeCellState> = {}): FreeCellState {
  return {
    _v: 1,
    tableau: [[], [], [], [], [], [], [], []],
    freeCells: [null, null, null, null],
    foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
    undoStack: [],
    isComplete: false,
    moveCount: 0,
    ...overrides,
  };
}

describe("FreeCell play clock (#3607)", () => {
  it("a game with no clock has not started", () => {
    expect(clockOf(board())).toEqual({ startedAt: null, accumulatedMs: 0 });
  });

  it("starts at the first move and runs on after it", () => {
    const first = withMoveClock(board(), board({ moveCount: 1 }), 1_000);
    expect(first.clock).toEqual({ startedAt: 1_000, accumulatedMs: 0 });
    const second = withMoveClock(first, board({ moveCount: 2 }), 5_000);
    expect(second.clock).toEqual({ startedAt: 1_000, accumulatedMs: 0 });
  });

  it("stops at the winning move", () => {
    const running = board({ clock: { startedAt: 1_000, accumulatedMs: 0 } });
    const won = withMoveClock(running, board({ isComplete: true }), 61_000);
    expect(won.clock).toEqual({ startedAt: null, accumulatedMs: 60_000 });
  });

  it("pauses while away, and a move made meanwhile does not restart it", () => {
    const running = board({ clock: { startedAt: 1_000, accumulatedMs: 0 } });
    const paused = pauseGame(running, 4_000);
    expect(paused.clock).toEqual({ startedAt: null, accumulatedMs: 3_000, paused: true });
    expect(withMoveClock(paused, board({ moveCount: 1 }), 9_000).clock).toEqual(paused.clock);
    expect(resumeGame(paused, 10_000).clock).toEqual({ startedAt: 10_000, accumulatedMs: 3_000 });
  });

  it("a finished game is never resumed; an unstarted one is left alone", () => {
    const done = board({
      isComplete: true,
      clock: { startedAt: null, accumulatedMs: 9, paused: true },
    });
    expect(resumeGame(done)).toBe(done);
    const fresh = board();
    expect(pauseGame(fresh)).toBe(fresh);
    expect(resumeGame(fresh)).toBe(fresh);
  });

  it("an undo or a hint keeps the current clock", () => {
    const now = board({ clock: { startedAt: 1_000, accumulatedMs: 500 } });
    const older = board({ clock: { startedAt: null, accumulatedMs: 0 } });
    expect(withClockOf(now, older).clock).toBe(now.clock);
    expect(withClockOf(board(), older).clock).toBeUndefined();
  });

  it("is saved with its running segment banked, and none of the closed time counts on load", () => {
    const running = board({ clock: { startedAt: 1_000, accumulatedMs: 500 } });
    const saved = forSave(running, 3_000);
    expect(saved.clock).toEqual({ startedAt: 3_000, accumulatedMs: 2_500 });
    expect(onLoad(saved, 100_000).clock).toEqual({ startedAt: 100_000, accumulatedMs: 2_500 });
    // A save from before #3607 has no clock and stays that way.
    expect(onLoad(board())).toEqual(board());
  });
});

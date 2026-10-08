import {
  initialRunState,
  isLiveRun,
  isRunOver,
  isRunPaused,
  runReducer,
  type RunAction,
  type RunResult,
  type RunState,
} from "../runPhase";

const RESULT: RunResult = { score: 1200, wave: 4, tier: "Ensign", best: 1500, isNewBest: false };

function play(state: RunState, ...actions: RunAction[]): RunState {
  return actions.reduce(runReducer, state);
}

const START: RunAction = { type: "START" };
const PAUSE: RunAction = { type: "PAUSE" };
const RESUME: RunAction = { type: "RESUME" };
const OPEN_PICKER: RunAction = { type: "OPEN_PICKER" };
const GAME_OVER: RunAction = { type: "GAME_OVER", result: RESULT };

describe("initialRunState", () => {
  it("opens on the picker over an empty board without a saved run", () => {
    const s = initialRunState(false);
    expect(s).toEqual({
      phase: "picker",
      covers: "running",
      frozen: false,
      result: null,
      resetTick: 0,
    });
    expect(isLiveRun(s)).toBe(false);
    expect(isRunPaused(s)).toBe(false);
    expect(isRunOver(s)).toBe(false);
  });

  it("opens paused, skipping the picker, on a restored run", () => {
    const s = initialRunState(true);
    expect(s).toEqual({
      phase: "paused",
      covers: "paused",
      frozen: false,
      result: null,
      resetTick: 0,
    });
    expect(isLiveRun(s)).toBe(true);
    expect(isRunPaused(s)).toBe(true);
  });
});

describe("runReducer", () => {
  it("START runs a fresh run, clears the card and bumps the reset tick", () => {
    const over = play(initialRunState(false), START, GAME_OVER);
    expect(over.resetTick).toBe(1);
    const s = runReducer(over, START);
    expect(s).toEqual({
      phase: "running",
      covers: "running",
      frozen: false,
      result: null,
      resetTick: 2,
    });
  });

  it("START from a restored pause starts over rather than resuming", () => {
    const s = runReducer(initialRunState(true), START);
    expect(s.phase).toBe("running");
    expect(s.resetTick).toBe(1);
  });

  it("PAUSE and RESUME toggle a live run without touching the tick", () => {
    const running = play(initialRunState(false), START);
    const paused = runReducer(running, PAUSE);
    expect(paused).toEqual({ ...running, phase: "paused", covers: "paused" });
    expect(isLiveRun(paused)).toBe(true);
    expect(runReducer(paused, RESUME)).toEqual(running);
  });

  it("PAUSE and RESUME are no-ops where they mean nothing", () => {
    const paused = play(initialRunState(false), START, PAUSE);
    expect(runReducer(paused, PAUSE)).toBe(paused);
    const running = runReducer(paused, RESUME);
    expect(runReducer(running, RESUME)).toBe(running);
    const over = runReducer(running, GAME_OVER);
    expect(runReducer(over, RESUME)).toBe(over);
    const frozen = runReducer(over, PAUSE);
    expect(runReducer(frozen, PAUSE)).toBe(frozen);
  });

  it("GAME_OVER ends a running run and shows its card, the board not held", () => {
    const from = play(initialRunState(false), START);
    const s = runReducer(from, GAME_OVER);
    expect(s).toEqual({
      phase: "over",
      covers: "over",
      frozen: false,
      result: RESULT,
      resetTick: from.resetTick,
    });
    expect(isRunOver(s)).toBe(true);
    expect(isRunPaused(s)).toBe(false);
    expect(isLiveRun(s)).toBe(false);
  });

  it("GAME_OVER on a paused run (the E2E endRun hook) keeps the board held behind the card", () => {
    const s = play(initialRunState(false), START, PAUSE, GAME_OVER);
    expect(s.phase).toBe("over");
    expect(s.frozen).toBe(true);
    expect(s.result).toBe(RESULT);
    expect(isRunPaused(s)).toBe(true);
    expect(isLiveRun(s)).toBe(false);
  });

  it("PAUSE and RESUME hold and release a finished run's board", () => {
    const over = play(initialRunState(false), START, GAME_OVER);
    const held = runReducer(over, PAUSE);
    expect(held).toEqual({ ...over, frozen: true });
    expect(isRunPaused(held)).toBe(true);
    expect(runReducer(held, RESUME)).toEqual(over);
  });

  it("OPEN_PICKER covers the run, remembering its state, and drops the card", () => {
    const running = play(initialRunState(false), START);
    const overRunning = runReducer(running, OPEN_PICKER);
    expect(overRunning).toEqual({ ...running, phase: "picker" });
    expect(isLiveRun(overRunning)).toBe(false);

    const overPaused = play(running, PAUSE, OPEN_PICKER);
    expect(overPaused.phase).toBe("picker");
    expect(isRunPaused(overPaused)).toBe(true);

    const overOver = play(running, GAME_OVER, OPEN_PICKER);
    expect(overOver.phase).toBe("picker");
    expect(overOver.result).toBeNull();
    expect(isRunOver(overOver)).toBe(true);

    // Opening it again changes nothing it covers.
    expect(runReducer(overPaused, OPEN_PICKER)).toEqual(overPaused);
  });

  it("PAUSE, RESUME and GAME_OVER under the picker move the covered run, picker staying up", () => {
    const picker = play(initialRunState(false), START, OPEN_PICKER);
    const paused = runReducer(picker, PAUSE);
    expect(paused).toEqual({ ...picker, covers: "paused" });
    expect(runReducer(paused, RESUME)).toEqual(picker);
    const over = runReducer(paused, GAME_OVER);
    expect(over).toEqual({ ...picker, covers: "over", frozen: true, result: RESULT });
  });

  it("START closes the picker whatever it covers", () => {
    for (const covered of [
      play(initialRunState(false)),
      play(initialRunState(true), OPEN_PICKER),
      play(initialRunState(false), START, PAUSE, GAME_OVER, OPEN_PICKER),
    ]) {
      const s = runReducer(covered, START);
      expect(s.phase).toBe("running");
      expect(s.covers).toBe("running");
      expect(s.frozen).toBe(false);
      expect(s.resetTick).toBe(covered.resetTick + 1);
    }
  });
});

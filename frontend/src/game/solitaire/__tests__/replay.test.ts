/**
 * Solitaire replay recording (#3289): the action encoding, the chunking, and
 * the golden replay — a seeded game played through the real engine and the
 * real GameRecorder is rebuilt from `game_started` (the seed) plus the
 * recorded `moves` events alone, and must come out with the same board and
 * score, undo, hint, stock recycle and auto-complete included.
 */

import type { EnqueueEventInput } from "../../_shared/gameEventClient";
import { MOVES_PER_CHUNK } from "../../_shared/cards/moveLog";
import { movesOf, recordMoves, wire } from "../../_shared/cards/__tests__/helpers/recordMoves";
import {
  CARD_MOVES_MAX_BYTES,
  CARD_MOVES_SESSION_MAX_BYTES,
  gameRecordingConfigs,
  recordingConfigFor,
} from "../../_shared/eventQueueConfig";
import {
  autoComplete,
  autoCompleteStepOf,
  dealEventData,
  dealGame,
  drawDealSeed,
  setRng,
} from "../engine";
import {
  AUTO_OFFSET,
  KIND,
  applyAction,
  autoAction,
  hintAction,
  moveAction,
  recordedStart,
  stockAction,
  undoAction,
  withRecorded,
} from "../replay";
import type { DrawMode, SolitaireState } from "../types";
import { isAuto, playGame, summary } from "./helpers/playGame";

afterEach(() => setRng(Math.random));

// ---------------------------------------------------------------------------
// The rebuild: the deal and the events, nothing else
// ---------------------------------------------------------------------------

/**
 * Rebuilds a game from its `game_started` data and the saved events alone.
 * `consistent` is false when the chunks do not follow each other (a hole).
 */
function rebuild(
  started: Record<string, unknown>,
  events: readonly EnqueueEventInput[]
): { state: SolitaireState; consistent: boolean; actions: number } {
  let state = dealGame(started.draw_mode as DrawMode, started.seed as number);
  let next = 0;
  let consistent = true;
  for (const { s, m } of movesOf(events)) {
    if (s !== next) consistent = false;
    for (const action of m) state = applyAction(state, action);
    next = s + m.length;
  }
  return { state, consistent, actions: next };
}

function started(drawMode: DrawMode, seed: number): Record<string, unknown> {
  return dealEventData(drawMode, { seed, index: 0 });
}

// Seeds the scripted player wins from (helpers/playGame.ts): they cover undo,
// hint, a stock recycle and Auto Complete.
const WINS: readonly (readonly [DrawMode, number])[] = [
  [1, 10],
  [1, 17],
  [3, 133],
  [3, 146],
];

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

describe("action builders", () => {
  it("encodes every card move as [kind, ...small ints]", () => {
    const state = dealGame(1, 2);
    // column 2 holds 3 cards: moving from index 1 is a run of 2
    expect(
      moveAction(state, { type: "tableau-to-tableau", fromCol: 2, fromIndex: 1, toCol: 4 })
    ).toEqual([KIND.tableauToTableau, 2, 4, 2]);
    expect(moveAction(state, { type: "waste-to-tableau", toCol: 5 })).toEqual([
      KIND.wasteToTableau,
      5,
    ]);
    expect(moveAction(state, { type: "waste-to-foundation" })).toEqual([KIND.wasteToFoundation]);
    expect(moveAction(state, { type: "tableau-to-foundation", fromCol: 6 })).toEqual([
      KIND.tableauToFoundation,
      6,
    ]);
    expect(
      moveAction(state, { type: "foundation-to-tableau", fromSuit: "diamonds", toCol: 1 })
    ).toEqual([KIND.foundationToTableau, 2, 1]);
  });

  it("is [from, to, count] for a tableau run: count is the run length, not an index", () => {
    const state = dealGame(1, 5);
    const col = state.tableau[6]!;
    expect(
      moveAction(state, {
        type: "tableau-to-tableau",
        fromCol: 6,
        fromIndex: col.length - 1,
        toCol: 0,
      })
    ).toEqual([KIND.tableauToTableau, 6, 0, 1]);
    expect(
      moveAction(state, { type: "tableau-to-tableau", fromCol: 6, fromIndex: 0, toCol: 0 })
    ).toEqual([KIND.tableauToTableau, 6, 0, col.length]);
  });

  it("marks an Auto Complete step by adding AUTO_OFFSET to the kind", () => {
    const state = dealGame(1, 2);
    expect(moveAction(state, { type: "tableau-to-foundation", fromCol: 3 }, true)).toEqual([
      AUTO_OFFSET + KIND.tableauToFoundation,
      3,
    ]);
    expect(autoAction(state, { type: "draw" })).toEqual([AUTO_OFFSET + KIND.draw]);
    expect(autoAction(state, { type: "waste-to-foundation" })).toEqual([
      AUTO_OFFSET + KIND.wasteToFoundation,
    ]);
    expect(AUTO_OFFSET).toBeGreaterThan(Math.max(...Object.values(KIND)));
  });

  it("is a draw while the stock has cards and a recycle once it is empty", () => {
    const state = dealGame(1, 2);
    expect(stockAction(state)).toEqual([KIND.draw]);
    expect(stockAction({ ...state, stock: [], waste: state.stock })).toEqual([KIND.recycle]);
  });

  it("has an undo and a hint action", () => {
    expect(undoAction()).toEqual([KIND.undo]);
    expect(hintAction()).toEqual([KIND.hint]);
  });

  it("returns a fresh array every time (the recorder owns what it is given)", () => {
    expect(undoAction()).not.toBe(undoAction());
    const state = dealGame(1, 2);
    expect(stockAction(state)).not.toBe(stockAction(state));
  });

  it("has only small non-negative integers", () => {
    const { actions } = playGame(17, 1, 300);
    for (const action of actions) {
      for (const n of action) expect(Number.isInteger(n) && n >= 0 && n < 64).toBe(true);
    }
  });

  it("stamps the logged-action count on a state, and keeps the object when it is unchanged", () => {
    const state = dealGame(1, 2);
    const stamped = withRecorded(state, 7);
    expect(stamped.recorded).toBe(7);
    expect(withRecorded(stamped, 7)).toBe(stamped);
    expect(state.recorded).toBeUndefined();
  });

  it("applyAction rejects an unknown kind", () => {
    const state = dealGame(1, 2);
    expect(() => applyAction(state, [15])).toThrow(/unknown action/);
    expect(() => applyAction(state, [])).toThrow(/unknown action/);
    expect(() => applyAction(state, [KIND.foundationToTableau, 9, 0])).toThrow(/unknown suit/);
  });
});

describe("autoCompleteStepOf", () => {
  it("returns the state autoComplete returns and the step it took, null when it takes none", () => {
    const state = dealGame(1, 2);
    // a fresh deal: the stock is full, so a step would be a draw (waste cannot go up yet)
    const first = autoCompleteStepOf(state);
    expect(first.step).toEqual({ type: "draw" });
    expect(first.state).toEqual(autoComplete(state));
    const done = { ...state, isComplete: true };
    expect(autoCompleteStepOf(done)).toEqual({ state: done, step: null });
    const bare = { ...state, stock: [], waste: [], tableau: state.tableau.map(() => []) };
    expect(autoCompleteStepOf(bare)).toEqual({ state: bare, step: null });
  });
});

describe("recordedStart (the log of a restored game)", () => {
  const fresh = dealGame(1, 2);
  const played = { ...fresh, undoStack: [fresh] };

  it("is the save's count when it is a non-negative integer", () => {
    expect(recordedStart({ ...played, recorded: 60 })).toBe(60);
    expect(recordedStart({ ...fresh, recorded: 0 })).toBe(0);
  });

  it("is 0 for a save with no count and no history", () => {
    expect(recordedStart(fresh)).toBe(0);
  });

  it("is null for a save with no count and history: its earlier actions were never recorded", () => {
    expect(recordedStart(played)).toBeNull();
    expect(recordedStart({ ...fresh, score: 15 })).toBeNull();
    expect(recordedStart({ ...fresh, recycleCount: 1 })).toBeNull();
  });

  it.each([-1, 2.5, Number.NaN, Infinity, "7", null, {}])(
    "treats a corrupt count (%p) like a missing one",
    (bad) => {
      const corrupt = (s: SolitaireState) => ({ ...s, recorded: bad }) as unknown as SolitaireState;
      expect(recordedStart(corrupt(fresh))).toBe(0);
      expect(recordedStart(corrupt(played))).toBeNull();
    }
  );
});

// ---------------------------------------------------------------------------
// Golden replay
// ---------------------------------------------------------------------------

describe("golden replay", () => {
  it.each(WINS)(
    "draw-%i seed %i: the seed plus the recorded events rebuild the final board and score",
    (drawMode, seed) => {
      const played = playGame(seed, drawMode, 900);
      expect(played.final.isComplete).toBe(true);
      const { saved } = recordMoves("solitaire", played.actions);
      const rebuilt = rebuild(started(drawMode, seed), saved);
      expect(summary(rebuilt.state)).toEqual(summary(played.final));
      expect(rebuilt.state.score).toBe(played.final.score);
      expect(rebuilt.consistent).toBe(true);
      expect(rebuilt.actions).toBe(played.actions.length);
    }
  );

  it("covers undo, hint, stock draw, recycle and auto-complete in the same games", () => {
    const kinds = new Set<number>();
    let autos = 0;
    for (const [drawMode, seed] of WINS) {
      for (const action of playGame(seed, drawMode, 900).actions) {
        kinds.add((action[0] ?? 0) % AUTO_OFFSET);
        if (isAuto(action)) autos += 1;
      }
    }
    for (const kind of [KIND.draw, KIND.recycle, KIND.undo, KIND.hint, KIND.tableauToTableau]) {
      expect(kinds.has(kind)).toBe(true);
    }
    expect(kinds.has(KIND.tableauToFoundation) || kinds.has(KIND.wasteToFoundation)).toBe(true);
    expect(autos).toBeGreaterThan(20);
  });

  it("rebuilds a game that is not finished too (the first 150 actions)", () => {
    const played = playGame(3, 1, 150);
    expect(played.final.isComplete).toBe(false);
    const { saved } = recordMoves("solitaire", played.actions);
    expect(summary(rebuild(started(1, 3), saved).state)).toEqual(summary(played.final));
  });

  it("rebuilds a 300-action game from 12 events", () => {
    const played = playGame(17, 1, 300);
    expect(played.actions.length).toBeGreaterThanOrEqual(290);
    const { saved } = recordMoves("solitaire", played.actions);
    expect(movesOf(saved)).toHaveLength(Math.ceil(played.actions.length / MOVES_PER_CHUNK));
    expect(summary(rebuild(started(1, 17), saved).state)).toEqual(summary(played.final));
  });

  it("keeps a chunk in its own unit, numbered from the first action", () => {
    const { saved } = recordMoves("solitaire", playGame(17, 1, 120).actions);
    const events = movesOf(saved);
    expect(events.map((e) => e.s)).toEqual([0, 25, 50, 75, 100]);
    expect(events.map((e) => e.unit)).toEqual([1, 2, 3, 4, 5]);
    for (const e of events) expect(e.m.length).toBeLessThanOrEqual(MOVES_PER_CHUNK);
  });

  it("fails when an auto-complete step is dropped (the test can tell)", () => {
    const played = playGame(10, 1, 900);
    const { saved } = recordMoves("solitaire", played.actions);
    const lastIndex = saved.length - 1;
    const data = saved[lastIndex]!.data as { m: number[][] };
    const withoutLast = [
      ...saved.slice(0, lastIndex),
      { ...saved[lastIndex]!, data: { ...data, m: data.m.slice(0, -1) } },
    ];
    expect(summary(rebuild(started(1, 10), withoutLast).state)).not.toEqual(summary(played.final));
  });

  it("fails when an undo is dropped, and when a chunk is missing (a hole shows in s)", () => {
    const played = playGame(17, 1, 300);
    const { saved } = recordMoves("solitaire", played.actions);
    const noUndo = saved.map((e) => ({
      ...e,
      data: { ...e.data, m: (e.data as { m: number[][] }).m.filter((a) => a[0] !== KIND.undo) },
    }));
    expect(summary(rebuild(started(1, 17), noUndo).state)).not.toEqual(summary(played.final));
    const holed = saved.filter((_, i) => i !== 3);
    const result = rebuild(started(1, 17), holed);
    expect(result.consistent).toBe(false);
    expect(summary(result.state)).not.toEqual(summary(played.final));
  });

  it("an Auto Complete step is rebuilt from its move, not from the engine's auto-complete order", () => {
    const played = playGame(10, 1, 900);
    const autos = played.actions.filter(isAuto);
    expect(autos.length).toBeGreaterThan(10);
    // every recorded step names a draw or a card move: none is a bare "auto"
    for (const a of autos) {
      const kind = (a[0] ?? 0) - AUTO_OFFSET;
      expect([
        KIND.draw,
        KIND.wasteToFoundation,
        KIND.tableauToFoundation,
        KIND.tableauToTableau,
      ]).toContain(kind);
    }
  });
});

// ---------------------------------------------------------------------------
// Size against the caps
// ---------------------------------------------------------------------------

describe("size", () => {
  it("registers moves as a chunkable replay event with the 512 B cap and a 20 KB session cap", () => {
    const config = recordingConfigFor("solitaire");
    expect(config).toBe(gameRecordingConfigs.solitaire);
    expect(config.events.moves).toEqual({ maxBytes: CARD_MOVES_MAX_BYTES, chunkField: "m" });
    expect(config.sessionMaxBytes).toBe(CARD_MOVES_SESSION_MAX_BYTES);
    expect(CARD_MOVES_MAX_BYTES).toBe(512);
    expect(CARD_MOVES_SESSION_MAX_BYTES).toBe(20 * 1024);
  });

  it("a worst-case full chunk, envelope included, is under the event cap and not split", () => {
    const worst = Array.from({ length: MOVES_PER_CHUNK }, () => [
      AUTO_OFFSET + KIND.tableauToTableau,
      6,
      5,
      13,
    ]);
    const { saved } = recordMoves("solitaire", worst, { start: 9_999 * MOVES_PER_CHUNK });
    expect(saved).toHaveLength(1);
    const bytes = JSON.stringify(saved[0]!.data).length;
    expect(bytes).toBeLessThan(CARD_MOVES_MAX_BYTES);
    expect(bytes).toBeLessThan(360 + 10);
    expect((saved[0]!.data as { parts?: number }).parts).toBeUndefined();
  });

  it("an oversized chunk is split on m, not dropped", () => {
    const wired = wire("solitaire");
    wired.recorder.startSession();
    wired.recorder.beginUnit();
    wired.recorder.record("moves", {
      s: 0,
      m: Array.from({ length: 120 }, () => [AUTO_OFFSET + KIND.tableauToTableau, 6, 5, 13]),
    });
    wired.recorder.closeUnit();
    wired.recorder.endSession();
    expect(wired.saved.length).toBeGreaterThan(1);
    for (const e of wired.saved) {
      expect(JSON.stringify(e.data).length).toBeLessThanOrEqual(CARD_MOVES_MAX_BYTES);
    }
    expect(movesOf(wired.saved).flatMap((e) => e.m)).toHaveLength(120);
  });

  it("a 300-action game is 12 events of about 220 B: well under the 40 KB budget with row overhead", () => {
    const played = playGame(17, 1, 300);
    const { saved } = recordMoves("solitaire", played.actions);
    const bytes = saved.map((e) => JSON.stringify(e.data).length);
    for (const b of bytes) expect(b).toBeLessThanOrEqual(CARD_MOVES_MAX_BYTES);
    const total = bytes.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(5_000);
    expect(total + saved.length * 200).toBeLessThan(10_000);
  });

  it("the session cap stops a runaway game as a clean prefix, reported once", () => {
    // 4,000 worst-case actions are 160 chunks of ~335 B: past 20 KB.
    const actions = Array.from({ length: 4_000 }, () => [
      AUTO_OFFSET + KIND.tableauToTableau,
      6,
      5,
      13,
    ]);
    const wired = recordMoves("solitaire", actions);
    const total = wired.saved.reduce((n, e) => n + JSON.stringify(e.data).length, 0);
    expect(total).toBeLessThanOrEqual(CARD_MOVES_SESSION_MAX_BYTES);
    expect(wired.saved.length).toBeLessThan(160);
    expect(movesOf(wired.saved).map((e) => e.s)).toEqual(
      movesOf(wired.saved).map((_, i) => i * MOVES_PER_CHUNK)
    );
    expect(wired.report).toHaveBeenCalledTimes(1);
    const report = wired.report.mock.calls[0]![0];
    expect(report.dropped_session_cap).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Resume after a kill
// ---------------------------------------------------------------------------

describe("a game resumed after a kill", () => {
  it("continues its chunk and unit numbers from the saved count", () => {
    const played = playGame(17, 1, 120);
    // the first 60 actions were played, the app was killed, 60 more were played after
    const before = recordMoves("solitaire", played.actions.slice(0, 60));
    const after = recordMoves("solitaire", played.actions.slice(60), { start: 60 });
    const events = [...movesOf(before.saved), ...movesOf(after.saved)];
    expect(events.map((e) => e.s)).toEqual([0, 25, 50, 60, 85, 110]);
    expect(events.map((e) => e.unit)).toEqual([1, 2, 3, 3, 4, 5]);
    // together they rebuild the game
    const rebuilt = rebuild(started(1, 17), [...before.saved, ...after.saved]);
    expect(rebuilt.consistent).toBe(true);
    expect(summary(rebuilt.state)).toEqual(summary(played.final));
  });

  it("shows the actions a kill cost as a gap in s", () => {
    const played = playGame(17, 1, 120);
    // 10 actions were in the chunk in progress when the app was killed: never saved
    const before = recordMoves("solitaire", played.actions.slice(0, 50));
    const after = recordMoves("solitaire", played.actions.slice(60), { start: 60 });
    const result = rebuild(started(1, 17), [...before.saved, ...after.saved]);
    expect(result.consistent).toBe(false);
    expect(movesOf(after.saved)[0]!.s).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Deal recorded once
// ---------------------------------------------------------------------------

describe("the deal", () => {
  it("is recorded once, as the seed in game_started, not in the moves", () => {
    setRng(() => 0.5);
    const pick = drawDealSeed(1);
    const data = dealEventData(1, pick);
    expect(data).toMatchObject({ seed: pick.seed, draw_mode: 1 });
    expect(JSON.stringify(data).length).toBeLessThan(100);
    const { saved } = recordMoves("solitaire", playGame(pick.seed, 1, 60).actions);
    expect(JSON.stringify(saved)).not.toContain("seed");
    // 52 cards never appear in the events: a card is never recorded, only moves
    expect(JSON.stringify(saved)).not.toMatch(/spades|hearts|diamonds|clubs/);
  });
});

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------

describe("kill switch (isRecordingEnabled false)", () => {
  it("with recording off the recorder holds, schedules, measures and saves nothing", () => {
    const wired = wire("solitaire", { enabled: false });
    wired.recorder.startSession();
    for (const a of playGame(17, 1, 120).actions) wired.log.push(a);
    wired.log.flush();
    expect(wired.recorder.held).toBe(0);
    expect(wired.tasks).toHaveLength(0);
    wired.recorder.flush();
    wired.recorder.endSession();
    expect(wired.enqueueMany).not.toHaveBeenCalled();
    expect(wired.canAccept).not.toHaveBeenCalled();
    expect(wired.report).not.toHaveBeenCalled();
  });

  it("with recording on, the same play is scheduled and saved (the spies can tell)", () => {
    const wired = wire("solitaire");
    wired.recorder.startSession();
    for (const a of playGame(17, 1, 120).actions) wired.log.push(a);
    wired.log.flush();
    expect(wired.tasks.length).toBeGreaterThan(0);
    wired.recorder.endSession();
    expect(wired.enqueueMany).toHaveBeenCalledTimes(1);
  });
});

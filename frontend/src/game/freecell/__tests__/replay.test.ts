/**
 * FreeCell replay recording (#3289): the action encoding, the chunking, and the
 * golden replay — a seeded game played through the real engine and the real
 * GameRecorder is rebuilt from `game_started` (the seed) plus the recorded
 * `moves` events alone, and must come out with the same board and move count,
 * undo, hint and auto-complete included.
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
  dealEventData,
  dealGame,
  drawDealSeed,
  nextAutoMove,
  setRng,
} from "../engine";
import {
  AUTO_OFFSET,
  KIND,
  applyAction,
  hintAction,
  moveAction,
  recordedStart,
  undoAction,
  withRecorded,
} from "../replay";
import type { FreeCellState } from "../types";
import { isAuto, playGame, summary } from "./helpers/playGame";

afterEach(() => setRng(Math.random));

/** Rebuilds a game from its `game_started` data and the saved events alone. */
function rebuild(
  started: Record<string, unknown>,
  events: readonly EnqueueEventInput[]
): { state: FreeCellState; consistent: boolean; actions: number } {
  let state = dealGame(started.seed as number);
  let next = 0;
  let consistent = true;
  for (const { s, m } of movesOf(events)) {
    if (s !== next) consistent = false;
    for (const action of m) state = applyAction(state, action);
    next = s + m.length;
  }
  return { state, consistent, actions: next };
}

const started = (seed: number) => dealEventData({ seed, index: 0 });

// Seeds the scripted player wins from (helpers/playGame.ts).
const WINS: readonly number[] = [32, 116];

describe("action builders", () => {
  it("encodes every card move as [kind, ...small ints]", () => {
    const state = dealGame(2);
    // column 0 holds 7 cards: moving from index 5 is a run of 2
    expect(
      moveAction(state, { type: "tableau-to-tableau", fromCol: 0, fromIndex: 5, toCol: 3 })
    ).toEqual([KIND.tableauToTableau, 0, 3, 2]);
    expect(moveAction(state, { type: "tableau-to-freecell", fromCol: 4, toCell: 2 })).toEqual([
      KIND.tableauToFreeCell,
      4,
      2,
    ]);
    expect(moveAction(state, { type: "tableau-to-foundation", fromCol: 7 })).toEqual([
      KIND.tableauToFoundation,
      7,
    ]);
    expect(moveAction(state, { type: "freecell-to-tableau", fromCell: 1, toCol: 6 })).toEqual([
      KIND.freeCellToTableau,
      1,
      6,
    ]);
    expect(moveAction(state, { type: "freecell-to-foundation", fromCell: 3 })).toEqual([
      KIND.freeCellToFoundation,
      3,
    ]);
    expect(
      moveAction(state, { type: "foundation-to-tableau", fromSuit: "clubs", toCol: 2 })
    ).toEqual([KIND.foundationToTableau, 3, 2]);
  });

  it("is [from, to, count] for a tableau run: count is the run length, not an index", () => {
    const state = dealGame(5);
    const col = state.tableau[0]!;
    expect(
      moveAction(state, {
        type: "tableau-to-tableau",
        fromCol: 0,
        fromIndex: col.length - 1,
        toCol: 1,
      })
    ).toEqual([KIND.tableauToTableau, 0, 1, 1]);
  });

  it("marks an Auto Complete step by adding AUTO_OFFSET to the kind", () => {
    const state = dealGame(2);
    expect(moveAction(state, { type: "freecell-to-foundation", fromCell: 3 }, true)).toEqual([
      AUTO_OFFSET + KIND.freeCellToFoundation,
      3,
    ]);
    expect(AUTO_OFFSET).toBeGreaterThan(Math.max(...Object.values(KIND)));
  });

  it("has an undo and a hint action, fresh each time", () => {
    expect(undoAction()).toEqual([KIND.undo]);
    expect(hintAction()).toEqual([KIND.hint]);
    expect(undoAction()).not.toBe(undoAction());
  });

  it("has only small non-negative integers", () => {
    for (const seed of WINS) {
      for (const action of playGame(seed, 400).actions) {
        for (const n of action) expect(Number.isInteger(n) && n >= 0 && n < 64).toBe(true);
      }
    }
  });

  it("stamps the logged-action count on a state, and keeps the object when it is unchanged", () => {
    const state = dealGame(2);
    const stamped = withRecorded(state, 7);
    expect(stamped.recorded).toBe(7);
    expect(withRecorded(stamped, 7)).toBe(stamped);
    expect(state.recorded).toBeUndefined();
  });

  it("applyAction rejects an unknown kind", () => {
    const state = dealGame(2);
    expect(() => applyAction(state, [15])).toThrow(/unknown action/);
    expect(() => applyAction(state, [])).toThrow(/unknown action/);
    expect(() => applyAction(state, [KIND.foundationToTableau, 9, 0])).toThrow(/unknown suit/);
  });
});

describe("nextAutoMove", () => {
  it("names the move autoComplete makes, and is null when it makes none", () => {
    const state = dealGame(2);
    const move = nextAutoMove(state);
    if (move === null) expect(autoComplete(state)).toBe(state);
    else expect(autoComplete(state)).toEqual(expect.objectContaining({ moveCount: 1 }));
    const bare = { ...state, tableau: state.tableau.map(() => []) };
    expect(nextAutoMove(bare)).toBeNull();
    expect(autoComplete(bare)).toBe(bare);
  });

  it("prefers a free-cell card to a tableau card", () => {
    const state = dealGame(2);
    const ace = { suit: "spades", rank: 1 } as const;
    const withBoth: FreeCellState = {
      ...state,
      tableau: [[{ suit: "hearts", rank: 1 }], [], [], [], [], [], [], []],
      freeCells: [null, null, ace, null],
    };
    expect(nextAutoMove(withBoth)).toEqual({ type: "freecell-to-foundation", fromCell: 2 });
  });
});

describe("recordedStart (the log of a restored game)", () => {
  const fresh = dealGame(2);
  const played = { ...fresh, moveCount: 3 };

  it("is the save's count when it is a non-negative integer", () => {
    expect(recordedStart({ ...played, recorded: 60 })).toBe(60);
    expect(recordedStart({ ...fresh, recorded: 0 })).toBe(0);
  });

  it("is 0 for a save with no count and no history", () => {
    expect(recordedStart(fresh)).toBe(0);
  });

  it("is null for a save with no count and history: its earlier actions were never recorded", () => {
    expect(recordedStart(played)).toBeNull();
    expect(recordedStart({ ...fresh, undoStack: [fresh] })).toBeNull();
  });

  it.each([-1, 2.5, Number.NaN, Infinity, "7", null, {}])(
    "treats a corrupt count (%p) like a missing one",
    (bad) => {
      const corrupt = (s: FreeCellState) => ({ ...s, recorded: bad }) as unknown as FreeCellState;
      expect(recordedStart(corrupt(fresh))).toBe(0);
      expect(recordedStart(corrupt(played))).toBeNull();
    }
  );
});

describe("golden replay", () => {
  it.each(WINS)(
    "seed %i: the seed plus the recorded events rebuild the final board and move count",
    (seed) => {
      const played = playGame(seed, 900);
      expect(played.final.isComplete).toBe(true);
      const { saved } = recordMoves("freecell", played.actions);
      const rebuilt = rebuild(started(seed), saved);
      expect(summary(rebuilt.state)).toEqual(summary(played.final));
      expect(rebuilt.state.moveCount).toBe(played.final.moveCount);
      expect(rebuilt.consistent).toBe(true);
      expect(rebuilt.actions).toBe(played.actions.length);
    }
  );

  it("covers undo, hint, supermoves, free cells and auto-complete in the same games", () => {
    const kinds = new Set<number>();
    let autos = 0;
    for (const seed of WINS) {
      for (const action of playGame(seed, 900).actions) {
        kinds.add((action[0] ?? 0) % AUTO_OFFSET);
        if (isAuto(action)) autos += 1;
      }
    }
    for (const kind of [
      KIND.undo,
      KIND.hint,
      KIND.tableauToTableau,
      KIND.tableauToFreeCell,
      KIND.freeCellToTableau,
    ]) {
      expect(kinds.has(kind)).toBe(true);
    }
    expect(autos).toBeGreaterThan(10);
  });

  it("rebuilds a game that is not finished too", () => {
    const played = playGame(116, 100);
    expect(played.final.isComplete).toBe(false);
    const { saved } = recordMoves("freecell", played.actions);
    expect(summary(rebuild(started(116), saved).state)).toEqual(summary(played.final));
  });

  it("rebuilds a 300-action game from 12 events", () => {
    const played = playGame(116, 300);
    expect(played.actions).toHaveLength(300);
    const { saved } = recordMoves("freecell", played.actions);
    expect(movesOf(saved)).toHaveLength(300 / MOVES_PER_CHUNK);
    expect(summary(rebuild(started(116), saved).state)).toEqual(summary(played.final));
  });

  it("keeps a chunk in its own unit, numbered from the first action", () => {
    const { saved } = recordMoves("freecell", playGame(116, 120).actions);
    const events = movesOf(saved);
    expect(events.map((e) => e.s)).toEqual([0, 25, 50, 75, 100]);
    expect(events.map((e) => e.unit)).toEqual([1, 2, 3, 4, 5]);
  });

  it("fails when an auto-complete step or an undo is dropped, and when a chunk is missing", () => {
    const played = playGame(116, 900);
    const { saved } = recordMoves("freecell", played.actions);
    const filtered = (keep: (a: number[]) => boolean) =>
      saved.map((e) => ({
        ...e,
        data: { ...e.data, m: (e.data as { m: number[][] }).m.filter(keep) },
      }));
    const final = summary(played.final);
    expect(
      summary(
        rebuild(
          started(116),
          filtered((a) => !isAuto(a))
        ).state
      )
    ).not.toEqual(final);
    expect(
      summary(
        rebuild(
          started(116),
          filtered((a) => a[0] !== KIND.undo)
        ).state
      )
    ).not.toEqual(final);
    const holed = saved.filter((_, i) => i !== 2);
    const result = rebuild(started(116), holed);
    expect(result.consistent).toBe(false);
    expect(summary(result.state)).not.toEqual(final);
  });
});

describe("size", () => {
  it("registers moves as a chunkable replay event with the 512 B cap and a 20 KB session cap", () => {
    const config = recordingConfigFor("freecell");
    expect(config).toBe(gameRecordingConfigs.freecell);
    expect(config.events.moves).toEqual({ maxBytes: CARD_MOVES_MAX_BYTES, chunkField: "m" });
    expect(config.sessionMaxBytes).toBe(CARD_MOVES_SESSION_MAX_BYTES);
  });

  it("a worst-case full chunk, envelope included, is under the event cap and not split", () => {
    const worst = Array.from({ length: MOVES_PER_CHUNK }, () => [
      AUTO_OFFSET + KIND.tableauToTableau,
      7,
      6,
      13,
    ]);
    const { saved } = recordMoves("freecell", worst, { start: 9_999 * MOVES_PER_CHUNK });
    expect(saved).toHaveLength(1);
    expect(JSON.stringify(saved[0]!.data).length).toBeLessThan(CARD_MOVES_MAX_BYTES);
    expect((saved[0]!.data as { parts?: number }).parts).toBeUndefined();
  });

  it("an oversized chunk is split on m, not dropped", () => {
    const wired = wire("freecell");
    wired.recorder.startSession();
    wired.recorder.beginUnit();
    wired.recorder.record("moves", {
      s: 0,
      m: Array.from({ length: 120 }, () => [AUTO_OFFSET + KIND.tableauToTableau, 7, 6, 13]),
    });
    wired.recorder.closeUnit();
    wired.recorder.endSession();
    expect(wired.saved.length).toBeGreaterThan(1);
    for (const e of wired.saved) {
      expect(JSON.stringify(e.data).length).toBeLessThanOrEqual(CARD_MOVES_MAX_BYTES);
    }
    expect(movesOf(wired.saved).flatMap((e) => e.m)).toHaveLength(120);
  });

  it("a 300-action game is 12 events: well under the 40 KB budget with row overhead", () => {
    const { saved } = recordMoves("freecell", playGame(116, 300).actions);
    const bytes = saved.map((e) => JSON.stringify(e.data).length);
    for (const b of bytes) expect(b).toBeLessThanOrEqual(CARD_MOVES_MAX_BYTES);
    const total = bytes.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(4_000);
    expect(total + saved.length * 200).toBeLessThan(8_000);
  });

  it("the session cap stops a runaway game as a clean prefix, reported once", () => {
    const actions = Array.from({ length: 4_000 }, () => [
      AUTO_OFFSET + KIND.tableauToTableau,
      7,
      6,
      13,
    ]);
    const wired = recordMoves("freecell", actions);
    const total = wired.saved.reduce((n, e) => n + JSON.stringify(e.data).length, 0);
    expect(total).toBeLessThanOrEqual(CARD_MOVES_SESSION_MAX_BYTES);
    expect(wired.saved.length).toBeLessThan(160);
    expect(movesOf(wired.saved).map((e) => e.s)).toEqual(
      movesOf(wired.saved).map((_, i) => i * MOVES_PER_CHUNK)
    );
    expect(wired.report).toHaveBeenCalledTimes(1);
  });
});

describe("a game resumed after a kill", () => {
  it("continues its chunk and unit numbers from the saved count", () => {
    const played = playGame(116, 120);
    const before = recordMoves("freecell", played.actions.slice(0, 60));
    const after = recordMoves("freecell", played.actions.slice(60), { start: 60 });
    const events = [...movesOf(before.saved), ...movesOf(after.saved)];
    expect(events.map((e) => e.s)).toEqual([0, 25, 50, 60, 85, 110]);
    expect(events.map((e) => e.unit)).toEqual([1, 2, 3, 3, 4, 5]);
    const rebuilt = rebuild(started(116), [...before.saved, ...after.saved]);
    expect(rebuilt.consistent).toBe(true);
    expect(summary(rebuilt.state)).toEqual(summary(played.final));
  });

  it("shows the actions a kill cost as a gap in s", () => {
    const played = playGame(116, 120);
    const before = recordMoves("freecell", played.actions.slice(0, 50));
    const after = recordMoves("freecell", played.actions.slice(60), { start: 60 });
    expect(rebuild(started(116), [...before.saved, ...after.saved]).consistent).toBe(false);
  });
});

describe("the deal", () => {
  it("is recorded once, as the seed in game_started, not in the moves", () => {
    setRng(() => 0.5);
    const pick = drawDealSeed();
    const data = dealEventData(pick);
    expect(data).toMatchObject({ seed: pick.seed });
    expect(JSON.stringify(data).length).toBeLessThan(100);
    const { saved } = recordMoves("freecell", playGame(pick.seed, 60).actions);
    expect(JSON.stringify(saved)).not.toContain("seed");
    expect(JSON.stringify(saved)).not.toMatch(/spades|hearts|diamonds|clubs/);
  });
});

describe("kill switch (isRecordingEnabled false)", () => {
  it("with recording off the recorder holds, schedules, measures and saves nothing", () => {
    const wired = wire("freecell", { enabled: false });
    wired.recorder.startSession();
    for (const a of playGame(116, 120).actions) wired.log.push(a);
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
    const wired = wire("freecell");
    wired.recorder.startSession();
    for (const a of playGame(116, 120).actions) wired.log.push(a);
    wired.log.flush();
    expect(wired.tasks.length).toBeGreaterThan(0);
    wired.recorder.endSession();
    expect(wired.enqueueMany).toHaveBeenCalledTimes(1);
  });
});

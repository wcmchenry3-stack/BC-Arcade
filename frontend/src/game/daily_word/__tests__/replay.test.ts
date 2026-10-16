/**
 * Daily Word replay (#3287, #3368): the game's one event built from the board,
 * its size against the registry cap, the refusal count, the recorder wiring
 * (kill switch, a throwing recorder) and the rebuild. The golden replay through
 * the screen is in screens/__tests__/DailyWordScreen.replay.test.tsx.
 */

import * as Sentry from "@sentry/react-native";

import {
  DAILY_WORD_GUESS_MAX_BYTES,
  recordingConfigFor,
  recordingEventCap,
} from "../../_shared/eventQueueConfig";
import { GameRecorder, type RecorderSink } from "../../_shared/gameRecorder";
import type { EnqueueEventInput } from "../../_shared/gameEventClient";
import {
  applyServerResult,
  initialState,
  markComplete,
  setCurrentRowLetter,
  tilesWithDisplay,
} from "../engine";
import { scoreGuess } from "../localScoring";
import type { DailyWordState } from "../types";
import {
  MAX_REFUSAL_COUNT,
  createGuessReplay,
  gameData,
  rebuild,
  resultCodes,
  type RecordedEvent,
} from "../replay";

const ANSWER = "slate";
const PUZZLE = "2026-05-03:en";

/** A board with the given words scored against the answer (and accented spellings). */
function boardOf(words: string[], answer = ANSWER, display: (string | undefined)[] = []) {
  let state = initialState(PUZZLE, answer.length, "en");
  words.forEach((word, i) => {
    for (const ch of Array.from(word)) state = setCurrentRowLetter(state, ch);
    state = applyServerResult(state, tilesWithDisplay(scoreGuess(answer, word), display[i]));
  });
  return state;
}

function recorder(enabled = true) {
  const saved: EnqueueEventInput[] = [];
  const sink: RecorderSink = {
    canAccept: () => true,
    enqueueMany: (events) => {
      saved.push(...events);
      return true;
    },
  };
  const rec = new GameRecorder({
    gameType: "daily_word",
    policy: "on_session_end",
    sink,
    schedule: (task) => task(),
    enabled: () => enabled,
  });
  rec.startSession();
  const replay = createGuessReplay({
    beginUnit: (n) => rec.beginUnit(n),
    record: (type, data) => rec.record(type, data),
    closeUnit: () => rec.closeUnit(),
  });
  return { rec, saved, replay };
}

describe("the game's event", () => {
  it("is every scored guess and its result, in order", () => {
    expect(gameData(boardOf(["crane", "least"]))).toEqual({
      g: ["crane", "least"],
      t: ["aacac", "ppcpp"],
    });
    expect(gameData(boardOf(["crane", ANSWER]))!.t[1]).toBe("ccccc");
  });

  it("has nothing for a board with no scored guess", () => {
    expect(gameData(initialState(PUZZLE, 5, "en"))).toBeNull();
  });

  it("keeps accented spellings in d, aligned with g, only when one differs", () => {
    const accented = boardOf(["aerer", "allee", "annee"], "annee", ["aérer", undefined, "année"]);
    expect(gameData(accented)).toEqual({
      g: ["aerer", "allee", "annee"],
      t: ["cpaca", "caacc", "ccccc"],
      d: ["aérer", "allee", "année"],
    });
    expect(gameData(boardOf(["crane"]))).not.toHaveProperty("d");
  });

  it("counts refusals in rj, left out when none", () => {
    expect(gameData(boardOf(["crane"]), 3)!.rj).toBe(3);
    expect(gameData(boardOf(["crane"]), 0)).not.toHaveProperty("rj");
  });

  it("present and absent letters get their own codes", () => {
    expect(resultCodes([{ status: "present" }, { status: "absent" }, { status: "correct" }])).toBe(
      "pac"
    );
  });

  it("the largest real game, with its envelope, is well under the type's cap", () => {
    const envelope = { v: 1, unit: 1, t_ms: 2_147_483_647 };
    const french = {
      g: Array(6).fill("aerer"),
      t: Array(6).fill("cpaca"),
      d: Array(6).fill("aérer"),
      rj: 99,
    };
    const hindi = { g: Array(6).fill("अंजाम"), t: Array(6).fill("ccaaa"), rj: 99 };
    const sizes = [french, hindi].map((d) => JSON.stringify({ ...envelope, ...d }).length);
    expect(Math.max(...sizes)).toBeLessThan(260);
    expect(DAILY_WORD_GUESS_MAX_BYTES).toBeGreaterThan(Math.max(...sizes));
    expect(recordingEventCap(recordingConfigFor("daily_word"), "guess_submitted")).toBe(
      DAILY_WORD_GUESS_MAX_BYTES
    );
  });
});

describe("the guess recorder", () => {
  it("records one event per game, unit 1, with the refusals counted into it", () => {
    const { rec, saved, replay } = recorder();
    replay.refused(PUZZLE);
    replay.refused(PUZZLE);
    replay.finish(boardOf(["crane", "least", ANSWER]));
    rec.endSession();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.type).toBe("guess_submitted");
    expect(saved[0]!.data).toEqual(
      expect.objectContaining({
        v: 1,
        unit: 1,
        g: ["crane", "least", ANSWER],
        t: ["aacac", "ppcpp", "ccccc"],
        rj: 2,
      })
    );
  });

  it("records a game once, however often it is finished (a win, then leaving)", () => {
    const { rec, saved, replay } = recorder();
    const board = boardOf(["crane", ANSWER]);
    replay.finish(board);
    replay.finish(markComplete(board, true));
    replay.finish(board);
    rec.endSession();
    expect(saved).toHaveLength(1);
  });

  it("records nothing for a board with no scored guess", () => {
    const { rec, saved, replay } = recorder();
    replay.refused(PUZZLE);
    replay.finish(initialState(PUZZLE, 5, "en"));
    rec.endSession();
    expect(saved).toEqual([]);
  });

  it("an abandoned game with some guesses is recorded; its refusals do not leak into the next puzzle", () => {
    const { rec, saved, replay } = recorder();
    replay.refused(PUZZLE);
    replay.finish(boardOf(["crane"]));
    // a new puzzle: one refusal there, then its game
    const next = "2026-05-04:en";
    replay.refused(next);
    let board = initialState(next, 5, "en");
    for (const ch of ANSWER) board = setCurrentRowLetter(board, ch);
    board = applyServerResult(board, scoreGuess(ANSWER, ANSWER));
    replay.finish(board);
    rec.endSession();
    expect(saved.map((e) => e.data!.rj)).toEqual([1, 1]);
  });

  it("stops counting refusals at MAX_REFUSAL_COUNT", () => {
    const { rec, saved, replay } = recorder();
    for (let i = 0; i < MAX_REFUSAL_COUNT + 20; i += 1) replay.refused(PUZZLE);
    replay.finish(boardOf(["crane"]));
    rec.endSession();
    expect(saved[0]!.data!.rj).toBe(MAX_REFUSAL_COUNT);
  });

  it("with the kill switch off the recorder does no work: nothing reaches the sink", () => {
    const { rec, saved, replay } = recorder(false);
    replay.refused(PUZZLE);
    replay.finish(boardOf(["crane", ANSWER]));
    rec.flush();
    rec.endSession();
    expect(saved).toEqual([]);
  });
});

describe("recording never interrupts play", () => {
  it("a recorder that throws is swallowed and reported once", () => {
    const record = jest.fn(() => {
      throw new Error("recorder broke");
    });
    const replay = createGuessReplay({ beginUnit: jest.fn(), record, closeUnit: jest.fn() });
    expect(() => replay.finish(boardOf(["crane"]))).not.toThrow();
    expect(() => replay.finish(boardOf(["crane", "least"]))).not.toThrow();
    expect(record).toHaveBeenCalledTimes(2);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });
});

describe("rebuild", () => {
  const meta = { puzzle_id: PUZZLE, word_length: 5, language: "en" };
  const eventOf = (state: DailyWordState, refusals = 0): RecordedEvent => ({
    type: "guess_submitted",
    data: gameData(state, refusals) as unknown as Record<string, unknown>,
  });

  it("rebuilds the board the player saw, keyboard included", () => {
    const state = boardOf(["crane", "least", "stale"]);
    const rebuilt = rebuild([eventOf(state, 2)], meta);
    expect(rebuilt.problems).toEqual([]);
    expect(rebuilt.state.rows).toEqual(state.rows);
    expect(rebuilt.state.keyboard_state).toEqual(state.keyboard_state);
    expect(rebuilt.state.current_row).toBe(3);
    expect(rebuilt.state.is_complete).toBe(false);
    expect(rebuilt.refusals).toBe(2);
  });

  it("a win ends the game won; six misses end it lost", () => {
    const won = rebuild([eventOf(boardOf(["crane", ANSWER]))], meta).state;
    expect([won.is_complete, won.won]).toEqual([true, true]);
    const lost = rebuild(
      [eventOf(boardOf(["crane", "least", "stale", "plate", "slant", "slats"]))],
      meta
    ).state;
    expect([lost.is_complete, lost.won]).toEqual([true, false]);
  });

  it("restores accents on the tiles", () => {
    const state = boardOf(["aerer", "annee"], "annee", ["aérer", "année"]);
    const rebuilt = rebuild([eventOf(state)], meta);
    expect(rebuilt.state.rows).toEqual(state.rows);
    expect(rebuilt.state.rows[0]!.tiles[1]!.display).toBe("é");
  });

  it("reports what does not fit instead of guessing", () => {
    expect(rebuild([], meta).problems).toEqual(["no guess_submitted event"]);
    const one = eventOf(boardOf(["crane"]));
    expect(rebuild([one, one], meta).problems).toEqual(["2 guess_submitted events for one game"]);
    const lopsided: RecordedEvent = { type: "guess_submitted", data: { g: ["crane"], t: [] } };
    expect(rebuild([lopsided], meta).problems).toEqual(["guesses and results do not line up"]);
    const short: RecordedEvent = { type: "guess_submitted", data: { g: ["crane"], t: ["cc"] } };
    expect(rebuild([short], meta).problems).toEqual(["row 1: result does not match the guess"]);
  });
});

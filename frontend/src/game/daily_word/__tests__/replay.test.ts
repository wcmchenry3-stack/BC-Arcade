/**
 * Daily Word replay (#3287): the event builders, their size against the
 * registry cap, the refusal budget, the recorder wiring (unit = row, kill
 * switch) and the rebuild. The golden replay through the screen is in
 * screens/__tests__/DailyWordScreen.replay.test.tsx.
 */

import {
  DAILY_WORD_GUESS_MAX_BYTES,
  recordingConfigFor,
  recordingEventCap,
} from "../../_shared/eventQueueConfig";
import { GameRecorder, type RecorderSink } from "../../_shared/gameRecorder";
import type { EnqueueEventInput } from "../../_shared/gameEventClient";
import { applyServerResult, initialState, setCurrentRowLetter } from "../engine";
import { scoreGuess } from "../localScoring";
import {
  MAX_RECORDED_REJECTIONS,
  acceptedData,
  createGuessReplay,
  rebuild,
  rejectedData,
  resultCodes,
  type GuessData,
  type RecordedEvent,
} from "../replay";

const ANSWER = "slate";

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

const tilesOf = (word: string) => scoreGuess(ANSWER, word);

describe("guess_submitted builders", () => {
  it("an accepted guess is its row, its letters and one result character per tile", () => {
    expect(acceptedData(2, tilesOf("crane"))).toEqual({ n: 2, g: "crane", t: "aacac" });
    expect(acceptedData(4, tilesOf(ANSWER))).toEqual({ n: 4, g: ANSWER, t: "ccccc" });
  });

  it("a refused guess has no result and says why", () => {
    expect(rejectedData(1, "zzzzz", "nw")).toEqual({ n: 1, g: "zzzzz", rej: "nw" });
    expect(rejectedData(3, "crane", "dup")).toEqual({ n: 3, g: "crane", rej: "dup" });
  });

  it("present and absent letters get their own codes", () => {
    expect(resultCodes([{ status: "present" }, { status: "absent" }, { status: "correct" }])).toBe(
      "pac"
    );
  });

  it("the largest real event, with its envelope, is well under the type's cap", () => {
    const envelope = { v: 1, unit: 6, t_ms: 2_147_483_647 };
    const hindi: GuessData = { n: 6, g: "आआआआआ", t: "ccccc" };
    const sizes = [acceptedData(6, tilesOf("crane")), rejectedData(6, "zzzzz", "nw"), hindi].map(
      (d) => JSON.stringify({ ...envelope, ...d }).length
    );
    expect(Math.max(...sizes)).toBeLessThan(100);
    expect(DAILY_WORD_GUESS_MAX_BYTES).toBeGreaterThanOrEqual(Math.max(...sizes) * 2);
    expect(recordingEventCap(recordingConfigFor("daily_word"), "guess_submitted")).toBe(
      DAILY_WORD_GUESS_MAX_BYTES
    );
  });
});

describe("the guess recorder", () => {
  it("one event per attempt, numbered by its row, with the shared envelope", () => {
    const { saved, replay } = recorder();
    replay.rejected("p1", 1, "zzzzz", "nw");
    replay.accepted(1, tilesOf("crane"));
    replay.accepted(2, tilesOf("least"));
    expect(saved.map((e) => e.type)).toEqual([
      "guess_submitted",
      "guess_submitted",
      "guess_submitted",
    ]);
    expect(saved.map((e) => [e.data!.unit, e.data!.n, e.data!.v])).toEqual([
      [1, 1, 1],
      [1, 1, 1],
      [2, 2, 1],
    ]);
  });

  it("records at most MAX_RECORDED_REJECTIONS refusals per puzzle, then starts again on a new one", () => {
    const { saved, replay } = recorder();
    for (let i = 0; i < MAX_RECORDED_REJECTIONS + 5; i += 1) {
      replay.rejected("p1", 1, "zzzzz", "nw");
    }
    expect(saved).toHaveLength(MAX_RECORDED_REJECTIONS);
    replay.rejected("p2", 1, "zzzzz", "nw");
    expect(saved).toHaveLength(MAX_RECORDED_REJECTIONS + 1);
    // Scored guesses are never limited by the refusal budget.
    replay.accepted(1, tilesOf("crane"));
    expect(saved).toHaveLength(MAX_RECORDED_REJECTIONS + 2);
  });

  it("with the kill switch off the recorder does no work: nothing reaches the sink", () => {
    const { rec, saved, replay } = recorder(false);
    replay.rejected("p1", 1, "zzzzz", "nw");
    replay.accepted(1, tilesOf("crane"));
    rec.flush();
    rec.endSession();
    expect(saved).toEqual([]);
  });
});

describe("rebuild", () => {
  function play(words: string[]) {
    let state = initialState("2026-05-03:en", 5, "en");
    const events: RecordedEvent[] = [];
    for (const w of words) {
      for (const ch of w) state = setCurrentRowLetter(state, ch);
      const tiles = tilesOf(w);
      events.push({ type: "guess_submitted", data: acceptedData(state.current_row + 1, tiles) });
      state = applyServerResult(state, tiles);
    }
    return { state, events };
  }
  const meta = { puzzle_id: "2026-05-03:en", word_length: 5, language: "en" };

  it("rebuilds the board the player saw, keyboard included", () => {
    const { state, events } = play(["crane", "least", "stale"]);
    const rebuilt = rebuild(events, meta);
    expect(rebuilt.problems).toEqual([]);
    expect(rebuilt.state.rows).toEqual(state.rows);
    expect(rebuilt.state.keyboard_state).toEqual(state.keyboard_state);
    expect(rebuilt.state.current_row).toBe(3);
    expect(rebuilt.state.is_complete).toBe(false);
  });

  it("a win ends the game won; six misses end it lost", () => {
    const won = rebuild(play(["crane", ANSWER]).events, meta).state;
    expect([won.is_complete, won.won]).toEqual([true, true]);
    const lost = rebuild(
      play(["crane", "least", "stale", "plate", "slant", "slats"]).events,
      meta
    ).state;
    expect([lost.is_complete, lost.won]).toEqual([true, false]);
  });

  it("refusals are listed apart and spend no row", () => {
    const { events } = play(["crane"]);
    const withRefusal: RecordedEvent[] = [
      { type: "guess_submitted", data: rejectedData(1, "zzzzz", "nw") },
      ...events,
    ];
    const rebuilt = rebuild(withRefusal, meta);
    expect(rebuilt.state.current_row).toBe(1);
    expect(rebuilt.refused).toEqual([{ n: 1, g: "zzzzz", rej: "nw" }]);
  });

  it("reports a gap instead of guessing", () => {
    const { events } = play(["crane", "least"]);
    expect(rebuild([events[1]!], meta).problems).toEqual(["row 2 recorded after 0 rows"]);
    const broken: RecordedEvent = { type: "guess_submitted", data: { n: 1, g: "crane", t: "cc" } };
    expect(rebuild([broken], meta).problems).toHaveLength(1);
  });
});

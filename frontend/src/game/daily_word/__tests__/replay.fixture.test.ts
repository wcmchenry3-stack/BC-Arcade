/**
 * The cross-language fixture (#3287): backend/tests/fixtures/daily_word_guess_events_v1.json
 * holds a scripted game exactly as the app records it. This test fails when the
 * app's output changes, so the backend (which validates and replays the same
 * file, tests/test_daily_word_guess_event.py) cannot drift from the app.
 */

import fs from "fs";
import path from "path";

import { GameRecorder } from "../../_shared/gameRecorder";
import { scoreGuess } from "../localScoring";
import { createGuessReplay, rebuild } from "../replay";

const FIXTURE = path.resolve(
  __dirname,
  "../../../../../backend/tests/fixtures/daily_word_guess_events_v1.json"
);

interface Fixture {
  puzzle: { puzzle_id: string; word_length: number; language: string };
  answer: string;
  events: { type: string; data: Record<string, unknown> }[];
  scored_guesses: string[];
}

function recordTheScript(answer: string): { type: string; data: Record<string, unknown> }[] {
  let clock = 0;
  const events: { type: string; data: Record<string, unknown> }[] = [];
  const rec = new GameRecorder({
    gameType: "daily_word",
    now: () => clock,
    schedule: (task) => task(),
    sink: {
      canAccept: () => true,
      enqueueMany: (batch) => {
        for (const e of batch) {
          events.push({ type: e.type, data: e.data as Record<string, unknown> });
        }
        return true;
      },
    },
  });
  rec.startSession();
  const replay = createGuessReplay({
    beginUnit: (n) => rec.beginUnit(n),
    record: (type, data) => rec.record(type, data),
    closeUnit: () => rec.closeUnit(),
  });
  const step = () => (clock += 3000);
  step();
  replay.rejected("p", 1, "zzzzz", "nw");
  step();
  replay.accepted(1, scoreGuess(answer, "crane"));
  step();
  replay.rejected("p", 2, "crane", "dup");
  step();
  replay.accepted(2, scoreGuess(answer, "least"));
  step();
  replay.accepted(3, scoreGuess(answer, "stale"));
  step();
  replay.accepted(4, scoreGuess(answer, answer));
  rec.endSession();
  return events;
}

describe("the Daily Word replay fixture", () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Fixture;

  it("is what the app records for the scripted game", () => {
    expect(recordTheScript(fixture.answer)).toEqual(fixture.events);
  });

  it("rebuilds to a won board whose scored guesses are the fixture's", () => {
    const rebuilt = rebuild(fixture.events, fixture.puzzle);
    expect(rebuilt.problems).toEqual([]);
    expect([rebuilt.state.is_complete, rebuilt.state.won, rebuilt.state.current_row]).toEqual([
      true,
      true,
      4,
    ]);
    expect(
      rebuilt.state.rows.slice(0, 4).map((r) => r.tiles.map((t) => t.letter).join(""))
    ).toEqual(fixture.scored_guesses);
  });
});

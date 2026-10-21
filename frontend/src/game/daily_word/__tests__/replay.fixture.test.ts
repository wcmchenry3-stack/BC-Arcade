/**
 * The cross-language fixture (#3287, #3368): backend/tests/fixtures/daily_word_guess_events_v1.json
 * holds scripted games exactly as the app records them (English, French with
 * accents, Hindi). This test fails when the app's output changes, so the backend
 * (which validates, replays and re-scores the same file,
 * tests/test_daily_word_guess_event.py) cannot drift from the app.
 *
 * Run with WRITE_DAILY_WORD_FIXTURE=1 to refill the `events` of each game from the app.
 */

import fs from "fs";
import path from "path";

import { GameRecorder } from "../../_shared/gameRecorder";
import {
  applyServerResult,
  initialState,
  markComplete,
  setCurrentRowLetter,
  tilesWithDisplay,
} from "../engine";
import { scoreGuess } from "../localScoring";
import { createGuessReplay, rebuild } from "../replay";
import type { DailyWordState } from "../types";

const FIXTURE = path.resolve(
  __dirname,
  "../../../../../backend/tests/fixtures/daily_word_guess_events_v1.json"
);

type Step = { refuse?: true; g?: string; d?: string };
type Recorded = { type: string; data: Record<string, unknown> };
interface FixtureGame {
  label: string;
  puzzle: { puzzle_id: string; word_length: number; language: string };
  answer: string;
  script: Step[];
  events: Recorded[];
  scored_guesses: string[];
}
interface Fixture {
  games: FixtureGame[];
}

/** Plays the script on the engine, as the screen does, and records the game as it ends. */
function recordTheScript(game: FixtureGame): { events: Recorded[]; board: DailyWordState } {
  let clock = 0;
  const events: Recorded[] = [];
  const rec = new GameRecorder({
    gameType: "daily_word",
    policy: "on_session_end",
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
  const { puzzle_id: id, word_length: length, language } = game.puzzle;
  let board = initialState(id, length, language);
  for (const step of game.script) {
    clock += 3000;
    if (step.refuse) {
      replay.refused(id);
      continue;
    }
    for (const letter of Array.from(step.g!)) board = setCurrentRowLetter(board, letter);
    // as the screen gets them: the server's tiles, with its accented spelling on them
    board = applyServerResult(board, tilesWithDisplay(scoreGuess(game.answer, step.g!), step.d));
  }
  board = markComplete(board, true);
  replay.finish(board);
  rec.endSession();
  return { events, board };
}

describe("the Daily Word replay fixture", () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Fixture;

  if (process.env.WRITE_DAILY_WORD_FIXTURE) {
    it("writes the fixture", () => {
      for (const game of fixture.games) game.events = recordTheScript(game).events;
      fs.writeFileSync(FIXTURE, JSON.stringify(fixture, null, 2) + "\n");
    });
    return;
  }

  const games = fixture.games.map((g) => [g.label, g] as const);

  it.each(games)("%s: is what the app records for the scripted game", (_label, game) => {
    expect(recordTheScript(game).events).toEqual(game.events);
    expect(game.events).toHaveLength(1);
  });

  it.each(games)("%s: rebuilds to the board played, accents included", (_label, game) => {
    const played = recordTheScript(game).board;
    const rebuilt = rebuild(game.events, game.puzzle);
    expect(rebuilt.problems).toEqual([]);
    expect(rebuilt.state.rows).toEqual(played.rows);
    expect(rebuilt.state.keyboard_state).toEqual(played.keyboard_state);
    expect([rebuilt.state.is_complete, rebuilt.state.won]).toEqual([true, true]);
    const folded = rebuilt.state.rows
      .slice(0, game.scored_guesses.length)
      .map((r) => r.tiles.map((t) => t.letter).join(""));
    expect(folded).toEqual(game.scored_guesses);
  });

  it("keeps the accents the board showed, and counts the refusals", () => {
    const french = fixture.games[1]!;
    expect(french.events[0]!.data.d).toEqual(["aérer", "allée", "année"]);
    const english = fixture.games[0]!;
    expect(english.events[0]!.data).not.toHaveProperty("d");
    expect(rebuild(english.events, english.puzzle).refusals).toBe(2);
  });
});

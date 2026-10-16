/**
 * The Sudoku events the app really builds, pinned for the backend (#3288).
 *
 * `backend/tests/fixtures/sudoku_entries_v1.json` holds, for two seeded games
 * played through the real engine and GameRecorder (a Classic hard one and a
 * Mini one), the `game_started` data, the saved `entries` events (envelope
 * included) and the final grid they rebuild. The backend test
 * (`tests/test_sudoku_replay_events.py`) feeds every event to `validate_event`
 * and rebuilds the grid in Python, so a change to what the app records that the
 * server would drop or misread fails here first.
 *
 * To regenerate after an intended change to the events (bump `v` if it is
 * breaking): `UPDATE_SUDOKU_REPLAY_FIXTURE=1 npx jest src/game/sudoku/__tests__/replay.fixture.test.ts`
 */

import fs from "fs";
import path from "path";

import { notesOf, playGolden, valuesOf } from "./helpers/goldenGame";
import { rebuildFromEvents } from "./helpers/rebuild";

const FIXTURE = path.resolve(
  __dirname,
  "../../../../../backend/tests/fixtures/sudoku_entries_v1.json"
);

function games() {
  const classic = playGolden("hard", "classic", () => 0.77);
  const mini = playGolden("easy", "mini", () => 0.5);
  const describe = (g: typeof classic) => ({
    game_started: { difficulty: g.difficulty, variant: g.variant, puzzle: g.puzzle },
    events: g.saved.map((e) => ({ type: e.type, data: e.data })),
    final: { values: valuesOf(g.state), notes: notesOf(g.state), errors: g.state.errorCount },
  });
  return { classic_hard: describe(classic), mini_easy: describe(mini) };
}

describe("sudoku_entries_v1.json", () => {
  it("is what the app records today", () => {
    const fresh = games();
    if (process.env.UPDATE_SUDOKU_REPLAY_FIXTURE === "1") {
      // one event per line: a readable diff, a small file
      const body = Object.entries(fresh).map(
        ([name, g]) =>
          ` ${JSON.stringify(name)}: {\n  "game_started": ${JSON.stringify(g.game_started)},\n  "events": [\n${g.events
            .map((e) => `   ${JSON.stringify(e)}`)
            .join(",\n")}\n  ],\n  "final": ${JSON.stringify(g.final)}\n }`
      );
      fs.writeFileSync(FIXTURE, `{\n${body.join(",\n")}\n}\n`);
    }
    expect(JSON.parse(fs.readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(fresh)));
  });

  it("rebuilds to its recorded final grid", () => {
    for (const g of Object.values(games())) {
      const rebuilt = rebuildFromEvents(g.game_started.puzzle, g.events);
      expect(rebuilt.values).toBe(g.final.values);
      expect(rebuilt.notes).toEqual(g.final.notes);
      expect(rebuilt.errors).toBe(g.final.errors);
    }
  });
});

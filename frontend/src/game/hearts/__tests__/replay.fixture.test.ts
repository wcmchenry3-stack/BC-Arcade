/**
 * The Hearts events the app really builds, pinned for the backend (#3283).
 *
 * `backend/tests/fixtures/hearts_replay_v1.json` holds the saved events (envelope
 * included) of two seeded games played through the real engine, AI and
 * GameRecorder: a six-hand game, and a four-hand game with a queen passed in hand
 * 1 and a moon shot in hand 4. The backend test
 * (`tests/test_hearts_replay_events.py`) feeds every event to `validate_event`, so
 * a change to what the app records that the server would drop fails here first.
 *
 * To regenerate after an intended change to the events (bump `v` if it is
 * breaking): `UPDATE_HEARTS_REPLAY_FIXTURE=1 npx jest src/game/hearts/__tests__/replay.fixture.test.ts`
 */

import fs from "fs";
import path from "path";

import { createSeededRng, setRng } from "../engine";
import { playRecordedGame, queenAndMoonOptions, rebuildGame } from "./helpers/replayGame";

const FIXTURE = path.resolve(
  __dirname,
  "../../../../../backend/tests/fixtures/hearts_replay_v1.json"
);

function games() {
  setRng(createSeededRng(37));
  const full = playRecordedGame({});
  setRng(createSeededRng(9));
  const scripted = playRecordedGame({ ...queenAndMoonOptions(), maxHands: 4 });
  return { full, scripted };
}

describe("hearts_replay_v1.json", () => {
  it("is what the app records today", () => {
    const { full, scripted } = games();
    const fresh = {
      six_hands: full.saved.map((e) => ({ type: e.type, data: e.data })),
      queen_and_moon: scripted.saved.map((e) => ({ type: e.type, data: e.data })),
    };
    if (process.env.UPDATE_HEARTS_REPLAY_FIXTURE === "1") {
      // one event per line: a readable diff, a small file
      const body = Object.entries(fresh).map(
        ([name, events]) =>
          ` ${JSON.stringify(name)}: [\n${events.map((e) => `  ${JSON.stringify(e)}`).join(",\n")}\n ]`
      );
      fs.writeFileSync(FIXTURE, `{\n${body.join(",\n")}\n}\n`);
    }
    expect(JSON.parse(fs.readFileSync(FIXTURE, "utf8"))).toEqual(fresh);
  });

  it("covers a moon shot, a queen passed, and rebuilds its scores", () => {
    const { full, scripted } = games();
    expect(full.final.scoreHistory.length).toBe(6);
    expect(rebuildGame(full.saved).problems).toEqual([]);
    const rebuilt = rebuildGame(scripted.saved);
    expect(rebuilt.problems).toEqual([]);
    expect(rebuilt.moon).toEqual([null, null, null, 1]);
    expect(scripted.saved.filter((e) => e.type === "pass_committed")).toHaveLength(3);
  });
});

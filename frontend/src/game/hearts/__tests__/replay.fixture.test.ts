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
  // the app went to the background after the 4th trick of hand 1 and the 12th of hand 2
  setRng(createSeededRng(37));
  const parts = playRecordedGame({
    maxHands: 2,
    flushAfter: (s) =>
      (s.handNumber === 1 && s.tricksPlayedInHand === 4) ||
      (s.handNumber === 2 && s.tricksPlayedInHand === 12),
  });
  return { full, scripted, parts };
}

describe("hearts_replay_v1.json", () => {
  it("is what the app records today", () => {
    const { full, scripted, parts } = games();
    const fresh = {
      six_hands: full.saved.map((e) => ({ type: e.type, data: e.data })),
      queen_and_moon: scripted.saved.map((e) => ({ type: e.type, data: e.data })),
      two_hands_in_parts: parts.saved.map((e) => ({ type: e.type, data: e.data })),
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
    const { full, scripted, parts } = games();
    expect(full.final.scoreHistory.length).toBe(6);
    expect(rebuildGame(full.saved).problems).toEqual([]);
    const rebuilt = rebuildGame(scripted.saved);
    expect(rebuilt.problems).toEqual([]);
    expect(rebuilt.moon).toEqual([null, null, null, 1]);
    expect(scripted.saved.filter((e) => e.type === "hand_opened" && "p" in e.data)).toHaveLength(3);
    // a hand in parts: 4 tricks, then 8, then 1 of hand 2 ... (the part after a flush starts at `n`)
    expect(
      parts.saved
        .filter((e) => e.type === "hand_played")
        .map((e) => (e.data as { n?: number }).n ?? 1)
    ).toEqual([1, 5, 1, 13]);
    expect(rebuildGame(parts.saved).problems).toEqual([]);
  });
});

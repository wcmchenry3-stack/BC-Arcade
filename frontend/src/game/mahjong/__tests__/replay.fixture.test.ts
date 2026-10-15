/**
 * The Mahjong events the app really builds, pinned for the backend (#3285).
 *
 * `backend/tests/fixtures/mahjong_replay_v1.json` holds the saved events
 * (envelope included) of two seeded games played through the real engine and
 * GameRecorder: a Turtle game played to a cleared board, and a short Pyramid
 * game, each with shuffles, undos and hints, and each with its `game_started`
 * deal fields. The backend test (`tests/test_mahjong_replay.py`) feeds every
 * event to `validate_event`, so a change to what the app records that the
 * server would drop fails here first.
 *
 * To regenerate after an intended change to the events (bump `v` if it is
 * breaking): `UPDATE_MAHJONG_REPLAY_FIXTURE=1 npx jest src/game/mahjong/__tests__/replay.fixture.test.ts`
 */

import fs from "fs";
import path from "path";

import { dealEventData, setRng } from "../engine";
import { gameOutcome, playScripted, rebuildGame } from "./helpers/replayGame";

const FIXTURE = path.resolve(
  __dirname,
  "../../../../../backend/tests/fixtures/mahjong_replay_v1.json"
);

afterEach(() => setRng(Math.random));

function games() {
  const cleared = playScripted({ layout: "turtle", seed: 42 });
  const short = playScripted({ layout: "pyramid", seed: 7, shuffleSeed: 5, maxSteps: 45 });
  return { cleared, short };
}

function fixtureOf(game: ReturnType<typeof playScripted>) {
  return {
    game_started: dealEventData(game.start.layout, game.start.seed),
    // `t_ms` is wall-clock time: pinned to a plausible pace (2 minutes a chunk) so the file is stable
    events: game.saved.map((e) => {
      const data = e.data as { unit: number };
      return { type: e.type, data: { ...data, t_ms: data.unit * 120_000 } };
    }),
  };
}

describe("mahjong_replay_v1.json", () => {
  it("is what the app records today", () => {
    const { cleared, short } = games();
    const fresh = { turtle_cleared: fixtureOf(cleared), pyramid_short: fixtureOf(short) };
    if (process.env.UPDATE_MAHJONG_REPLAY_FIXTURE === "1") {
      // one event per line: a readable diff, a small file
      const body = Object.entries(fresh).map(
        ([name, game]) =>
          ` ${JSON.stringify(name)}: {\n  "game_started": ${JSON.stringify(game.game_started)},\n  "events": [\n${game.events
            .map((e) => `   ${JSON.stringify(e)}`)
            .join(",\n")}\n  ]\n }`
      );
      fs.writeFileSync(FIXTURE, `{\n${body.join(",\n")}\n}\n`);
    }
    expect(JSON.parse(fs.readFileSync(FIXTURE, "utf8"))).toEqual(fresh);
  });

  it("covers every kind of entry and rebuilds both games", () => {
    const { cleared, short } = games();
    for (const game of [cleared, short]) {
      const kinds = new Set(
        game.entries.map((e) =>
          Array.isArray(e) ? "match" : typeof e === "string" ? e : "shuffle"
        )
      );
      expect([...kinds].sort()).toEqual(["h", "match", "shuffle", "u"]);
      expect(gameOutcome(rebuildGame(game.start, game.saved))).toEqual(gameOutcome(game.final));
    }
    expect(cleared.final.isComplete).toBe(true);
  });
});

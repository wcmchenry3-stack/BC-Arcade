/**
 * Cascade's golden replay (#3858, the replay-compatibility policy #3908): one seeded game played
 * on the real engine and recorded through the real GameRecorder, as the screen records it, pinned
 * in `backend/tests/fixtures/cascade_replay_v1.json` and checked by the app and the backend.
 *
 * The fixture holds the `game_started` data, every saved `drop` and `merge` event (envelope
 * included) and the `game_ended` data (#3700's result block plus the end and capstone steps).
 * This test re-records the game and requires the same file, then rebuilds the game from the
 * fixture's events alone on a fresh engine (`rebuild.ts`, V8 here) and requires the hand-written
 * final score, merge count and outcome below. The backend test
 * (`tests/test_cascade_replay_events.py`) validates every event and reads the game's story from
 * its merges and outcome, without re-simulating.
 *
 * The expectations are written out by hand (NOT read from the fixture or the recorder), so the
 * engine and the recorder cannot drift together: a change to the physics, the ladder, the queue
 * or the recording moves what the seeded game produces and fails here. Such a change bumps
 * `ENGINE_VERSION` (engine.ts) and keeps this fixture for the old rules (#3908;
 * docs/CI-CHECKS.md#replay-fixture-version-guard-3911).
 *
 * To regenerate after an intended change (say why in the PR), then copy the new numbers below:
 * `UPDATE_CASCADE_REPLAY_FIXTURE=1 npx jest src/game/cascade/__tests__/replay.fixture.test.ts`
 */
import fs from "fs";
import path from "path";

import type { EnqueueEventInput } from "../../_shared/gameEventClient";
import { GameRecorder } from "../../_shared/gameRecorder";
import { rebuild } from "../rebuild";
import { cascadeCompletion, cascadeResultBlock } from "../resultBlock";
import { skilledBot, type Bot } from "../sim/bots";
import { playRecordedGame } from "./helpers/recordedGame";

const FIXTURE = path.resolve(
  __dirname,
  "../../../../../backend/tests/fixtures/cascade_replay_v1.json"
);

/** The skilled bot at a careful player's pace: a drop every 2 s. */
const BOT: Bot = { ...skilledBot, name: "skilled-2s", nextDelayMs: () => 2000 };
const SEEDS = { queue: 1003, engine: 2003 };
const BOT_SEED = 3;

// Hand-written expectations for this seeded game: it ends in the win. Re-recorded on the 12-tier
// ladder (#3967 / #3975, owner decision #3974; was 143 drops, 132 merges, 6430, step 17450, 8
// units on the 11-tier ladder with 20-drop units).
const EXPECTED = {
  outcome: "win",
  drops: 271,
  merges: 242,
  score: 18862,
  capstoneStep: 32799,
  units: 10,
};

interface Golden {
  game_started: Record<string, unknown> & { engine_seed: number };
  events: { type: string; data: Record<string, unknown> }[];
  game_ended: Record<string, unknown> & { end_step: number; capstone_step?: number };
}

/** Plays the seeded game through the real engine and recorder, as the screen does. */
function playGolden(): Golden {
  const saved: EnqueueEventInput[] = [];
  let t = 0;
  const recorder = new GameRecorder<"cascade">({
    gameType: "cascade",
    sink: {
      canAccept: () => true,
      enqueueMany: (batch) => {
        saved.push(...batch);
        return true;
      },
    },
    now: () => (t += 10),
    schedule: () => undefined, // saved at endSession
  });
  recorder.startSession();
  const game = playRecordedGame(
    {
      beginUnit: (n) => recorder.beginUnit(n),
      record: (type, data) => recorder.record(type, data),
      closeUnit: () => recorder.closeUnit(),
    },
    { seeds: SEEDS, bot: BOT, botSeed: BOT_SEED, maxSimMs: 600_000 }
  );
  recorder.endSession();
  const outcome = game.outcome ?? "abandoned";
  const block = cascadeResultBlock(
    {
      mergeScore: game.score,
      durationMs: Math.round(game.simMs),
      theme: "fruits",
      drops: game.drops,
      merges: game.merges,
      maxTier: 0,
    },
    outcome === "abandoned" ? null : outcome
  );
  const { payload } = cascadeCompletion(block, outcome);
  return {
    game_started: { ...game.started },
    events: saved.map((e) => ({ type: e.type, data: e.data as Record<string, unknown> })),
    game_ended: { ...payload, ...game.end },
  };
}

const read = (): Golden => JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Golden;

describe("cascade_replay_v1.json", () => {
  it("is what the app records today", () => {
    const fresh = playGolden();
    if (process.env.UPDATE_CASCADE_REPLAY_FIXTURE === "1") {
      // one event per line: a readable diff, a small file
      fs.writeFileSync(
        FIXTURE,
        `{\n "game_started": ${JSON.stringify(fresh.game_started)},\n "events": [\n${fresh.events
          .map((e) => `  ${JSON.stringify(e)}`)
          .join(",\n")}\n ],\n "game_ended": ${JSON.stringify(fresh.game_ended)}\n}\n`
      );
    }
    // The fixture's game_started has an `app_version` the app no longer records (dropped until
    // #3942): an optional key that no replay reads, so it is left out of the comparison.
    const pinned = read();
    const { app_version: _appVersion, ...pinnedStart } = pinned.game_started;
    expect({ ...pinned, game_started: pinnedStart }).toEqual(JSON.parse(JSON.stringify(fresh)));
  });

  it("rebuilds from its events alone to the hard-coded score, merges and outcome", () => {
    const golden = read();
    const r = rebuild(golden.game_started, golden.events, golden.game_ended.end_step);
    if (!r.ok) throw new Error(r.reason);
    expect(r.outcome).toBe(EXPECTED.outcome);
    expect(r.drops).toBe(EXPECTED.drops);
    expect(r.merges).toHaveLength(EXPECTED.merges);
    expect(r.score).toBe(EXPECTED.score);
    expect(r.capstoneStep).toBe(EXPECTED.capstoneStep);
  });

  it("the rebuilt merges are the recorded ones, step, tier and chain", () => {
    const golden = read();
    const r = rebuild(golden.game_started, golden.events, golden.game_ended.end_step);
    if (!r.ok) throw new Error(r.reason);
    const recorded = golden.events.filter((e) => e.type === "merge").flatMap((e) => e.data.m);
    expect(r.merges).toEqual(recorded);
  });

  it("game_ended tells the outcome on its own: the score, the time bonus, the capstone's step", () => {
    const { game_ended: ended, events } = read();
    expect(ended.outcome).toBe(EXPECTED.outcome);
    expect(ended.merge_score).toBe(EXPECTED.score);
    expect(ended.total_drops).toBe(EXPECTED.drops);
    expect(ended.total_merges).toBe(EXPECTED.merges);
    expect(ended.capstone_step).toBe(EXPECTED.capstoneStep);
    expect(ended.final_score).toBe((ended.merge_score as number) + (ended.time_bonus as number));
    // The merges alone give the score: a merge into tier n scores 2^n.
    const merges = events.filter((e) => e.type === "merge").flatMap((e) => e.data.m as number[][]);
    expect(merges.reduce((n, [, from]) => n + 2 ** (from! + 1), 0)).toBe(EXPECTED.score);
  });

  it("is EXPECTED.units units of a drop and a merge event, numbered from 1", () => {
    const { events } = read();
    const units = [...new Set(events.map((e) => e.data.unit))];
    expect(units).toEqual(Array.from({ length: EXPECTED.units }, (_, i) => i + 1));
    expect(events.map((e) => e.type)).toEqual(
      Array.from({ length: EXPECTED.units }, () => ["drop", "merge"]).flat()
    );
  });
});

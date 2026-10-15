/**
 * #3280: Star Swarm's `wave_completed` goes through the shared recorder (`on_session_end`), with no
 * change on the wire and no recorder work in the frame path.
 *
 *  - Payload identity: for scripted runs, the events the recorder saves carry byte-for-byte the
 *    JSON the old path queued (`planWaveEvents` queued `{ type, data: wave }` for each closed
 *    wave, `data` untouched), with no recorder envelope (`v`/`unit`/`t_ms`/`actor`) added.
 *  - Frame loop: ticking the engine — through wave closes and a game over — never calls the
 *    recorder, and no engine or canvas file imports it. The screen records from its game-over /
 *    abandon hook (StarSwarmScreen `sendClosedWaves`), outside the frame path.
 */
import * as fs from "fs";
import * as path from "path";

import { CANVAS_H, CANVAS_W, initStarSwarm, tick } from "../engine";
import type { WaveStatsWire } from "../engine";
import { WAVE_COMPLETED_EVENT } from "../waveEvents";
import { GameRecorder } from "../../_shared/gameRecorder";
import type { EnqueueEventInput } from "../../_shared/gameEventClient";
import type { StarSwarmState } from "../types";
import { clearWave, killShip, untilPlaying } from "./helpers/engineFixtures";

/** The old path: one `{ type, data: wave }` per closed wave, `data` untouched. */
const oldPathEvents = (waves: readonly WaveStatsWire[]): EnqueueEventInput[] =>
  waves.map((data) => ({ type: WAVE_COMPLETED_EVENT, data }));

/** The new path, as the screen drives it: record each wave, then end the session. */
function newPathEvents(waves: readonly WaveStatsWire[]): EnqueueEventInput[] {
  const saved: EnqueueEventInput[] = [];
  const recorder = new GameRecorder({
    gameType: "starswarm",
    policy: "on_session_end",
    sink: {
      canAccept: () => true,
      enqueueMany: (events) => {
        saved.push(...events);
        return true;
      },
    },
    schedule: () => undefined,
    report: () => undefined,
  });
  for (const w of waves) recorder.record(WAVE_COMPLETED_EVENT, { ...w });
  recorder.endSession();
  return saved;
}

/** A scripted run: clears three waves, then loses the last life on the fourth. */
function scriptedRun(): StarSwarmState {
  let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Commander");
  for (let i = 0; i < 3; i++) s = clearWave(untilPlaying(s));
  return killShip(untilPlaying(s));
}

describe("wave_completed payload through the recorder (#3280)", () => {
  it("a scripted run's events are byte-identical to the old path's", () => {
    const run = scriptedRun();
    expect(run.closedWaves.length).toBeGreaterThanOrEqual(4);
    const before = oldPathEvents(run.closedWaves);
    const after = newPathEvents(run.closedWaves);
    expect(after).toEqual(before);
    expect(after.map((e) => JSON.stringify(e.data))).toEqual(
      before.map((e) => JSON.stringify(e.data))
    );
    for (const e of after) {
      expect(e.type).toBe("wave_completed");
      expect(e.data).not.toHaveProperty("unit");
      expect(e.data).not.toHaveProperty("t_ms");
      expect(e.data).not.toHaveProperty("actor");
      expect(e.data).not.toHaveProperty("part");
    }
  });

  it("the golden replay's pinned waves go out as the pinned bytes", () => {
    const pinned = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "__fixtures__", "golden-replay-seed42.waves.json"),
        "utf8"
      )
    ) as { closedWaves: WaveStatsWire[] }[];
    const waves = pinned.flatMap((p) => p.closedWaves);
    expect(waves.length).toBeGreaterThan(0);
    expect(newPathEvents(waves).map((e) => JSON.stringify(e.data))).toEqual(
      waves.map((w) => JSON.stringify(w))
    );
  });

  it("a dev-flagged wave keeps its `dev` field", () => {
    const run = scriptedRun();
    const flagged = run.closedWaves.map((w, i) => (i === 0 ? { ...w, dev: true } : w));
    const [first] = newPathEvents(flagged);
    expect(first?.data).toEqual(flagged[0]);
    expect(first?.data?.dev).toBe(true);
  });
});

describe("no recorder work in the frame loop (#3280)", () => {
  const spies: jest.SpyInstance[] = [];
  afterEach(() => {
    while (spies.length) spies.pop()?.mockRestore();
  });

  it("ticking through wave closes and a game over never calls the recorder", () => {
    const proto = GameRecorder.prototype as unknown as Record<string, () => unknown>;
    for (const name of Object.getOwnPropertyNames(GameRecorder.prototype)) {
      if (name === "constructor" || typeof proto[name] !== "function") continue;
      spies.push(jest.spyOn(GameRecorder.prototype as never, name as never));
    }
    expect(spies.length).toBeGreaterThan(5); // record, beginUnit, closeUnit, endSession, ...

    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Commander");
    s = clearWave(untilPlaying(s)); // a wave closes: `closedWaves` grows
    for (let i = 0; i < 120; i++) s = tick(s, 16, { playerX: CANVAS_W / 2, fire: true });
    s = killShip(untilPlaying(s)); // and a run ends
    expect(s.closedWaves.length).toBeGreaterThanOrEqual(2);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("no engine, render or canvas file imports the recorder (the screen does)", () => {
    const root = path.join(__dirname, "..", "..", "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
      }
    };
    walk(path.join(root, "game", "starswarm"));
    walk(path.join(root, "components", "starswarm"));
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((f) =>
      /from\s+["'][^"']*[gG]ameRecorder["']/.test(fs.readFileSync(f, "utf8"))
    );
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });
});

/**
 * #3393: a run's kept wave timelines go out through the shared recorder (`on_session_end`) as
 * `wave_timeline` events, after every `wave_completed`, the run's last death first
 * (docs/games/starswarm-diagnostics.md#sending-order-and-caps):
 *
 *  - order and payloads: every wave first, then the died timeline of the highest wave, then the
 *    others oldest first; each payload exactly as the engine built it (no envelope);
 *  - caps: the 80 KB session (D4) holds a 64 KB run of waves plus 16 KB of timelines whole; past
 *    it the recorder cuts from the end, so timelines go before any wave and cleared-wave
 *    timelines before the death's; past RECORDER_MAX_RAW_EVENTS the died timeline still fits;
 *  - the frame path: playing a recorded run makes no recorder, queue, storage or network call
 *    and never serializes a timeline or the state;
 *  - the dial off: a run started with `timelineOn` false keeps nothing, so nothing is recorded.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { CANVAS_H, CANVAS_W, _resetIds, initStarSwarm, tick } from "../engine";
import { TL, type WaveTimelineWire } from "../engine/waveTimeline";
import { WAVE_COMPLETED_EVENT, WAVE_TIMELINE_EVENT, timelinesInSendOrder } from "../waveEvents";
import { GameRecorder, type RecordingDropReport } from "../../_shared/gameRecorder";
import { GameEventClientImpl, type EnqueueEventInput } from "../../_shared/gameEventClient";
import {
  RECORDER_MAX_RAW_EVENTS,
  TIMELINE_MAX_BYTES,
  TIMELINE_RUN_MAX_BYTES,
  WAVE_STATS_MAX_BYTES,
  WAVE_STATS_RUN_MAX_BYTES,
  recordingConfigFor,
} from "../../_shared/eventQueueConfig";
import type { StarSwarmState } from "../types";
import { NO_INPUT, clearWave, killShip, shotOnShip, untilPlaying } from "./helpers/engineFixtures";
import { pilot, stubMathRandom } from "./helpers/timelineRuns";
import { SCENARIOS, dtFor } from "./helpers/goldenRuns";

function recording(): StarSwarmState {
  return initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Commander", undefined, undefined, {
    timelineOn: true,
  });
}

/** One tick in which a shot takes the ship's plate: the wave is damaged. */
function hit(s: StarSwarmState): StarSwarmState {
  return tick(
    {
      ...s,
      player: { ...s.player, hull: 1, invincibleTimer: 0 },
      activePowerUp: null,
      enemyBullets: [shotOnShip(s)],
    },
    16,
    NO_INPUT
  );
}

/** Wave 1 damaged, wave 2 clean, wave 3 damaged, all cleared; the run then dies on wave 4. */
function scriptedRun(): StarSwarmState {
  let s = clearWave(hit(untilPlaying(recording())));
  s = clearWave(untilPlaying(s));
  s = clearWave(hit(untilPlaying(s)));
  return killShip(untilPlaying(s));
}

/** What the screen's `sendClosedWaves` records, through a real recorder, then the session end. */
function sendRun(waves: readonly object[], timelines: readonly object[]) {
  const saves: EnqueueEventInput[][] = [];
  const reports: RecordingDropReport[] = [];
  const recorder = new GameRecorder({
    gameType: "starswarm",
    policy: "on_session_end",
    sink: {
      canAccept: () => true,
      enqueueMany: (events) => {
        saves.push([...events]);
        return true;
      },
    },
    schedule: () => undefined, // nothing is measured before the session ends
    report: (r) => reports.push(r),
  });
  for (const w of waves) recorder.record(WAVE_COMPLETED_EVENT, { ...w });
  for (const tl of timelines) recorder.record(WAVE_TIMELINE_EVENT, { ...tl });
  expect(saves).toEqual([]);
  recorder.endSession();
  return { events: saves.flat(), saves, report: reports[0] ?? null };
}

const tl = (wave: number, outcome: "cleared" | "died"): WaveTimelineWire => ({
  v: 1,
  ev: 1,
  wave,
  outcome,
  dev: outcome === "died" && wave < 9,
  ovf: [0, 0, 0],
  e: [outcome === "cleared" ? [10, TL.WAVE_CLEARED] : [10, TL.RUN_LOST, 0]],
});

describe("timelinesInSendOrder (#3393)", () => {
  it("puts the died timeline of the highest wave first, then the rest oldest first", () => {
    const kept = [
      tl(1, "cleared"),
      tl(2, "died"),
      tl(2, "cleared"),
      tl(5, "died"),
      tl(3, "cleared"),
    ];
    expect(timelinesInSendOrder(kept).map((t) => [t.wave, t.outcome])).toEqual([
      [5, "died"],
      [1, "cleared"],
      [2, "died"],
      [2, "cleared"],
      [3, "cleared"],
    ]);
    // the timelines themselves, not copies; the input is untouched
    expect(timelinesInSendOrder(kept)[0]).toBe(kept[3]);
    expect(kept.map((t) => t.wave)).toEqual([1, 2, 2, 5, 3]);
  });

  it("keeps the order when there is no death (an abandoned run), and handles none", () => {
    const kept = [tl(1, "cleared"), tl(3, "cleared")];
    const out = timelinesInSendOrder(kept);
    expect(out).toEqual(kept);
    expect(out).not.toBe(kept);
    expect(timelinesInSendOrder([])).toEqual([]);
  });
});

describe("wave_timeline through the recorder (#3393)", () => {
  it("a run's waves go first, then the death's timeline, then the damaged cleared ones, as is", () => {
    const run = scriptedRun();
    expect(run.phase).toBe("GameOver");
    expect(run.closedTimelines.map((t) => [t.wave, t.outcome])).toEqual([
      [1, "cleared"],
      [3, "cleared"],
      [4, "died"],
    ]);
    expect(run.closedTimelinesOverflow.clean).toBe(1); // wave 2 took no damage
    const { events, saves, report } = sendRun(
      run.closedWaves,
      timelinesInSendOrder(run.closedTimelines)
    );
    expect(saves).toHaveLength(1); // one save, ahead of game_ended
    expect(report).toBeNull();
    expect(events.map((e) => [e.type, e.data!.wave, e.data!.outcome])).toEqual([
      ...run.closedWaves.map((w) => [WAVE_COMPLETED_EVENT, w.wave, w.outcome]),
      [WAVE_TIMELINE_EVENT, 4, "died"],
      [WAVE_TIMELINE_EVENT, 1, "cleared"],
      [WAVE_TIMELINE_EVENT, 3, "cleared"],
    ]);
    // byte for byte the engine's wire form: no recorder envelope
    const sentTimelines = events.filter((e) => e.type === WAVE_TIMELINE_EVENT);
    expect(sentTimelines.map((e) => JSON.stringify(e.data))).toEqual(
      timelinesInSendOrder(run.closedTimelines).map((t) => JSON.stringify(t))
    );
    for (const e of sentTimelines) {
      for (const k of ["unit", "t_ms", "actor", "part"]) expect(e.data).not.toHaveProperty(k);
    }
    // every timeline follows the wave_completed it joins (same wave and outcome)
    sentTimelines.forEach((e) => {
      const at = events.indexOf(e);
      const row = events.findIndex(
        (w) =>
          w.type === WAVE_COMPLETED_EVENT &&
          w.data!.wave === e.data!.wave &&
          w.data!.outcome === e.data!.outcome
      );
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(at);
    });
  });

  /** A payload of exactly `bytes` JSON length. */
  function sized(bytes: number, base: Record<string, unknown>): Record<string, unknown> {
    const empty = JSON.stringify({ ...base, pad: "" }).length;
    const out = { ...base, pad: "x".repeat(bytes - empty) };
    expect(JSON.stringify(out).length).toBe(bytes);
    return out;
  }

  it("the 80 KB session holds a 64 KB run of waves plus 16 KB of timelines whole (D4)", () => {
    expect(recordingConfigFor("starswarm").sessionMaxBytes).toBe(
      WAVE_STATS_RUN_MAX_BYTES + TIMELINE_RUN_MAX_BYTES
    );
    const waves = Array.from({ length: WAVE_STATS_RUN_MAX_BYTES / WAVE_STATS_MAX_BYTES }, (_, i) =>
      sized(WAVE_STATS_MAX_BYTES, { wave: i + 1, outcome: "cleared" })
    );
    const timelines = Array.from({ length: TIMELINE_RUN_MAX_BYTES / TIMELINE_MAX_BYTES }, (_, i) =>
      sized(TIMELINE_MAX_BYTES, { wave: i === 0 ? 16 : i, outcome: i === 0 ? "died" : "cleared" })
    );
    const { events, report } = sendRun(waves, timelines);
    expect(events).toHaveLength(waves.length + timelines.length);
    expect(report).toBeNull();

    // one timeline more: the cut falls on the last timeline, never on a wave or the death's
    const over = [...timelines, sized(TIMELINE_MAX_BYTES, { wave: 99, outcome: "cleared" })];
    const cut = sendRun(waves, over);
    expect(cut.events.filter((e) => e.type === WAVE_COMPLETED_EVENT)).toHaveLength(waves.length);
    const kept = cut.events.filter((e) => e.type === WAVE_TIMELINE_EVENT);
    expect(kept).toHaveLength(timelines.length);
    expect(kept[0]!.data!.outcome).toBe("died");
    expect(kept.map((e) => e.data!.wave)).not.toContain(99);
    expect(cut.report).toMatchObject({ dropped_session_cap: 1 });
  });

  it("past RECORDER_MAX_RAW_EVENTS the excess is dropped as dropped_memory, and the death's timeline is saved", () => {
    const waves = Array.from({ length: RECORDER_MAX_RAW_EVENTS - 6 }, (_, i) => ({ wave: i + 1 }));
    const timelines = [
      { wave: 250, outcome: "died" },
      ...Array.from({ length: 9 }, (_, i) => ({ wave: i + 1, outcome: "cleared" })),
    ];
    const { events, report } = sendRun(waves, timelines);
    expect(events).toHaveLength(RECORDER_MAX_RAW_EVENTS);
    expect(events.filter((e) => e.type === WAVE_COMPLETED_EVENT)).toHaveLength(waves.length);
    const sent = events.filter((e) => e.type === WAVE_TIMELINE_EVENT);
    expect(sent[0]!.data).toEqual({ wave: 250, outcome: "died" });
    expect(report).toMatchObject({ dropped_memory: 4 });
  });
});

describe("no recorder, queue, storage or network work on the frame path (#3393)", () => {
  it("playing a recording run calls none of them and never serializes a timeline or the state", () => {
    _resetIds();
    const random = stubMathRandom(99);
    const fetchSpy = jest.fn();
    const realFetch = (global as { fetch?: unknown }).fetch;
    (global as { fetch?: unknown }).fetch = fetchSpy;
    const spies = [
      jest.spyOn(GameRecorder.prototype, "record"),
      jest.spyOn(GameRecorder.prototype, "flush"),
      jest.spyOn(GameEventClientImpl.prototype, "enqueueEvents"),
      jest.spyOn(AsyncStorage, "setItem"),
      jest.spyOn(AsyncStorage, "getItem"),
      jest.spyOn(AsyncStorage, "removeItem"),
    ];
    const stringify = jest.spyOn(JSON, "stringify");
    try {
      const init = recording();
      let s: StarSwarmState = { ...init, player: { ...init.player, lives: 6 } };
      let appended = 0;
      for (let t = 1; t <= 4000 && s.phase !== "GameOver"; t++) {
        const next = tick(s, t % 7 === 6 ? 33 : 16, pilot(t));
        if (next.waveTimeline !== s.waveTimeline) appended++;
        s = next;
      }
      expect(appended).toBeGreaterThan(0); // the run did capture
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      const serializedTimeline = stringify.mock.calls.filter(([v]) => {
        if (v === null || typeof v !== "object") return false;
        return "closedTimelines" in v || "waveTimeline" in v || ("ovf" in v && "e" in v);
      });
      expect(serializedTimeline).toHaveLength(0);
    } finally {
      stringify.mockRestore();
      for (const spy of spies) spy.mockRestore();
      (global as { fetch?: unknown }).fetch = realFetch;
      random.mockRestore();
    }
  });
});

describe("no frame-path work in the golden scenarios either (#3396)", () => {
  // The seed-42 golden replays (goldenRuns.ts) with the timeline on, dev-panel actions included
  // (power-ups applied, rocks thrown, the escorts killed): the same spies as above, over every
  // tick. Played without the golden's checkpoint hashing, which serializes the state on purpose.
  it.each(SCENARIOS.map((sc) => [sc.name, sc] as const))(
    "%s: no recorder, queue, storage or network call, no timeline serialized",
    (_name, sc) => {
      _resetIds();
      const random = stubMathRandom(1234);
      const fetchSpy = jest.fn();
      const realFetch = (global as { fetch?: unknown }).fetch;
      (global as { fetch?: unknown }).fetch = fetchSpy;
      const spies = [
        jest.spyOn(GameRecorder.prototype, "record"),
        jest.spyOn(GameRecorder.prototype, "flush"),
        jest.spyOn(GameEventClientImpl.prototype, "enqueueEvents"),
        jest.spyOn(AsyncStorage, "setItem"),
        jest.spyOn(AsyncStorage, "getItem"),
        jest.spyOn(AsyncStorage, "removeItem"),
      ];
      const stringify = jest.spyOn(JSON, "stringify");
      try {
        const init = initStarSwarm(
          CANVAS_W,
          CANVAS_H,
          sc.wave,
          42,
          sc.difficulty,
          undefined,
          undefined,
          {
            timelineOn: true,
          }
        );
        let s: StarSwarmState = { ...init, player: { ...init.player, lives: 30 } };
        let appended = 0;
        for (let t = 1; t <= sc.ticks; t++) {
          const action = sc.actions?.[t];
          if (action) s = action(s);
          const next = tick(s, dtFor(t), pilot(t));
          if (next.waveTimeline !== s.waveTimeline) appended++;
          s = next;
        }
        expect(appended).toBeGreaterThan(0);
        expect(s.closedTimelines.length).toBeGreaterThan(0); // a wave closed and was kept
        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
        // the only serialization is the wave close's own `wave_completed` sizing
        // (closedWaves.ts `wireBytes`, once a close): never a timeline, never the state
        const serialized = stringify.mock.calls.filter(([v]) => {
          if (v === null || typeof v !== "object") return true;
          return !("pacing" in v && "outcome" in v && !("e" in v));
        });
        expect(serialized).toHaveLength(0);
        expect(stringify.mock.calls.length).toBeLessThanOrEqual(s.closedWaves.length);
      } finally {
        stringify.mockRestore();
        for (const spy of spies) spy.mockRestore();
        (global as { fetch?: unknown }).fetch = realFetch;
        random.mockRestore();
      }
    },
    60_000
  );
});

describe("the dial off (#3393)", () => {
  it("a run started with timelineOn false keeps no timelines, so nothing is recorded", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Commander");
    s = killShip(untilPlaying(clearWave(hit(untilPlaying(s)))));
    expect(s.phase).toBe("GameOver");
    expect(s.waveTimeline).toBeNull();
    expect(s.closedTimelines).toEqual([]);
    expect(s.closedTimelinesOverflow).toMatchObject({ unrecorded: 0, clean: 0, waves: 0 });
    const { events } = sendRun(s.closedWaves, timelinesInSendOrder(s.closedTimelines));
    expect(events.filter((e) => e.type === WAVE_TIMELINE_EVENT)).toEqual([]);
    expect(events.length).toBe(s.closedWaves.length);
  });
});

/**
 * #3393: at the run's end the screen records the kept wave timelines (`state.closedTimelines`) as
 * `wave_timeline` events, after every `wave_completed` and with the run's last death first, in the
 * same single save ahead of `game_ended` (or of the abandon, on the old run's session). Nothing is
 * recorded during play. The engine-drop report carries the timeline counts and fires on a cap
 * loss only. The canvas creates each run with the replay dial's flag. The canvas is the shared
 * stand-in (helpers/starSwarmMocks): `canvas.state` is what its getState() returns.
 */
import { act, fireEvent, screen } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import {
  CANVAS_H,
  CANVAS_W,
  closeWave,
  initStarSwarm,
  toWirePayload,
  type WaveStatsWire,
} from "../../game/starswarm/engine";
import {
  NO_TIMELINE_OVERFLOW,
  TL,
  type ClosedTimelinesOverflow,
  type WaveTimelineWire,
} from "../../game/starswarm/engine/waveTimeline";
import {
  _resetPauseStoreForTests,
  clearSavedPausedState,
  savePausedState,
} from "../../game/starswarm/pauseStore";
import type { StarSwarmState } from "../../game/starswarm/types";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";
import { GameRecorder } from "../../game/_shared/gameRecorder";
import { __resetReplayDialForTests } from "../../game/_shared/replayDial";
import { canvas, resetHarness } from "./helpers/starSwarmMocks";
import { renderRun, renderScreen } from "./helpers/starSwarmHarness";

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  }))
);
jest.mock("../../components/starswarm/GameCanvas", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("./helpers/starSwarmMocks").canvasModule()
);
jest.mock("../../hooks/useStarSwarmAudio", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("./helpers/starSwarmMocks").audioModule()
);
jest.mock("../../game/starswarm/telemetry", () => ({ reportRunStats: jest.fn() }));
jest.mock("../../api/stats", () =>
  mockScreenDeps().mockStatsApi({
    getGameRank: jest.fn(() =>
      Promise.resolve({ rank: null, is_best: null, ranked: false, reason: "not_rankable" })
    ),
  })
);
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../game/_shared/displayNameSync", () => mockScreenDeps().mockDisplayNameSync());

const mockStartGame = jest.fn((): string | null => "run-1");
const mockEnqueueEvents = jest.fn();
const mockCompleteGame = jest.fn();
const mockResumeGame = jest.fn((): string | null => null);
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    enqueueEvents: lazy(() => mockEnqueueEvents),
    completeGame: lazy(() => mockCompleteGame),
    resumeGame: lazy(() => mockResumeGame),
    markStarted: jest.fn(),
    discardGame: jest.fn(),
  });
});

const captureMessage = Sentry.captureMessage as jest.Mock;
const flush = () => new Promise((r) => setImmediate(r));

function closed(n: number, outcome: "cleared" | "died" = "cleared"): WaveStatsWire {
  return toWirePayload(closeWave(initStarSwarm(CANVAS_W, CANVAS_H, n, 7, "Commander"), outcome));
}

/** A kept timeline of wave `n` in wire form. */
function timeline(n: number, outcome: "cleared" | "died" = "cleared"): WaveTimelineWire {
  return {
    v: 1,
    ev: 1,
    wave: n,
    outcome,
    dev: false,
    ovf: [0, 0, 0],
    e: [
      [20, TL.HULL_HIT, 0, 30, 0],
      outcome === "cleared" ? [90, TL.WAVE_CLEARED] : [90, TL.RUN_LOST, 0],
    ],
  };
}

const len = (v: unknown) => JSON.stringify(v).length;

/** The engine's state with these waves and timelines collected. */
function engineWith(
  closedWaves: readonly WaveStatsWire[],
  closedTimelines: readonly WaveTimelineWire[],
  { over = true, overflow = NO_TIMELINE_OVERFLOW as ClosedTimelinesOverflow } = {}
): StarSwarmState {
  const s = initStarSwarm(CANVAS_W, CANVAS_H, closedWaves.length || 1, 7, "Commander");
  return {
    ...s,
    phase: over ? "GameOver" : "Playing",
    closedWaves,
    timelineOn: true,
    closedTimelines,
    closedTimelinesLens: closedTimelines.map(len),
    closedTimelinesBytes: closedTimelines.reduce((n, tl) => n + len(tl), 0),
    closedTimelinesOverflow: overflow,
  };
}

async function gameOver(score = 1000, wave = 3) {
  await act(async () => {
    canvas.props.onGameOver(score, wave);
  });
}

const savedEvents = () =>
  mockEnqueueEvents.mock.calls.flatMap(([gid, events]) =>
    (events as { type: string; data: Record<string, unknown> }[]).map((ev) => [gid, ev] as const)
  );

/** Every event saved: [gameId, type, wave, outcome]. */
const sent = () => savedEvents().map(([gid, ev]) => [gid, ev.type, ev.data.wave, ev.data.outcome]);

beforeEach(async () => {
  jest.clearAllMocks();
  mockStartGame.mockReturnValue("run-1");
  resetHarness();
  clearSavedPausedState();
  __resetReplayDialForTests();
  await AsyncStorage.clear();
  await AsyncStorage.setItem("starswarm.difficulty", "Commander");
  resetDisplayNameCacheForTests();
});

afterEach(() => clearSavedPausedState());

describe("StarSwarmScreen — wave_timeline events (#3393)", () => {
  it("at game over: every wave, then the death's timeline, then the others, in one save before game_ended", async () => {
    await renderRun();
    const waves = [closed(1), closed(2), closed(3, "died")];
    const timelines = [timeline(1), timeline(3, "died")];
    canvas.state = engineWith(waves, timelines);
    await gameOver();
    expect(sent()).toEqual([
      ["run-1", "wave_completed", 1, "cleared"],
      ["run-1", "wave_completed", 2, "cleared"],
      ["run-1", "wave_completed", 3, "died"],
      ["run-1", "wave_timeline", 3, "died"],
      ["run-1", "wave_timeline", 1, "cleared"],
    ]);
    // as the engine built them: no recorder envelope
    const tls = savedEvents().filter(([, ev]) => ev.type === "wave_timeline");
    expect(tls.map(([, ev]) => JSON.stringify(ev.data))).toEqual(
      [timelines[1], timelines[0]].map((t) => JSON.stringify(t))
    );
    expect(mockEnqueueEvents).toHaveBeenCalledTimes(1);
    const lastEnqueue = Math.max(...mockEnqueueEvents.mock.invocationCallOrder);
    expect(lastEnqueue).toBeLessThan(mockCompleteGame.mock.invocationCallOrder[0]!);
    expect(captureMessage).not.toHaveBeenCalled();
    // once a run
    await gameOver();
    expect(sent()).toHaveLength(5);
  });

  it("makes no recorder call during play, only at game over", async () => {
    await renderRun();
    const spy = jest.spyOn(GameRecorder.prototype, "record");
    try {
      canvas.state = engineWith([closed(1)], [timeline(1)], { over: false });
      for (let i = 1; i <= 5; i++) {
        await act(async () => {
          canvas.props.onWaveClear();
          canvas.props.onScoreChange(i * 100);
        });
      }
      expect(spy).not.toHaveBeenCalled();
      expect(mockEnqueueEvents).not.toHaveBeenCalled();
      canvas.state = engineWith([closed(1), closed(2, "died")], [timeline(1), timeline(2, "died")]);
      await gameOver();
      expect(spy).toHaveBeenCalledTimes(4);
    } finally {
      spy.mockRestore();
    }
  });

  it("a run abandoned for a new one records its timelines on its own session, before the abandon", async () => {
    await renderRun();
    canvas.state = engineWith([closed(1), closed(2)], [timeline(2)], { over: false });
    mockStartGame.mockReturnValue("run-2");
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Pause game" }));
    });
    await act(async () => {
      await fireEvent.press(screen.getByText("NEW GAME"));
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId("starswarm-start-game"));
    });
    expect(sent()).toEqual([
      ["run-1", "wave_completed", 1, "cleared"],
      ["run-1", "wave_completed", 2, "cleared"],
      ["run-1", "wave_timeline", 2, "cleared"],
    ]);
    const abandon = mockCompleteGame.mock.calls.findIndex(
      ([gid, summary]) => gid === "run-1" && summary.outcome === "abandoned"
    );
    expect(abandon).toBeGreaterThanOrEqual(0);
    const lastEnqueue = Math.max(...mockEnqueueEvents.mock.invocationCallOrder);
    expect(lastEnqueue).toBeLessThan(mockCompleteGame.mock.invocationCallOrder[abandon]!);
  });

  it("a run resumed after the app was killed sends the timelines its save kept", async () => {
    mockResumeGame.mockReturnValueOnce("killed-process-game");
    const waves = [closed(1), closed(2)];
    const timelines = [timeline(2)];
    savePausedState({
      gameState: engineWith(waves, timelines, { over: false }),
      difficulty: "Commander",
      counters: { nextId: 9000, seed: 5 },
    });
    await flush();
    _resetPauseStoreForTests(); // the OS killed the app

    await renderScreen();
    const restored = canvas.props.initialState as StarSwarmState;
    expect(restored.closedTimelines).toEqual(timelines);
    canvas.state = {
      ...restored,
      phase: "GameOver",
      closedWaves: [...waves, closed(3, "died")],
      closedTimelines: [...timelines, timeline(3, "died")],
    };
    await gameOver();
    expect(sent()).toEqual([
      ["killed-process-game", "wave_completed", 1, "cleared"],
      ["killed-process-game", "wave_completed", 2, "cleared"],
      ["killed-process-game", "wave_completed", 3, "died"],
      ["killed-process-game", "wave_timeline", 3, "died"],
      ["killed-process-game", "wave_timeline", 2, "cleared"],
    ]);
  });

  it.each<[string, Partial<ClosedTimelinesOverflow>]>([
    ["timelines dropped by a cap", { waves: 2, bytes: 1800 }],
    ["the list closed to cleared waves", { waves: 1, bytes: 900, full: true }],
  ])("reports %s, with every timeline count", async (_name, counts) => {
    await renderRun();
    const overflow = { ...NO_TIMELINE_OVERFLOW, clean: 4, devRepeats: 1, unrecorded: 2, ...counts };
    canvas.state = engineWith([closed(1, "died")], [timeline(1, "died")], { overflow });
    await gameOver();
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage.mock.calls[0]![1]).toMatchObject({
      level: "warning",
      fingerprint: ["starswarm.waveStats.engineDrop"],
      tags: { subsystem: "starswarm.waveStats" },
    });
    expect(captureMessage.mock.calls[0]![1].extra).toEqual({
      engine_dropped: 0,
      engine_dropped_bytes: 0,
      timeline_dropped: overflow.waves,
      timeline_bytes: overflow.bytes,
      timeline_clean: 4,
      timeline_dev_repeats: 1,
      timeline_unrecorded: 2,
    });
  });

  it("does not report clean waves, dev repeats or unrecorded waves alone: the policy working", async () => {
    await renderRun();
    const overflow = { ...NO_TIMELINE_OVERFLOW, clean: 7, devRepeats: 3, unrecorded: 5 };
    canvas.state = engineWith([closed(1, "died")], [timeline(1, "died")], { overflow });
    await gameOver();
    expect(sent()).toHaveLength(2);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("a state without the timeline fields (never trusted) still sends its waves", async () => {
    await renderRun();
    const s = engineWith([closed(1, "died")], []) as Partial<StarSwarmState>;
    delete s.closedTimelines;
    delete s.closedTimelinesOverflow;
    canvas.state = s as StarSwarmState;
    await gameOver();
    expect(sent()).toEqual([["run-1", "wave_completed", 1, "died"]]);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("hands the canvas the replay dial's flag for each new run", async () => {
    await renderRun();
    const ask = canvas.props.timelineEnabled as () => boolean;
    expect(typeof ask).toBe("function");
    __resetReplayDialForTests({ fallback: { enabled: true, rate: 1 } });
    expect(ask()).toBe(true);
    __resetReplayDialForTests({ fallback: { enabled: false, rate: 1 } }); // the kill switch
    expect(ask()).toBe(false);
  });
});

/**
 * #3251: at game over the screen sends the run's closed waves (`state.closedWaves`, collected by
 * the engine and kept by the paused-run save) as `wave_completed` events — once per run, in wave
 * order, ahead of `game_ended`, within the payload caps. Nothing is sent during play. The canvas
 * is the shared stand-in (helpers/starSwarmMocks): `canvas.state` is what its getState() returns.
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
  _resetPauseStoreForTests,
  clearSavedPausedState,
  savePausedState,
} from "../../game/starswarm/pauseStore";
import { WAVE_STATS_RUN_MAX_BYTES } from "../../game/starswarm/waveEvents";
import type { StarSwarmState } from "../../game/starswarm/types";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";
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
jest.mock("../../components/starswarm/Controls", () => ({
  __esModule: true,
  default: () => null,
  hapticPlayerHit: jest.fn(),
  hapticWaveClear: jest.fn(),
}));
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
const mockEnqueueEvent = jest.fn();
const mockCompleteGame = jest.fn();
const mockResumeGame = jest.fn((): string | null => null);
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    enqueueEvent: lazy(() => mockEnqueueEvent),
    completeGame: lazy(() => mockCompleteGame),
    resumeGame: lazy(() => mockResumeGame),
    markStarted: jest.fn(),
    discardGame: jest.fn(),
  });
});

const captureMessage = Sentry.captureMessage as jest.Mock;
const flush = () => new Promise((r) => setImmediate(r));

/** Wave `n` closed with `outcome`, in wire form, as the engine collects it. */
function closed(n: number, outcome: "cleared" | "died" = "cleared"): WaveStatsWire {
  return toWirePayload(closeWave(initStarSwarm(CANVAS_W, CANVAS_H, n, 7, "Commander"), outcome));
}

/** The engine's state at game over (or mid-run), with these waves collected. */
function engineWith(closedWaves: readonly WaveStatsWire[], over = true): StarSwarmState {
  const s = initStarSwarm(CANVAS_W, CANVAS_H, closedWaves.length || 1, 7, "Commander");
  return { ...s, phase: over ? "GameOver" : "Playing", closedWaves };
}

async function gameOver(score = 1000, wave = 3) {
  await act(async () => {
    canvas.props.onGameOver(score, wave);
  });
}

/** Every wave_completed the screen queued: [gameId, wave, outcome]. */
const sentWaves = () =>
  mockEnqueueEvent.mock.calls
    .filter(([, ev]) => ev.type === "wave_completed")
    .map(([gid, ev]) => [gid, ev.data.wave, ev.data.outcome]);

beforeEach(async () => {
  jest.clearAllMocks();
  mockStartGame.mockReturnValue("run-1");
  resetHarness();
  clearSavedPausedState();
  await AsyncStorage.clear();
  await AsyncStorage.setItem("starswarm.difficulty", "Commander");
  resetDisplayNameCacheForTests();
});

afterEach(() => clearSavedPausedState());

describe("StarSwarmScreen — wave_completed events (#3251)", () => {
  it("sends nothing during play", async () => {
    await renderRun();
    canvas.state = engineWith([closed(1), closed(2)], false);
    // waves clear, the run plays on: the canvas raises its usual events, the screen sends none
    await act(async () => {
      canvas.props.onWaveClear();
      canvas.props.onScoreChange(500);
    });
    expect(mockEnqueueEvent).not.toHaveBeenCalled();
  });

  it("at game over, sends every closed wave in order, the died one last, before game_ended", async () => {
    await renderRun();
    const waves = [closed(1), closed(2), closed(3, "died")];
    canvas.state = engineWith(waves);
    await gameOver();

    expect(sentWaves()).toEqual([
      ["run-1", 1, "cleared"],
      ["run-1", 2, "cleared"],
      ["run-1", 3, "died"],
    ]);
    // the payload is the engine's wire form, as collected
    expect(mockEnqueueEvent.mock.calls.map(([, ev]) => ev.data)).toEqual(waves);
    // queued before completeGame, which queues game_ended: event_index order is send order
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const lastEnqueue = Math.max(...mockEnqueueEvent.mock.invocationCallOrder);
    expect(lastEnqueue).toBeLessThan(mockCompleteGame.mock.invocationCallOrder[0]!);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("sends a run's waves once, however often game over is raised", async () => {
    await renderRun();
    canvas.state = engineWith([closed(1), closed(2, "died")]);
    await gameOver();
    await gameOver(); // e.g. the E2E hook's endRun after the canvas's own call
    expect(sentWaves()).toHaveLength(2);
  });

  it("the next run sends its own waves, on its own session", async () => {
    await renderRun();
    canvas.state = engineWith([closed(1, "died")]);
    await gameOver();
    mockStartGame.mockReturnValue("run-2");
    // the card's Play Again: a new run at the same tier
    await act(async () => {
      await fireEvent.press(screen.getByText("Play Again"));
    });
    canvas.state = engineWith([closed(1), closed(2, "died")]);
    await gameOver();
    expect(sentWaves()).toEqual([
      ["run-1", 1, "died"],
      ["run-2", 1, "cleared"],
      ["run-2", 2, "died"],
    ]);
  });

  it("a run resumed after the app was killed sends the waves its save kept", async () => {
    mockResumeGame.mockReturnValueOnce("killed-process-game");
    const kept = [closed(1), closed(2)];
    savePausedState({
      gameState: engineWith(kept, false),
      difficulty: "Commander",
      counters: { nextId: 9000, seed: 5 },
    });
    await flush();
    _resetPauseStoreForTests(); // the OS killed the app

    await renderScreen();
    const restored = canvas.props.initialState as StarSwarmState;
    expect(restored.closedWaves).toEqual(kept);
    // it plays on and ends on wave 3
    canvas.state = { ...restored, phase: "GameOver", closedWaves: [...kept, closed(3, "died")] };
    await gameOver();
    expect(sentWaves()).toEqual([
      ["killed-process-game", 1, "cleared"],
      ["killed-process-game", 2, "cleared"],
      ["killed-process-game", 3, "died"],
    ]);
  });

  it("over the run's cap: sends the earliest waves that fit, drops the rest, and reports once", async () => {
    await renderRun();
    const big = (n: number): WaveStatsWire => ({
      ...closed(n),
      score: { total: 1, runningTotal: 1, pts: { [`pad${"x".repeat(3000)}`]: 1 } },
    });
    const one = JSON.stringify(big(10)).length;
    const fit = Math.floor(WAVE_STATS_RUN_MAX_BYTES / one);
    const waves = Array.from({ length: fit + 2 }, (_, i) => big(i + 10));
    canvas.state = engineWith(waves);
    await gameOver();
    await gameOver();

    expect(sentWaves()).toHaveLength(fit);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining("wave_completed"), {
      level: "warning",
      tags: { subsystem: "starswarm.waveStats" },
      extra: {
        collected: fit + 2,
        sent: fit,
        dropped: 2,
        totalBytes: one * (fit + 2),
        sentBytes: one * fit,
        largestWaveBytes: one,
      },
    });
    // the run is still recorded
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
  });

  it("drops a wave over the per-wave cap, sends the others, and reports it", async () => {
    await renderRun();
    const huge = {
      ...closed(2),
      score: { total: 1, runningTotal: 1, pts: { [`pad${"x".repeat(5000)}`]: 1 } },
    };
    canvas.state = engineWith([closed(1), huge, closed(3, "died")]);
    await gameOver();
    expect(sentWaves()).toEqual([
      ["run-1", 1, "cleared"],
      ["run-1", 3, "died"],
    ]);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage.mock.calls[0]![1].extra).toMatchObject({
      collected: 3,
      sent: 2,
      dropped: 1,
      largestWaveBytes: JSON.stringify(huge).length,
    });
  });
});

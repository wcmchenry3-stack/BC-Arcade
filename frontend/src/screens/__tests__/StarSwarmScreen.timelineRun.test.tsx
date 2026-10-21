/**
 * #3396: a whole seeded Star Swarm run, played by the real engine with the wave timeline on,
 * through the screen (the canvas is the shared stand-in: each tick's state is what its
 * getState() returns, and its callbacks are raised at the ticks the game loop would raise them).
 *
 *  - No mid-combat work: from the first tick to the last, nothing is recorded, queued, written
 *    to storage or sent; only at game over does the screen record every `wave_completed`, then
 *    the timelines (the death's first), in one save ahead of `game_ended`.
 *  - Reporter failures: when recording a timeline throws, or the queue's save throws, the run
 *    still completes (its result and `game_ended` go out with the right score) and every
 *    `wave_completed` is recorded first; the failure is reported (a recorder throw) or isolated
 *    by the sync layer (a queue throw), never thrown into the game.
 */
import { act, screen } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import type { StarSwarmState } from "../../game/starswarm/types";
import { timelinesInSendOrder } from "../../game/starswarm/waveEvents";
import { playRun } from "../../game/starswarm/__tests__/helpers/timelineGoldenRuns";
import { clearSavedPausedState } from "../../game/starswarm/pauseStore";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";
import { GameRecorder } from "../../game/_shared/gameRecorder";
import { __resetReplayDialForTests } from "../../game/_shared/replayDial";
import { canvas, resetHarness } from "./helpers/starSwarmMocks";
import { renderRun } from "./helpers/starSwarmHarness";

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
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    enqueueEvents: lazy(() => mockEnqueueEvents),
    completeGame: lazy(() => mockCompleteGame),
    resumeGame: jest.fn(() => null),
    markStarted: jest.fn(),
    discardGame: jest.fn(),
  });
});

const captureException = Sentry.captureException as jest.Mock;

/** Ensign from wave 1, 6 lives, the golden pilot until the run ends: every tick's state. */
function seededStates(): StarSwarmState[] {
  const states: StarSwarmState[] = [];
  const { end } = playRun({
    difficulty: "Ensign",
    ticks: 12_000,
    lives: 6,
    timelineOn: true,
    after: (_t, s) => {
      states.push(s);
      return s;
    },
  });
  expect(end.phase).toBe("GameOver");
  return states;
}
let statesCache: StarSwarmState[] | null = null;
const runStates = () => (statesCache ??= seededStates());

/**
 * Plays the run through the screen: each tick's state becomes the canvas's, and the callbacks
 * the game loop raises (score, hit, wave clear) are raised when their value changes. Stops on
 * the GameOver state, before the canvas would raise `onGameOver`.
 */
async function playThroughScreen(states: readonly StarSwarmState[]): Promise<StarSwarmState> {
  let prev = states[0]!;
  for (const s of states) {
    canvas.state = s;
    const score = s.score !== prev.score;
    const hit = s.player.lives < prev.player.lives || s.player.hull < prev.player.hull;
    const cleared = s.wave !== prev.wave;
    if (score || hit || cleared) {
      await act(async () => {
        if (score) canvas.props.onScoreChange?.(s.score);
        if (hit) canvas.props.onPlayerHit?.();
        if (cleared) canvas.props.onWaveClear?.();
      });
    }
    prev = s;
  }
  return prev;
}

async function gameOver(end: StarSwarmState) {
  await act(async () => {
    canvas.props.onGameOver(end.score, end.wave);
  });
}

const savedTypes = () =>
  mockEnqueueEvents.mock.calls.flatMap(([, events]) =>
    (events as { type: string; data: { wave: number; outcome: string } }[]).map(
      (e) => `${e.type}:${e.data.wave}:${e.data.outcome}`
    )
  );

const expectedTypes = (end: StarSwarmState) => [
  ...end.closedWaves.map((w) => `wave_completed:${w.wave}:${w.outcome}`),
  ...timelinesInSendOrder(end.closedTimelines).map((t) => `wave_timeline:${t.wave}:${t.outcome}`),
];

beforeEach(async () => {
  jest.clearAllMocks();
  mockStartGame.mockReturnValue("run-1");
  resetHarness();
  clearSavedPausedState();
  __resetReplayDialForTests({ fallback: { enabled: true, rate: 1 } });
  await AsyncStorage.clear();
  await AsyncStorage.setItem("starswarm.difficulty", "Ensign");
  resetDisplayNameCacheForTests();
});

afterEach(() => clearSavedPausedState());

describe("a whole seeded run through the screen, with the timeline on (#3396)", () => {
  it("does no recorder, queue, storage or network work until the run ends", async () => {
    const states = runStates();
    await renderRun();
    const record = jest.spyOn(GameRecorder.prototype, "record");
    const setItem = jest.spyOn(AsyncStorage, "setItem");
    const fetchSpy = jest.fn();
    const realFetch = (global as { fetch?: unknown }).fetch;
    (global as { fetch?: unknown }).fetch = fetchSpy;
    try {
      const end = await playThroughScreen(states);
      expect(end.phase).toBe("GameOver");
      expect(end.closedTimelines.length).toBeGreaterThan(1);
      // the whole run, combat and extractions included: nothing at all
      expect(record).not.toHaveBeenCalled();
      expect(mockEnqueueEvents).not.toHaveBeenCalled();
      // (the difficulty picker's own preference write, from the start, is the only one)
      expect(setItem.mock.calls.filter(([key]) => key !== "starswarm.difficulty")).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();

      await gameOver(end);
      expect(savedTypes()).toEqual(expectedTypes(end));
      expect(mockEnqueueEvents).toHaveBeenCalledTimes(1);
      expect(Math.max(...mockEnqueueEvents.mock.invocationCallOrder)).toBeLessThan(
        mockCompleteGame.mock.invocationCallOrder[0]!
      );
      // as the engine built them: no envelope
      const sent = mockEnqueueEvents.mock.calls[0]![1] as { type: string; data: unknown }[];
      expect(sent.filter((e) => e.type === "wave_timeline").map((e) => e.data)).toEqual(
        timelinesInSendOrder(end.closedTimelines)
      );
    } finally {
      record.mockRestore();
      setItem.mockRestore();
      (global as { fetch?: unknown }).fetch = realFetch;
    }
  }, 120_000);

  it("a timeline the recorder throws on: every wave still goes, the run completes, it is reported", async () => {
    const states = runStates();
    await renderRun();
    const real = GameRecorder.prototype.record;
    const record = jest.spyOn(GameRecorder.prototype, "record").mockImplementation(function (
      this: GameRecorder,
      type,
      data
    ) {
      if (type === "wave_timeline") throw new Error("recorder broke");
      return real.call(this, type, data);
    });
    try {
      const end = await playThroughScreen(states);
      await gameOver(end);
      const waves = savedTypes().filter((t) => t.startsWith("wave_completed:"));
      expect(waves).toEqual(end.closedWaves.map((w) => `wave_completed:${w.wave}:${w.outcome}`));
      expect(savedTypes().some((t) => t.startsWith("wave_timeline:"))).toBe(false);
      // the run completed with its own score
      expect(mockCompleteGame).toHaveBeenCalledTimes(1);
      expect(mockCompleteGame.mock.calls[0]![1]).toMatchObject({ finalScore: end.score });
      expect(screen.getByText("Play Again")).toBeTruthy();
      expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
        tags: { subsystem: "starswarm.waveStats" },
      });
    } finally {
      record.mockRestore();
    }
  }, 120_000);

  it("the queue's save throws: the run still completes (the sync layer isolates it)", async () => {
    const states = runStates();
    await renderRun();
    mockEnqueueEvents.mockImplementation(() => {
      throw new Error("queue broke");
    });
    const end = await playThroughScreen(states);
    await gameOver(end);
    expect(mockEnqueueEvents).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]![1]).toMatchObject({ finalScore: end.score });
    expect(screen.getByText("Play Again")).toBeTruthy();
  }, 120_000);
});

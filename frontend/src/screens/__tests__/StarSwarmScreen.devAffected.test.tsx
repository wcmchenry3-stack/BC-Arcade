/**
 * StarSwarmScreen — the run-level dev flag (#3510), in a dev build (jest runs with `__DEV__`, so
 * DEV_TOOLS is on):
 *  - the dev panel's New Game starts a dev-affected run; a dev-panel action on the live run
 *    latches the flag (engine and Sentry tag) from the panel's handler;
 *  - the flag rides the run's completion, and the abandon a new run (or leaving) makes;
 *  - a flagged run's closed waves go out `dev: true`;
 *  - the Sentry tag is a per-session tag (`setGameSessionTag`, reset with the session in
 *    sessionTags.ts), written at run start, on a restore and on the latch — never at game over.
 * The store-build side (no panel, never flagged) is StarSwarmScreen.devAffected.store.test.tsx.
 */
import { act, fireEvent, screen } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  CANVAS_H,
  CANVAS_W,
  closeWave,
  initStarSwarm,
  toWirePayload,
} from "../../game/starswarm/engine";
import type { StarSwarmState } from "../../game/starswarm/types";
import { DEV_AFFECTED_TAG } from "../../game/starswarm/devAffected";
import { setGameSessionTag } from "../../game/_shared/sessionTags";
import { _resetPauseStoreForTests, savePausedState } from "../../game/starswarm/pauseStore";
import { canvas, resetHarness } from "./helpers/starSwarmMocks";
import { renderRun, renderScreen, startRun } from "./helpers/starSwarmHarness";

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
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../game/_shared/displayNameSync", () => mockScreenDeps().mockDisplayNameSync());
// the session-tag store itself (its reset with the session) is sessionTags.test.ts's
jest.mock("../../game/_shared/sessionTags", () => ({
  ...jest.requireActual("../../game/_shared/sessionTags"),
  setGameSessionTag: jest.fn(),
}));

let mockGameN = 0;
const mockStartGame = jest.fn(() => `starswarm-game-${++mockGameN}`);
const mockCompleteGame = jest.fn();
const mockEnqueueEvents = jest.fn();
const mockResumeGame = jest.fn((): string | null => null);
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    completeGame: lazy(() => mockCompleteGame),
    enqueueEvents: lazy(() => mockEnqueueEvents),
    resumeGame: lazy(() => mockResumeGame),
  });
});

/** The dev-flag values written to the run's Sentry session tag, oldest first. */
const devTags = () =>
  (setGameSessionTag as jest.Mock).mock.calls
    .filter(([k]) => k === DEV_AFFECTED_TAG)
    .map(([, v]) => v as string);

/** A real engine state for wave 1 (clean unless `devAffected`). */
function engine(devAffected = false, over = false): StarSwarmState {
  const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 7, "Commander");
  return { ...s, devAffected, phase: over ? "GameOver" : s.phase };
}

async function endRun(score: number, wave: number) {
  await act(async () => {
    canvas.props.onGameOver(score, wave);
  });
}

async function openPanel() {
  await act(async () => {
    await fireEvent.press(screen.getByText("DEV"));
  });
}

const completion = (i = 0) => mockCompleteGame.mock.calls[i]!;

/** The header's ⋯ New Game, Start New, then the picker's Start: abandons the run in progress. */
async function newRunFromHeader() {
  await act(async () => {
    await fireEvent.press(screen.getByTestId("nav-menu"));
  });
  await act(async () => {
    await fireEvent.press(screen.getByText("New Game"));
  });
  await act(async () => {
    await fireEvent.press(screen.getByRole("button", { name: "Start New" }));
  });
  await startRun();
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockGameN = 0;
  resetHarness();
  _resetPauseStoreForTests();
  await AsyncStorage.clear();
  await AsyncStorage.setItem("starswarm.difficulty", "Commander");
});

describe("StarSwarmScreen — dev-affected runs (#3510), dev build", () => {
  it("the dev panel's New Game starts a run the canvas opens dev-affected, and tags it", async () => {
    await renderRun();
    expect(canvas.props.devOptions?.devRun).toBeUndefined(); // the picker's run is clean
    expect(devTags()).toEqual(["false"]);
    await openPanel();
    await act(async () => {
      await fireEvent.press(screen.getByText("New Game"));
    });
    expect(canvas.props.devOptions).toMatchObject({ devRun: true });
    expect(devTags()).toEqual(["false", "true"]);
  });

  it("a dev action on the live run latches the engine's flag and the tag, once", async () => {
    await renderRun();
    await openPanel();
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Trigger shield power-up"));
    });
    expect(canvas.handle.markDevAffected).toHaveBeenCalledTimes(1);
    expect(canvas.handle.triggerPowerUp).toHaveBeenCalledWith("shield");
    expect(devTags()).toEqual(["false", "true"]);
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Throw asteroid"));
    });
    expect(canvas.handle.markDevAffected).toHaveBeenCalledTimes(2);
    expect(devTags()).toEqual(["false", "true"]); // already latched: no second write
  });

  it("turning a live switch on latches it; the frame readout does not", async () => {
    await renderRun();
    await openPanel();
    await act(async () => {
      await fireEvent(screen.getByLabelText("Frame readout"), "valueChange", true);
    });
    expect(canvas.handle.markDevAffected).not.toHaveBeenCalled();
    await act(async () => {
      await fireEvent(screen.getByLabelText("Pause straggler"), "valueChange", true);
    });
    expect(canvas.handle.markDevAffected).toHaveBeenCalledTimes(1);
    expect(devTags()).toEqual(["false", "true"]);
  });

  it("a run started with a live switch left on is dev-affected from its start", async () => {
    await renderRun();
    await openPanel();
    await act(async () => {
      await fireEvent(screen.getByLabelText("Rout off"), "valueChange", true);
    });
    await act(async () => {
      await fireEvent.press(screen.getByText("Collapse"));
    });
    (setGameSessionTag as jest.Mock).mockClear();
    await newRunFromHeader();
    expect(devTags()).toEqual(["true"]);
  });

  it("a flagged run's completion carries dev_affected: true, with no tag write", async () => {
    await renderRun();
    canvas.state = engine(true, true);
    (setGameSessionTag as jest.Mock).mockClear();
    await endRun(4200, 1);
    expect(completion()[1].result).toMatchObject({ dev_affected: true, wave_reached: 1 });
    expect(devTags()).toEqual([]);
  });

  it("a run latched by a panel action completes flagged, even if the engine missed it", async () => {
    await renderRun();
    await openPanel();
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Kill escorts"));
    });
    canvas.state = engine(false, true);
    await endRun(100, 1);
    expect(completion()[1].result).toMatchObject({ dev_affected: true });
  });

  it("a clean run's completion sends no dev field", async () => {
    await renderRun();
    canvas.state = engine(false, true);
    await endRun(4200, 1);
    expect(completion()[1].result).not.toHaveProperty("dev_affected");
  });

  it("a dev run abandoned for a new one carries the flag on its abandon", async () => {
    await renderRun();
    await openPanel();
    await act(async () => {
      await fireEvent.press(screen.getByText("New Game")); // dev New Game: run 2
    });
    canvas.state = engine(false); // the engine's own flag aside: the dev New Game set it
    mockCompleteGame.mockClear();
    await newRunFromHeader(); // abandons run 2
    const [gid, summary] = completion();
    expect(gid).toBe("starswarm-game-2");
    expect(summary).toMatchObject({ outcome: "abandoned", result: { dev_affected: true } });
  });

  it("a clean run abandoned for a new one sends no result", async () => {
    await renderRun();
    canvas.state = engine(false);
    await newRunFromHeader();
    const [, summary] = completion();
    expect(summary.outcome).toBe("abandoned");
    expect(summary).not.toHaveProperty("result");
  });

  it("a flagged run's closed waves all go out flagged dev", async () => {
    await renderRun();
    const s = engine(true, true);
    const clean = toWirePayload(closeWave(s, "cleared"));
    expect(clean.dev).toBe(false);
    canvas.state = { ...s, closedWaves: [clean] };
    await endRun(100, 1);
    const waves = mockEnqueueEvents.mock.calls
      .flatMap(([, events]) => events as { type: string; data: { dev: boolean } }[])
      .filter((ev) => ev.type === "wave_completed");
    expect(waves.map((w) => w.data.dev)).toEqual([true]);
  });

  it("a restored flagged run tags its session and abandons flagged", async () => {
    savePausedState({
      gameState: engine(true),
      difficulty: "Commander",
      counters: { nextId: 9000, seed: 5 },
    });
    await new Promise((r) => setTimeout(r, 10));
    _resetPauseStoreForTests(); // a cold start
    mockResumeGame.mockReturnValueOnce("killed-process-game");
    await renderScreen();
    expect(devTags()).toEqual(["true"]);
    canvas.state = null; // the screen's own record of the flag is enough
    await newRunFromHeader();
    const [gid, summary] = completion();
    expect(gid).toBe("killed-process-game");
    expect(summary).toMatchObject({ outcome: "abandoned", result: { dev_affected: true } });
  });

  it("a restored clean run tags its session false", async () => {
    savePausedState({
      gameState: engine(false),
      difficulty: "Commander",
      counters: { nextId: 9000, seed: 5 },
    });
    await new Promise((r) => setTimeout(r, 10));
    _resetPauseStoreForTests();
    await renderScreen();
    expect(devTags()).toEqual(["false"]);
  });
});

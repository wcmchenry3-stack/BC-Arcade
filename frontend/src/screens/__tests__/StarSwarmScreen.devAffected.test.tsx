/**
 * StarSwarmScreen — the run-level dev flag (#3510), in a dev build (jest runs with `__DEV__`, so
 * DEV_TOOLS is on): the dev panel's New Game starts a dev-affected run, the run's completion
 * carries `dev_affected: true` when the engine latched it, a clean run sends nothing extra, and
 * the app's Sentry scope is tagged either way. The store-build side (no panel, never flagged) is
 * StarSwarmScreen.devAffected.store.test.tsx. The canvas is the shared stand-in.
 */
import { act, fireEvent, screen } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import type { StarSwarmState } from "../../game/starswarm/types";
import { DEV_AFFECTED_TAG } from "../../game/starswarm/devAffected";
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

const mockCompleteGame = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => jest.fn(() => "starswarm-game-id")),
    completeGame: lazy(() => mockCompleteGame),
  });
});

const setTag = Sentry.setTag as jest.Mock;

/** The dev-flag values written to the Sentry scope, oldest first. */
const devTags = () => setTag.mock.calls.filter(([k]) => k === DEV_AFFECTED_TAG).map(([, v]) => v);

/** What the canvas's getState() returns: the fields the game over reads. */
function setEngineState(devAffected: boolean | undefined) {
  canvas.state = { difficulty: "Commander", devAffected } as unknown as StarSwarmState;
}

async function endRun(score: number, wave: number) {
  await act(async () => {
    canvas.props.onGameOver(score, wave);
  });
}

const completedResult = () => mockCompleteGame.mock.calls[0]![1].result;

beforeEach(async () => {
  jest.clearAllMocks();
  resetHarness();
  await AsyncStorage.clear();
  await AsyncStorage.setItem("starswarm.difficulty", "Commander");
});

describe("StarSwarmScreen — dev-affected runs (#3510), dev build", () => {
  it("the dev panel's New Game starts a run the canvas opens dev-affected, and tags Sentry", async () => {
    await renderRun();
    expect(canvas.props.devOptions?.devRun).toBeUndefined(); // the picker's run is clean
    expect(devTags()).toEqual(["false"]);
    await act(async () => {
      await fireEvent.press(screen.getByText("DEV"));
    });
    await act(async () => {
      await fireEvent.press(screen.getByText("New Game"));
    });
    expect(canvas.props.devOptions).toMatchObject({ devRun: true });
    expect(devTags()).toEqual(["false", "true"]);
  });

  it("a flagged run's completion carries dev_affected: true and tags Sentry", async () => {
    await renderRun();
    setEngineState(true);
    setTag.mockClear();
    await endRun(4200, 3);
    expect(completedResult()).toMatchObject({ dev_affected: true, wave_reached: 3 });
    // the game_ended event's data is left as it was: the flag rides the result only
    expect(mockCompleteGame.mock.calls[0]![2]).not.toHaveProperty("dev_affected");
    expect(devTags()).toEqual(["true"]);
  });

  it("a clean run's completion sends no dev field and leaves the tag alone", async () => {
    await renderRun();
    setEngineState(false);
    setTag.mockClear();
    await endRun(4200, 3);
    expect(completedResult()).not.toHaveProperty("dev_affected");
    expect(devTags()).toEqual([]);
  });

  it("a state without the flag (or none at all) reads as clean", async () => {
    await renderRun();
    setEngineState(undefined);
    await endRun(100, 1);
    expect(completedResult()).not.toHaveProperty("dev_affected");
  });
});

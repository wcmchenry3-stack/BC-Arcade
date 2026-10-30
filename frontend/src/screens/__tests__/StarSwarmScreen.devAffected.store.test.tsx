/**
 * StarSwarmScreen — the run-level dev flag (#3510), in a store (release) build: not `__DEV__`
 * and not built against the pre-launch API, so DEV_TOOLS is off. The DEV button and the panel
 * are never rendered, the canvas gets no dev options (so no run can open `devRun`), the Sentry
 * scope is never tagged by a run start, and a run whose engine never latched the flag completes
 * without one. DEV_TOOLS is read when the screen module loads, so the screen is required after
 * the build flags are set.
 */
import { act, render, screen, fireEvent } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import React from "react";

import type { StarSwarmState } from "../../game/starswarm/types";
import { DEV_AFFECTED_TAG } from "../../game/starswarm/devAffected";
import { canvas, resetHarness } from "./helpers/starSwarmMocks";

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

const g = globalThis as { __DEV__?: boolean };
const realDev = g.__DEV__;
const realUrl = process.env.EXPO_PUBLIC_API_URL;

/* eslint-disable @typescript-eslint/no-require-imports */
let StarSwarmScreen: React.ComponentType;
let ThemeProvider: React.ComponentType<{ children: React.ReactNode }>;

beforeAll(() => {
  // a store build: release, against the production API (envFlags.isPreLaunchApiBuild is false)
  g.__DEV__ = false;
  process.env.EXPO_PUBLIC_API_URL = "https://games-api.buffingchi.com";
  StarSwarmScreen = require("../StarSwarmScreen").default;
  ThemeProvider = require("../../theme/ThemeContext").ThemeProvider;
});
/* eslint-enable @typescript-eslint/no-require-imports */

afterAll(() => {
  g.__DEV__ = realDev;
  if (realUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = realUrl;
});

beforeEach(async () => {
  jest.clearAllMocks();
  resetHarness();
  await AsyncStorage.clear();
  await AsyncStorage.setItem("starswarm.difficulty", "Commander");
});

async function renderRun() {
  const view = await render(
    <ThemeProvider>
      <StarSwarmScreen />
    </ThemeProvider>
  );
  const outer = await view.findByTestId("starswarm-canvas-outer");
  await act(async () => {
    await fireEvent(outer, "layout", { nativeEvent: { layout: { width: 400, height: 700 } } });
  });
  await act(async () => {
    await fireEvent.press(screen.getByTestId("starswarm-start-game"));
  });
  return view;
}

const devTags = () =>
  (Sentry.setTag as jest.Mock).mock.calls.filter(([k]) => k === DEV_AFFECTED_TAG);

describe("StarSwarmScreen — dev-affected runs (#3510), store build", () => {
  it("renders no DEV button and no panel, and gives the canvas no dev options", async () => {
    await renderRun();
    expect(screen.queryByText("DEV")).toBeNull();
    expect(screen.queryByLabelText("Developer panel")).toBeNull();
    expect(screen.queryByText("New Game")).toBeNull();
    expect(canvas.props.devOptions).toBeUndefined();
    expect(devTags()).toEqual([]);
  });

  it("a run the engine never flagged completes without dev_affected", async () => {
    await renderRun();
    canvas.state = { difficulty: "Commander", devAffected: false } as unknown as StarSwarmState;
    await act(async () => {
      canvas.props.onGameOver(4200, 3);
    });
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]![1].result).not.toHaveProperty("dev_affected");
    expect(devTags()).toEqual([]);
  });
});

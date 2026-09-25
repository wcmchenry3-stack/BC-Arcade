import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AppState, AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import StarSwarmScreen from "../StarSwarmScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";

// Leaving the app mid-run pauses Star Swarm, so the player returns to the pause
// overlay. The Skia canvas is mocked (its isPaused prop is the game's paused
// state); Controls is real, so the overlay itself is asserted.

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const mockPopToTop = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    popToTop: mockPopToTop,
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCanvasProps: any = null;
jest.mock("../../components/starswarm/GameCanvas", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MockCanvas = React.forwardRef((props: any, ref: any) => {
    mockCanvasProps = props;
    React.useImperativeHandle(ref, () => ({ getState: () => null }));
    return React.createElement(View, { testID: "starswarm-canvas" });
  });
  MockCanvas.displayName = "MockCanvas";
  return { __esModule: true, default: MockCanvas };
});

jest.mock("../../hooks/useStarSwarmAudio", () => {
  const noop = () => undefined;
  return {
    DEFAULT_SFX_VOLUMES: {},
    useStarSwarmAudio: () => new Proxy({}, { get: () => noop }) as Record<string, () => void>,
  };
});

jest.mock("../../game/starswarm/telemetry", () => ({ reportRunStats: jest.fn() }));

jest.mock("../../game/starswarm/api", () => ({
  starSwarmApi: { submitScore: jest.fn(), getLeaderboard: jest.fn() },
}));
import { starSwarmApi } from "../../game/starswarm/api";

const mockStartGame = jest.fn(() => "starswarm-game-id");
const mockCompleteGame = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    startGame: (...args: unknown[]) => (mockStartGame as jest.Mock)(...args),
    enqueueEvent: jest.fn(),
    completeGame: (...args: unknown[]) => (mockCompleteGame as jest.Mock)(...args),
    init: jest.fn().mockResolvedValue(undefined),
    reportBug: jest.fn(),
    getQueueStats: jest.fn(),
    clearAll: jest.fn().mockResolvedValue(undefined),
  },
}));

// Live AppState listeners — the screen re-subscribes when its pause inputs change.
let appStateListeners: ((state: AppStateStatus) => void)[] = [];

async function setAppState(state: AppStateStatus) {
  await act(async () => {
    for (const listener of [...appStateListeners]) listener(state);
  });
}

async function renderScreen() {
  const r = await render(
    <ThemeProvider>
      <StarSwarmScreen />
    </ThemeProvider>
  );
  // Give the canvas container a size so the canvas mounts.
  await act(async () => {
    await fireEvent(r.getByTestId("starswarm-canvas-outer"), "layout", {
      nativeEvent: { layout: { width: 400, height: 700 } },
    });
  });
  return r;
}

async function startRun() {
  await act(async () => {
    await fireEvent.press(screen.getByTestId("starswarm-start-game"));
  });
}

function expectPaused() {
  expect(mockCanvasProps.isPaused).toBe(true);
  expect(screen.getByText("PAUSED")).toBeTruthy();
}

function expectRunning() {
  expect(mockCanvasProps.isPaused).toBe(false);
  expect(screen.queryByText("PAUSED")).toBeNull();
}

beforeEach(async () => {
  jest.clearAllMocks();
  appStateListeners = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    const l = listener as (state: AppStateStatus) => void;
    appStateListeners.push(l);
    return {
      remove: () => {
        appStateListeners = appStateListeners.filter((x) => x !== l);
      },
    } as ReturnType<typeof AppState.addEventListener>;
  });
  await AsyncStorage.clear();
  await AsyncStorage.setItem("starswarm.difficulty", "Commander");
  resetDisplayNameCacheForTests();
  (starSwarmApi.submitScore as jest.Mock).mockResolvedValue({ scores: [] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StarSwarmScreen — auto-pause when the app leaves the foreground", () => {
  it("pauses a live run when the app goes to the background", async () => {
    await renderScreen();
    await startRun();
    expectRunning();

    await setAppState("background");
    expectPaused();

    // Coming back leaves it paused until the player resumes.
    await setAppState("active");
    expectPaused();
    await act(async () => {
      await fireEvent.press(screen.getByText("RESUME"));
    });
    expectRunning();
  });

  it("pauses a live run when the app goes inactive", async () => {
    await renderScreen();
    await startRun();
    await setAppState("inactive");
    expectPaused();
  });

  it("pauses mid-wave too — after a wave clear", async () => {
    await renderScreen();
    await startRun();
    await act(async () => {
      mockCanvasProps.onWaveClear();
    });
    await setAppState("background");
    expectPaused();
  });

  it("leaves an already-paused run paused", async () => {
    await renderScreen();
    await startRun();
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Pause game" }));
    });
    expectPaused();
    await setAppState("inactive");
    await setAppState("background");
    expectPaused();
    expect(screen.getAllByText("PAUSED")).toHaveLength(1);
  });

  it("does not pause after game over", async () => {
    await renderScreen();
    await startRun();
    await act(async () => {
      mockCanvasProps.onGameOver(4200, 7);
    });
    await setAppState("background");
    expect(mockCanvasProps.isPaused).toBe(false);
    expect(screen.queryByText("PAUSED")).toBeNull();
    expect(screen.getByTestId("starswarm-result")).toBeTruthy();
  });

  it("does not pause while the difficulty picker is open", async () => {
    await renderScreen();
    await setAppState("background");
    expect(screen.queryByText("PAUSED")).toBeNull();
    await startRun();
    expectRunning();
  });
});

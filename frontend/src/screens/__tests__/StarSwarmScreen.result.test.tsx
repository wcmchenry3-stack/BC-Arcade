import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import StarSwarmScreen from "../StarSwarmScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";

// The shared result card for Star Swarm (#2516). The Skia canvas is mocked: the
// test drives its onGameOver callback the way the game loop does.

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

jest.mock("../../components/starswarm/Controls", () => ({
  __esModule: true,
  default: () => null,
  hapticPlayerHit: jest.fn(),
  hapticWaveClear: jest.fn(),
}));

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
const submitScore = starSwarmApi.submitScore as jest.Mock;

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

async function endRun(score: number, wave: number) {
  await act(async () => {
    mockCanvasProps.onGameOver(score, wave);
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockStartGame.mockReturnValue("starswarm-game-id");
  await AsyncStorage.clear();
  await AsyncStorage.setItem("starswarm.difficulty", "Commander");
  resetDisplayNameCacheForTests();
  submitScore.mockResolvedValue({ scores: [] });
});

describe("StarSwarmScreen — result card (#2516)", () => {
  it("shows Game Over with the score, wave and best when the run ends", async () => {
    await AsyncStorage.setItem("starswarm.bestScore", "9000");
    await renderScreen();
    await startRun();
    await endRun(4200, 7);

    const card = within(screen.getByTestId("starswarm-result"));
    expect(card.getByTestId("starswarm-result-title")).toHaveTextContent("Game Over");
    expect(card.getByText("Reached wave 7")).toBeTruthy();
    expect(card.getByText("4,200")).toBeTruthy();
    expect(card.getByText("9,000")).toBeTruthy(); // Best, from the saved best
    expect(card.queryByText("New best")).toBeNull();
    expect(card.getByRole("button", { name: "Play Again" })).toBeTruthy();
    expect(card.getByRole("button", { name: "Change Difficulty" })).toBeTruthy();
    expect(card.getByRole("button", { name: "Home" })).toBeTruthy();
  });

  it("saves a new best so it survives a restart", async () => {
    await renderScreen();
    await startRun();
    await endRun(4200, 7);
    expect(within(screen.getByTestId("starswarm-result")).getByText("New best")).toBeTruthy();
    await waitFor(async () =>
      expect(await AsyncStorage.getItem("starswarm.bestScore")).toBe("4200")
    );
  });

  it("submits the run under the display name", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    submitScore.mockResolvedValue({
      scores: [
        {
          player_id: "Riley",
          score: 4200,
          wave_reached: 7,
          difficulty_tier: "Commander",
          timestamp: "",
          rank: 4,
        },
      ],
    });
    await renderScreen();
    await startRun();
    await endRun(4200, 7);
    await waitFor(() =>
      expect(screen.getByText("Saved as Riley · #4 on the leaderboard")).toBeTruthy()
    );
    expect(submitScore).toHaveBeenCalledTimes(1);
    expect(submitScore).toHaveBeenCalledWith("Riley", 4200, 7, "Commander");
  });

  it("records the run as a completed session with no score", async () => {
    await renderScreen();
    await startRun();
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    expect(mockStartGame.mock.calls[0]![0]).toBe("starswarm");
    await endRun(4200, 7);
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [, summary] = mockCompleteGame.mock.calls[0]!;
    expect(summary.outcome).toBe("completed");
    expect(summary.result).toEqual(expect.objectContaining({ wave_reached: 7 }));
    // Star Swarm's leaderboard ranks every scored row — a session must never carry one.
    expect(summary).not.toHaveProperty("finalScore");
  });

  it("Play Again starts a new run at the same difficulty", async () => {
    await renderScreen();
    await startRun();
    await endRun(4200, 7);
    const resetBefore = mockCanvasProps.resetTick;
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Play Again" }));
    });
    expect(screen.queryByTestId("starswarm-result")).toBeNull();
    expect(mockCanvasProps.resetTick).toBe(resetBefore + 1);
    expect(mockCanvasProps.difficulty).toBe("Commander");
    expect(mockStartGame).toHaveBeenCalledTimes(2);
  });

  it("Change Difficulty opens the picker; Home leaves", async () => {
    await renderScreen();
    await startRun();
    await endRun(4200, 7);
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Change Difficulty" }));
    });
    expect(screen.queryByTestId("starswarm-result")).toBeNull();
    expect(screen.getByTestId("starswarm-start-game")).toBeTruthy();

    await startRun();
    await endRun(100, 1);
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Home" }));
    });
    expect(mockPopToTop).toHaveBeenCalled();
  });
});

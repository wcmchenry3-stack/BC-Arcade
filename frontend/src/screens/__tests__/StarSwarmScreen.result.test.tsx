import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import StarSwarmScreen from "../StarSwarmScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";
import { __setPremiumLevelsForTests } from "../../entitlements/premiumLevels";
import type { ForegroundClockMock } from "../../game/_shared/__mocks__/foregroundClock";

// useGameSync's play clock (#2684) is pinned for every test by jest.setup.ts
// (#2710); the duration tests move it forward.
const clock = jest.requireMock<ForegroundClockMock>("../../game/_shared/foregroundClock");

// The shared result card for Star Swarm (#2516). The Skia canvas is mocked: the
// test drives its onGameOver callback the way the game loop does.

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const mockPopToTop = jest.fn();
const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    popToTop: mockPopToTop,
    goBack: jest.fn(),
    navigate: mockNavigate,
    addListener: jest.fn(() => jest.fn()),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCanvasProps: any = null;
// What the canvas's getState() returns — null by default (no engine state).
let mockCanvasState: { difficulty: string } | null = null;
jest.mock("../../components/starswarm/GameCanvas", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MockCanvas = React.forwardRef((props: any, ref: any) => {
    mockCanvasProps = props;
    React.useImperativeHandle(ref, () => ({ getState: () => mockCanvasState }));
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

// #2626: the card reads the run's rank from GET /games/{id}/rank (sessionBoardAdapter);
// nothing is posted to the legacy POST /starswarm/score any more.
const mockGetRank = jest.fn();
jest.mock("../../api/stats", () => ({
  statsApi: { getGameRank: (gameId: string) => mockGetRank(gameId) },
}));
jest.mock("../../game/_shared/flushQueuedGames", () => ({
  flushQueuedGames: jest.fn(() => Promise.resolve()),
}));
jest.mock("../../game/_shared/displayNameSync", () => ({
  ...jest.requireActual("../../game/_shared/displayNameSync"),
  flushDisplayNameSync: jest.fn(() => Promise.resolve(true)),
}));

const mockStartGame = jest.fn((): string | null => "starswarm-game-id");
const mockCompleteGame = jest.fn();
const mockReportBug = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    startGame: (...args: unknown[]) => (mockStartGame as jest.Mock)(...args),
    enqueueEvent: jest.fn(),
    completeGame: (...args: unknown[]) => (mockCompleteGame as jest.Mock)(...args),
    init: jest.fn().mockResolvedValue(undefined),
    reportBug: (...args: unknown[]) => (mockReportBug as jest.Mock)(...args),
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
  mockCanvasState = null;
  await AsyncStorage.clear();
  await AsyncStorage.setItem("starswarm.difficulty", "Commander");
  resetDisplayNameCacheForTests();
  mockGetRank.mockResolvedValue(ranked(1));
});

function ranked(rank: number) {
  return { rank, is_best: true, ranked: true, reason: null };
}

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

  // #2626: the named session row is the leaderboard entry; the card only reads its rank.
  it("shows the run's rank on its tier's board under the display name", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    mockGetRank.mockResolvedValue(ranked(4));
    await renderScreen();
    await startRun();
    await endRun(4200, 7);
    await waitFor(() =>
      expect(screen.getByText("Saved as Riley · #4 on the leaderboard")).toBeTruthy()
    );
    // The completed session's id, read before complete() clears it.
    expect(mockGetRank).toHaveBeenCalledTimes(1);
    expect(mockGetRank).toHaveBeenCalledWith("starswarm-game-id");
  });

  it("asks for a display name when the player has none, without reading the rank", async () => {
    await renderScreen();
    await startRun();
    await endRun(4200, 7);
    const card = within(screen.getByTestId("starswarm-result"));
    await waitFor(() => expect(card.getByTestId("result-name-prompt")).toBeTruthy());
    expect(mockGetRank).not.toHaveBeenCalled();
  });

  it("shows no leaderboard line for a run that can never rank", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    mockGetRank.mockResolvedValue({
      rank: null,
      is_best: null,
      ranked: false,
      reason: "not_rankable",
    });
    await renderScreen();
    await startRun();
    await endRun(4200, 7);
    await waitFor(() => expect(mockGetRank).toHaveBeenCalledTimes(1));
    const card = within(screen.getByTestId("starswarm-result"));
    await waitFor(() => expect(card.queryByText(/Saving|Saved as/)).toBeNull());
    expect(card.queryByTestId("result-name-prompt")).toBeNull();
  });

  it("records the run as a completed session carrying its score, wave and tier", async () => {
    await renderScreen();
    await startRun();
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    expect(mockStartGame.mock.calls[0]![0]).toBe("starswarm");
    clock.advanceForegroundNow(45_000);
    await endRun(4200, 7);
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [gameId, summary] = mockCompleteGame.mock.calls[0]!;
    expect(gameId).toBe("starswarm-game-id");
    expect(summary.outcome).toBe("completed");
    expect(summary.finalScore).toBe(4200);
    expect(summary.result).toEqual({
      outcome: "completed",
      wave_reached: 7,
      difficulty_tier: "Commander",
    });
    // The engine keeps no play clock: useGameSync's active-play window (#2684)
    // supplies the run's foreground time.
    expect(summary.durationMs).toBe(45_000);
  });

  it("reports a game over with no open session, and asks for no rank", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    mockStartGame.mockReturnValue(null);
    await renderScreen();
    await startRun();
    await endRun(4200, 7);
    expect(screen.getByTestId("starswarm-result")).toBeTruthy();
    expect(mockCompleteGame).not.toHaveBeenCalled();
    expect(mockGetRank).not.toHaveBeenCalled();
    expect(mockReportBug).toHaveBeenCalledTimes(1);
    const [level, source, message, context] = mockReportBug.mock.calls[0]!;
    expect(level).toBe("warn");
    expect(source).toBe("starswarm");
    expect(message).toMatch(/no open session/);
    // Score and tier only — no name or other PII.
    expect(context).toEqual({ score: 4200, wave: 7, difficulty_tier: "Commander" });
  });

  it("does not report a normal game over", async () => {
    await renderScreen();
    await startRun();
    await endRun(4200, 7);
    expect(mockReportBug).not.toHaveBeenCalled();
  });

  // #2567: a dev-panel New Game can play a tier the picker doesn't show; the card
  // names the tier the run was played at, the board its rank comes from.
  it("shows the tier the run was played at, not the picker's", async () => {
    await renderScreen();
    await startRun();
    mockCanvasState = { difficulty: "Captain" };
    await endRun(4200, 7);
    const card = within(screen.getByTestId("starswarm-result"));
    expect(card.getByText("Star Swarm · Captain")).toBeTruthy();
    expect(card.queryByText("Star Swarm · Commander")).toBeNull();
    const [, summary] = mockCompleteGame.mock.calls[0]!;
    expect(summary.result.difficulty_tier).toBe("Captain");
  });

  it("View leaderboard opens the board of the tier the run was played at (#2633)", async () => {
    await renderScreen();
    await startRun();
    mockCanvasState = { difficulty: "Captain" };
    await endRun(4200, 7);
    const card = within(screen.getByTestId("starswarm-result"));
    await act(async () => {
      await fireEvent.press(card.getByRole("link", { name: "View leaderboard" }));
    });
    expect(mockNavigate).toHaveBeenCalledWith("Leaderboard", {
      gameType: "starswarm",
      partition: { difficulty_tier: "Captain" },
    });
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

  // #2710 — the difficulty picker shown from mount is not play.
  it("leaves the picker's time before the first run out of it", async () => {
    await renderScreen();
    clock.advanceForegroundNow(2 * 60_000); // on the difficulty picker
    await startRun();
    clock.advanceForegroundNow(25_000);
    await endRun(4200, 7);
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]![1].durationMs).toBe(25_000);
  });

  // #2710 — a finished run pauses the play window: the result card and the
  // picker are not counted into the next run.
  it("Play Again leaves the time on the result card out of the next run", async () => {
    await renderScreen();
    await startRun();
    clock.advanceForegroundNow(30_000);
    await endRun(4200, 7);
    clock.advanceForegroundNow(2 * 60_000); // on the result card
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Play Again" }));
    });
    clock.advanceForegroundNow(20_000);
    await endRun(900, 2);
    expect(mockCompleteGame).toHaveBeenCalledTimes(2);
    expect(mockCompleteGame.mock.calls[0]![1].durationMs).toBe(30_000);
    expect(mockCompleteGame.mock.calls[1]![1].durationMs).toBe(20_000);
  });

  it("Change Difficulty leaves the card and picker time out of the next run", async () => {
    await renderScreen();
    await startRun();
    clock.advanceForegroundNow(30_000);
    await endRun(4200, 7);
    clock.advanceForegroundNow(60_000); // on the result card
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Change Difficulty" }));
    });
    clock.advanceForegroundNow(90_000); // on the picker
    await startRun();
    clock.advanceForegroundNow(15_000);
    await endRun(900, 2);
    expect(mockCompleteGame).toHaveBeenCalledTimes(2);
    expect(mockCompleteGame.mock.calls[1]![1].durationMs).toBe(15_000);
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

describe("StarSwarmScreen — difficulty picker (#1129)", () => {
  afterEach(() => {
    __setPremiumLevelsForTests(null);
  });

  const checked = (tier: string) =>
    screen.getByTestId(`starswarm-tier-${tier}`).props.accessibilityState.checked;

  it("opens on the last tier played and remembers the next one", async () => {
    await renderScreen();
    await waitFor(() => expect(checked("Commander")).toBe(true));

    await act(async () => {
      await fireEvent.press(screen.getByTestId("starswarm-tier-Captain"));
    });
    await startRun();
    expect(await AsyncStorage.getItem("starswarm.difficulty")).toBe("Captain");
  });

  it("explains a premium tier on tap and keeps the tier picked", async () => {
    __setPremiumLevelsForTests({ starswarm: ["FleetAdmiral"] });
    await renderScreen();
    await waitFor(() => expect(checked("Commander")).toBe(true));
    expect(screen.getByText("🔒 Fleet Admiral")).toBeTruthy();

    await act(async () => {
      await fireEvent.press(screen.getByTestId("starswarm-tier-FleetAdmiral"));
    });
    expect(screen.getByText("This level is part of BC Arcade Premium, coming soon.")).toBeTruthy();

    await act(async () => {
      await fireEvent.press(screen.getByTestId("starswarm-premium-ok"));
    });
    expect(screen.queryByText("This level is part of BC Arcade Premium, coming soon.")).toBeNull();
    expect(checked("FleetAdmiral")).toBe(false);
    expect(checked("Commander")).toBe(true);
  });
});

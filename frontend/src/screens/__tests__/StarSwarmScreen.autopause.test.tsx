import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AppState, AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import StarSwarmScreen from "../StarSwarmScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";
import {
  PAUSED_RUN_STORAGE_KEY,
  _resetPauseStoreForTests,
  clearSavedPausedState,
  getSavedPausedState,
  savePausedState,
} from "../../game/starswarm/pauseStore";
import { CANVAS_H, CANVAS_W, initStarSwarm } from "../../game/starswarm/engine";
import type { StarSwarmState } from "../../game/starswarm/types";

// Leaving the app mid-run pauses Star Swarm, so the player returns to the pause
// overlay. The Skia canvas is mocked (its isPaused prop is the game's paused
// state, and getState() returns an engine state); Controls is real, so the
// overlay itself is asserted.

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const mockPopToTop = jest.fn();
// Live navigation listeners, so a test can blur the screen (#2633).
const mockNavListeners = new Map<string, Set<() => void>>();
const mockNavigation = {
  popToTop: mockPopToTop,
  goBack: jest.fn(),
  navigate: jest.fn(),
  addListener: jest.fn((event: string, cb: () => void) => {
    const set = mockNavListeners.get(event) ?? new Set();
    set.add(cb);
    mockNavListeners.set(event, set);
    return () => set.delete(cb);
  }),
};
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => mockNavigation,
}));

async function emitNav(event: "blur" | "focus") {
  await act(async () => {
    for (const cb of [...(mockNavListeners.get(event) ?? [])]) cb();
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCanvasProps: any = null;
// What the engine holds — the canvas stores game over before React hears of it.
let mockEnginePhase = "SwoopIn";
let mockEngineState: StarSwarmState | null = null;
let mockStateCache: { src: unknown; phase: string; state: unknown } | null = null;
function mockCurrentState() {
  if (mockStateCache?.src !== mockEngineState || mockStateCache?.phase !== mockEnginePhase) {
    mockStateCache = {
      src: mockEngineState,
      phase: mockEnginePhase,
      state: { ...mockEngineState, phase: mockEnginePhase },
    };
  }
  return mockStateCache.state;
}
jest.mock("../../components/starswarm/GameCanvas", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MockCanvas = React.forwardRef((props: any, ref: any) => {
    mockCanvasProps = props;
    // Like the real canvas, the same state object until the engine changes it.
    React.useImperativeHandle(ref, () => ({ getState: mockCurrentState }));
    return React.createElement(View, { testID: "starswarm-canvas" });
  });
  MockCanvas.displayName = "MockCanvas";
  return { __esModule: true, default: MockCanvas };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockAudioArgs: any[] = [];
jest.mock("../../hooks/useStarSwarmAudio", () => {
  const noop = () => undefined;
  return {
    DEFAULT_SFX_VOLUMES: {},
    useStarSwarmAudio: (...args: unknown[]) => {
      mockAudioArgs = args;
      return new Proxy({}, { get: () => noop }) as Record<string, () => void>;
    },
  };
});

jest.mock("../../game/starswarm/telemetry", () => ({ reportRunStats: jest.fn() }));

// The result card's rank lookup (#2626) — hermetic, and never left retrying.
jest.mock("../../api/stats", () => ({
  statsApi: {
    getGameRank: jest.fn(() =>
      Promise.resolve({ rank: null, is_best: null, ranked: false, reason: "not_rankable" })
    ),
  },
}));
jest.mock("../../game/_shared/flushQueuedGames", () => ({
  flushQueuedGames: jest.fn(() => Promise.resolve()),
}));
jest.mock("../../game/_shared/displayNameSync", () => ({
  ...jest.requireActual("../../game/_shared/displayNameSync"),
  flushDisplayNameSync: jest.fn(() => Promise.resolve(true)),
}));

const mockStartGame = jest.fn(() => "starswarm-game-id");
const mockCompleteGame = jest.fn();
// The killed process's session a restore can continue (#2654); none by default.
const mockResumeGame = jest.fn((): string | null => null);
jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    startGame: (...args: unknown[]) => (mockStartGame as jest.Mock)(...args),
    resumeGame: (...args: unknown[]) => (mockResumeGame as jest.Mock)(...args),
    markStarted: jest.fn(),
    discardGame: jest.fn(),
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
  // Give the canvas container a size so the canvas mounts. The game mounts once any
  // run a previous process saved has loaded (#2645).
  const outer = await r.findByTestId("starswarm-canvas-outer");
  await act(async () => {
    await fireEvent(outer, "layout", {
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

const musicPaused = () => mockAudioArgs[3] as boolean;

function expectPaused() {
  expect(mockCanvasProps.isPaused).toBe(true);
  expect(screen.getByText("PAUSED")).toBeTruthy();
  expect(musicPaused()).toBe(true);
}

function expectRunning() {
  expect(mockCanvasProps.isPaused).toBe(false);
  expect(screen.queryByText("PAUSED")).toBeNull();
  expect(musicPaused()).toBe(false);
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockCanvasProps = null;
  mockAudioArgs = [];
  mockEnginePhase = "SwoopIn";
  mockEngineState = { ...initStarSwarm(CANVAS_W, CANVAS_H, 3, 7, "Commander"), score: 2500 };
  clearSavedPausedState();
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
});

afterEach(() => {
  jest.restoreAllMocks();
  clearSavedPausedState();
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

  it("pauses and saves a live run when another screen covers it (#2633)", async () => {
    await renderScreen();
    await startRun();
    expectRunning();

    // e.g. ⋯ → Leaderboard: the game screen stays mounted under the board.
    await emitNav("blur");
    expectPaused();
    expect(getSavedPausedState()).not.toBeNull();

    // Coming back leaves it paused until the player resumes.
    await emitNav("focus");
    expectPaused();
  });

  it("does not pause a finished run when the screen is covered", async () => {
    await renderScreen();
    await startRun();
    await act(async () => {
      mockCanvasProps.onGameOver(4200, 7);
    });
    await emitNav("blur");
    expect(mockCanvasProps.isPaused).toBe(false);
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

  it("does not pause a run the engine has ended before React has rendered the game over", async () => {
    await renderScreen();
    await startRun();
    // The loop stored the GameOver state; the app goes inactive before onGameOver lands.
    mockEnginePhase = "GameOver";
    await setAppState("inactive");
    expectRunning();
    // The game over then lands on an unpaused run: the result card, never a paused one.
    await act(async () => {
      mockCanvasProps.onGameOver(4200, 7);
    });
    expect(mockCanvasProps.isPaused).toBe(false);
  });

  it("pauses a run restored from a saved pause again after it's resumed", async () => {
    savePausedState({
      gameState: { phase: "Playing" } as unknown as StarSwarmState,
      difficulty: "Commander",
    });
    await renderScreen();
    // Restored paused, straight onto the overlay — no difficulty picker.
    expect(screen.queryByTestId("starswarm-start-game")).toBeNull();
    expectPaused();
    await setAppState("background");
    expectPaused();

    await act(async () => {
      await fireEvent.press(screen.getByText("RESUME"));
    });
    expectRunning();
    await setAppState("background");
    expectPaused();
  });

  it("New Game from the pause overlay: backgrounding at the picker changes nothing", async () => {
    await renderScreen();
    await startRun();
    await setAppState("background");
    expectPaused();
    await act(async () => {
      await fireEvent.press(screen.getByText("NEW GAME"));
    });
    expect(screen.getByTestId("starswarm-start-game")).toBeTruthy();
    // The picker covers the run: no pause overlay under it.
    expect(screen.queryByText("PAUSED")).toBeNull();
    await setAppState("inactive");
    expect(screen.queryByText("PAUSED")).toBeNull();

    await startRun();
    expectRunning();
    await setAppState("background");
    expectPaused();
  });

  it("does not pause while the difficulty picker is open", async () => {
    await renderScreen();
    await setAppState("background");
    expect(screen.queryByText("PAUSED")).toBeNull();
    await startRun();
    expectRunning();
  });
});

describe("StarSwarmScreen — a paused run survives the process (#2645)", () => {
  const flush = () => act(async () => new Promise((r) => setImmediate(r)));
  async function persisted() {
    const raw = await AsyncStorage.getItem(PAUSED_RUN_STORAGE_KEY);
    return raw == null ? null : JSON.parse(raw);
  }

  it("backgrounding saves the run and the engine's counters, and no session", async () => {
    await renderScreen();
    await startRun();
    await setAppState("background");
    await flush();

    const saved = await persisted();
    expect(saved).not.toBeNull();
    expect(saved.gameState.score).toBe(2500);
    expect(saved.difficulty).toBe("Commander");
    expect(saved).not.toHaveProperty("gameId");
    expect(saved.counters).toEqual({ nextId: expect.any(Number), seed: expect.any(Number) });
  });

  it("resuming clears the save — the run is live again", async () => {
    await renderScreen();
    await startRun();
    await setAppState("inactive");
    await flush();
    expect(await persisted()).not.toBeNull();

    await act(async () => {
      await fireEvent.press(screen.getByText("RESUME"));
    });
    await flush();
    expect(await persisted()).toBeNull();
  });

  it("game over clears the save", async () => {
    await renderScreen();
    await startRun();
    await setAppState("background");
    await act(async () => {
      await fireEvent.press(screen.getByText("RESUME"));
    });
    // Saved again, then the run ends before the player comes back to it.
    await setAppState("background");
    await flush();
    expect(await persisted()).not.toBeNull();
    await act(async () => {
      mockCanvasProps.onGameOver(4200, 7);
    });
    await flush();
    expect(await persisted()).toBeNull();
  });

  async function saveAndKill() {
    const run = mockEngineState!;
    savePausedState({
      gameState: run,
      difficulty: "Commander",
      counters: { nextId: 9000, seed: 5 },
    });
    await flush();
    _resetPauseStoreForTests(); // the OS killed the app
    return run;
  }

  it("after a cold start, reopens straight onto the paused run and continues its session", async () => {
    mockResumeGame.mockReturnValueOnce("dead-process-game");
    const run = await saveAndKill();

    await renderScreen();
    expect(screen.queryByTestId("starswarm-start-game")).toBeNull();
    expectPaused();
    expect(mockCanvasProps.initialState).toEqual(JSON.parse(JSON.stringify(run)));
    expect(mockCanvasProps.difficulty).toBe("Commander");

    // One run, one session (#2654): the killed process's session goes on — nothing is
    // abandoned and no second session is opened.
    expect(mockResumeGame).toHaveBeenCalledWith("starswarm", undefined);
    expect(mockStartGame).not.toHaveBeenCalled();
    expect(mockCompleteGame).not.toHaveBeenCalled();

    await act(async () => {
      await fireEvent.press(screen.getByText("RESUME"));
    });
    expectRunning();

    // Its game over completes that same session.
    await act(async () => {
      mockCanvasProps.onGameOver(4200, 7);
    });
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "dead-process-game",
      expect.objectContaining({ outcome: "completed" }),
      expect.anything()
    );
  });

  it("after a cold start with no session left to continue, the restored run gets a new one", async () => {
    await saveAndKill();
    await renderScreen();
    expectPaused();
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("backing out of a paused run keeps it saved", async () => {
    await renderScreen();
    await startRun();
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Pause game" }));
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId("nav-back"));
    });
    await flush();
    const saved = await persisted();
    expect(saved.gameState.score).toBe(2500);
    expect(mockPopToTop).toHaveBeenCalled();
  });

  it("inactive then background writes the run once — a paused engine's state doesn't change", async () => {
    await renderScreen();
    await startRun();
    const setItem = AsyncStorage.setItem as jest.Mock;
    const writes = () => setItem.mock.calls.filter(([k]) => k === PAUSED_RUN_STORAGE_KEY).length;
    const before = writes();
    await setAppState("inactive");
    await setAppState("background");
    expect(writes() - before).toBe(1);
  });

  it("leaving the screen any way keeps the saved run and abandons its session", async () => {
    const r = await renderScreen();
    await startRun();
    await setAppState("background");
    await flush();

    // e.g. the iOS swipe-back, which never calls onBack
    await act(async () => {
      r.unmount();
    });
    await flush();
    expect((await persisted()).gameState.score).toBe(2500);
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "starswarm-game-id",
      expect.objectContaining({ outcome: "abandoned" }),
      expect.anything()
    );
  });

  it("while a previous process's save loads, the header and back button are up", async () => {
    _resetPauseStoreForTests();
    const getItem = AsyncStorage.getItem as jest.Mock;
    getItem.mockImplementationOnce(() => new Promise(() => undefined)); // storage stalls
    await render(
      <ThemeProvider>
        <StarSwarmScreen />
      </ThemeProvider>
    );
    expect(screen.queryByTestId("starswarm-canvas-outer")).toBeNull();
    await act(async () => {
      await fireEvent.press(screen.getByTestId("nav-back"));
    });
    expect(mockPopToTop).toHaveBeenCalled();
  });

  it("a cold start with nothing saved opens the difficulty picker as usual", async () => {
    _resetPauseStoreForTests();
    await renderScreen();
    expect(screen.getByTestId("starswarm-start-game")).toBeTruthy();
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });
});

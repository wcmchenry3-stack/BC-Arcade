/**
 * StarSwarmScreen developer panel (#2957): the DEV overlay of dev and internal
 * pre-launch builds (#2567) that sets up a run (wave, lives, difficulty,
 * switches), pokes the live engine (power-ups, asteroid, escorts), reads its
 * run counters, and mixes the sound. The canvas and the audio hook are
 * stand-ins (helpers/starSwarmHarness).
 */

import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import StarSwarmScreen from "../StarSwarmScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import {
  CANVAS_H,
  CANVAS_W,
  difficultyLabel,
  dodgeRateByTier,
  initStarSwarm,
} from "../../game/starswarm/engine";
import type { PowerUpType } from "../../game/starswarm/types";
import { audioCalls, canvas, resetHarness } from "./helpers/starSwarmHarness";

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
  require("./helpers/starSwarmHarness").canvasModule()
);
jest.mock("../../hooks/useStarSwarmAudio", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("./helpers/starSwarmHarness").audioModule()
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
jest.mock("../../game/_shared/gameEventClient", () => mockScreenDeps().mockGameEventClient());

/** The panel's switches, top to bottom. */
const SWITCHES = [
  "Infinite lives",
  "Straggler AI",
  "Pause straggler",
  "Player missiles off",
  "Enemy missiles off",
  "Asteroids off",
  "Dodge off",
  "Flak off",
  "Rout off",
  "Frame readout",
] as const;
type SwitchLabel = (typeof SWITCHES)[number];

async function renderRun() {
  const view = await render(
    <ThemeProvider>
      <StarSwarmScreen />
    </ThemeProvider>
  );
  await act(async () => {
    await fireEvent(screen.getByTestId("starswarm-canvas-outer"), "layout", {
      nativeEvent: { layout: { width: 400, height: 700 } },
    });
  });
  await act(async () => {
    await fireEvent.press(screen.getByTestId("starswarm-start-game"));
  });
  return view;
}

const press = (label: string) =>
  act(async () => {
    await fireEvent.press(screen.getByLabelText(label));
  });

async function openPanel() {
  await act(async () => {
    await fireEvent.press(screen.getByText("DEV"));
  });
}

async function flip(label: SwitchLabel, value: boolean) {
  const target = screen.getAllByRole("switch")[SWITCHES.indexOf(label)]!;
  await act(async () => {
    await fireEvent(target, "valueChange", value);
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetHarness();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("opening and closing", () => {
  it("opens from the DEV button and collapses from its own button", async () => {
    await renderRun();
    expect(screen.queryByLabelText("Developer panel")).toBeNull();
    await openPanel();
    expect(screen.getByLabelText("Developer panel")).toBeTruthy();
    expect(screen.getAllByRole("switch")).toHaveLength(SWITCHES.length);
    await act(async () => {
      await fireEvent.press(screen.getByText("Collapse"));
    });
    expect(screen.queryByLabelText("Developer panel")).toBeNull();
  });
});

describe("new game from the panel", () => {
  it("starts a run with the chosen wave, lives, straggler and difficulty", async () => {
    await renderRun();
    const tickBefore = canvas.props.resetTick as number;
    await openPanel();

    await press("Increase wave");
    await press("Increase wave");
    await press("Increase wave");
    await flip("Infinite lives", true);
    await flip("Straggler AI", false);
    await press(`Dev difficulty ${difficultyLabel("Commander")}`);
    await act(async () => {
      await fireEvent.press(screen.getByText("New Game"));
    });

    expect(screen.queryByLabelText("Developer panel")).toBeNull();
    expect(canvas.props.resetTick).toBe(tickBefore + 1);
    expect(canvas.props.devOptions).toMatchObject({
      wave: 4,
      infiniteLives: true,
      stragglerEnabled: false,
      pauseStraggler: false,
      difficulty: "Commander",
    });
  });

  it("keeps the wave between 1 and 15", async () => {
    await renderRun();
    await openPanel();
    await press("Decrease wave");
    expect(screen.getByText("1")).toBeTruthy();
    for (let i = 0; i < 20; i++) await press("Increase wave");
    expect(screen.getByText("15")).toBeTruthy();
  });

  it("a clean run from the result card drops the panel's options", async () => {
    await renderRun();
    await openPanel();
    await press("Increase wave");
    await act(async () => {
      await fireEvent.press(screen.getByText("New Game"));
    });
    expect(canvas.props.devOptions.wave).toBe(2);

    await act(async () => {
      canvas.props.onGameOver(500, 2);
    });
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Play Again" }));
    });
    expect(canvas.props.devOptions.wave).toBeUndefined();
  });
});

describe("switches that apply to the live run", () => {
  it.each<[SwitchLabel, string]>([
    ["Pause straggler", "pauseStraggler"],
    ["Player missiles off", "playerFireDisabled"],
    ["Enemy missiles off", "enemyFireDisabled"],
    ["Asteroids off", "asteroidsDisabled"],
    ["Dodge off", "dodgeDisabled"],
    ["Flak off", "flakDisabled"],
    ["Rout off", "routDisabled"],
  ])("%s reaches the canvas at once", async (label, option) => {
    await renderRun();
    await openPanel();
    expect(canvas.props.devOptions[option]).toBe(false);
    await flip(label, true);
    expect(canvas.props.devOptions[option]).toBe(true);
    await flip(label, false);
    expect(canvas.props.devOptions[option]).toBe(false);
  });

  it("the frame readout shows over the game when switched on", async () => {
    await renderRun();
    await openPanel();
    expect(screen.queryByTestId("starswarm-frame-stats")).toBeNull();
    await flip("Frame readout", true);
    expect(screen.getByTestId("starswarm-frame-stats")).toBeTruthy();
    await flip("Frame readout", false);
    expect(screen.queryByTestId("starswarm-frame-stats")).toBeNull();
  });
});

describe("poking the live engine", () => {
  it.each<PowerUpType>(["lightning", "shield", "buddy", "bomb", "salvage", "hull"])(
    "triggers the %s power-up",
    async (type) => {
      await renderRun();
      await openPanel();
      await press(`Trigger ${type} power-up`);
      expect(canvas.handle.triggerPowerUp).toHaveBeenCalledWith(type);
    }
  );

  it("throws an asteroid and kills the escorts", async () => {
    await renderRun();
    await openPanel();
    await press("Throw asteroid");
    await press("Kill escorts");
    expect(canvas.handle.throwAsteroid).toHaveBeenCalledTimes(1);
    expect(canvas.handle.killEscorts).toHaveBeenCalledTimes(1);
  });
});

describe("run counters", () => {
  it("asks for a game before there is anything to show", async () => {
    await renderRun();
    await openPanel();
    expect(screen.getByText("Start a game to see counters")).toBeTruthy();
  });

  it("shows the run, its dodge table and counters, and refreshes four times a second", async () => {
    jest.useFakeTimers();
    const state = initStarSwarm(CANVAS_W, CANVAS_H, 4, 42, "Commander");
    const tier = dodgeRateByTier(state)[0]!.tier;
    canvas.state = {
      ...state,
      tierStats: { ...state.tierStats, [tier]: { rolls: 10, dodged: 4, struck: 1, flak: 2 } },
      runStats: { ...state.runStats, reinforced: 777 },
    };
    await renderRun();
    await openPanel();

    const stats = within(screen.getByLabelText("Run stats"));
    expect(stats.getByText("wave 4 · Commander · score 0")).toBeTruthy();
    // One dodge-table line per tier, the busy one with its measured rate.
    expect(stats.getAllByText(/^\w+ \d+% \d+% \d+ \d+ \S+ \d+ \d+$/)).toHaveLength(
      dodgeRateByTier(state).length
    );
    expect(stats.getByText(new RegExp(`^${tier} \\d+% \\d+% 10 4 40% 1 2$`))).toBeTruthy();
    expect(stats.getByText("Reinforcements launched")).toBeTruthy();
    expect(stats.getByText("777")).toBeTruthy();

    canvas.state = { ...canvas.state, score: 900 };
    expect(screen.queryByText("wave 4 · Commander · score 900")).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(screen.getByText("wave 4 · Commander · score 900")).toBeTruthy();
  });

  it("stops reading the engine once the panel is collapsed", async () => {
    jest.useFakeTimers();
    canvas.state = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42);
    await renderRun();
    await openPanel();
    await act(async () => {
      await fireEvent.press(screen.getByText("Collapse"));
    });
    canvas.handle.getState!.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(canvas.handle.getState).not.toHaveBeenCalled();
  });
});

describe("sound mixer", () => {
  const latestVolumes = () => audioCalls.at(-1)![1] as Record<string, number>;

  it("steps a sound's volume by a tenth, and keeps it between 0 and 1", async () => {
    await renderRun();
    await openPanel();
    expect(latestVolumes().laser).toBe(0.6);

    await press("Decrease Laser volume");
    expect(latestVolumes().laser).toBe(0.5);
    await press("Increase Laser volume");
    await press("Increase Laser volume");
    expect(latestVolumes().laser).toBe(0.7);

    for (let i = 0; i < 10; i++) await press("Increase Laser volume");
    expect(latestVolumes().laser).toBe(1);
    for (let i = 0; i < 12; i++) await press("Decrease Laser volume");
    expect(latestVolumes().laser).toBe(0);
  });

  it("leaves the other sounds alone", async () => {
    await renderRun();
    await openPanel();
    const before = { ...latestVolumes() };
    await press("Decrease Player hit volume");
    expect(latestVolumes()).toEqual({ ...before, playerhit: 0.6 });
  });
});

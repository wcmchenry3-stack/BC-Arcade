/**
 * StarSwarmScreen game events (#2957): what the screen does with each callback
 * the canvas raises (sound, haptic, and the spoken cue for events that have no
 * on-screen text), and the E2E test-hook seam. The canvas and the audio hook
 * are stand-ins (helpers/starSwarmMocks); a test calls the canvas's props
 * the way the game loop does.
 */

import { AccessibilityInfo } from "react-native";
import { act, screen } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { hapticPlayerHit, hapticWaveClear } from "../../components/starswarm/Controls";
import { CANVAS_H, CANVAS_W, initStarSwarm } from "../../game/starswarm/engine";
import type { CarrierEvent, UpgradeEvent } from "../../game/starswarm/types";
import { audio, canvas, resetHarness } from "./helpers/starSwarmMocks";
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
jest.mock("../../game/_shared/gameEventClient", () => mockScreenDeps().mockGameEventClient());

/** Calls one of the canvas's callbacks, as the game loop does. */
async function raise(callback: string, ...args: unknown[]) {
  await act(async () => {
    canvas.props[callback](...args);
  });
}

let announce: jest.SpyInstance;

beforeEach(async () => {
  jest.clearAllMocks();
  resetHarness();
  await AsyncStorage.clear();
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("sounds and haptics", () => {
  it("hands the canvas the sound for its own events", async () => {
    await renderRun();
    await raise("onLaserFire");
    await raise("onPowerUpCollect", "shield");
    await raise("onExplosion");
    expect(audio.playLaser).toHaveBeenCalledTimes(1);
    expect(audio.playPowerUpCollect).toHaveBeenCalledWith("shield");
    expect(audio.playExplosion).toHaveBeenCalledTimes(1);
  });

  it("a hit on the player sounds and vibrates", async () => {
    await renderRun();
    await raise("onPlayerHit");
    expect(audio.playPlayerHit).toHaveBeenCalledTimes(1);
    expect(hapticPlayerHit).toHaveBeenCalledTimes(1);
  });

  it("a cleared wave sounds and vibrates", async () => {
    await renderRun();
    await raise("onWaveClear");
    expect(audio.playWaveClear).toHaveBeenCalledTimes(1);
    expect(hapticWaveClear).toHaveBeenCalledTimes(1);
  });

  it("a bonus life sounds", async () => {
    await renderRun();
    await raise("onBonusLife");
    expect(audio.playBonusLife).toHaveBeenCalledTimes(1);
  });
});

describe("spoken cues", () => {
  it("a boss wave sounds and is announced", async () => {
    await renderRun();
    await raise("onBossWave");
    expect(audio.playBossWave).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Boss wave. The Carrier and its Guardians only.");
  });

  it("a rout sounds and announces how many grunts are fleeing", async () => {
    await renderRun();
    await raise("onRout", 4);
    expect(audio.playRout).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Grunts fleeing: 4. Catch them before they escape.");
  });

  it("the Buddy ship going down is announced", async () => {
    await renderRun();
    await raise("onBuddyLost");
    expect(announce).toHaveBeenCalledWith("Buddy ship destroyed.");
  });

  it("the Carrier's armor dropping is announced", async () => {
    await renderRun();
    await raise("onCarrierExposed");
    expect(announce).toHaveBeenCalledWith("Carrier armor down. It can be damaged now.");
  });

  it.each<[CarrierEvent, string]>([
    ["beamCharge", "Carrier beam incoming. Move aside."],
    ["reinforce", "Carrier launching reinforcements."],
    ["attackRun", "Carrier attack run incoming."],
    ["finalStand", "Carrier final stand. Its attacks come faster."],
  ])("the Carrier's %s sounds and is announced", async (kind, spoken) => {
    await renderRun();
    await raise("onCarrierEvent", kind);
    expect(audio.playCarrierEvent).toHaveBeenCalledWith(kind);
    expect(announce).toHaveBeenCalledWith(spoken);
  });

  it("the Carrier's beam firing sounds without a second announcement", async () => {
    await renderRun();
    await raise("onCarrierEvent", "beamFire");
    expect(audio.playCarrierEvent).toHaveBeenCalledWith("beamFire");
    expect(announce).not.toHaveBeenCalled();
  });

  it.each<[UpgradeEvent, string]>([
    [{ kind: "gunsUp", guns: 2, hull: 0 }, "Guns level 2."],
    [{ kind: "gunsDown", guns: 1, hull: 0 }, "Guns down to level 1."],
    [{ kind: "hullUp", guns: 1, hull: 1 }, "Hull plating 1."],
    [{ kind: "hullHit", guns: 1, hull: 0 }, "Hull plating absorbed the hit."],
  ])("the %j upgrade sounds and is announced", async (event, spoken) => {
    await renderRun();
    await raise("onUpgrade", event);
    expect(audio.playUpgrade).toHaveBeenCalledWith(event);
    expect(announce).toHaveBeenCalledWith(spoken);
  });
});

describe("E2E test hooks", () => {
  const hooks = globalThis as typeof globalThis & {
    __starswarm_getRunStats?: () => Record<string, unknown> | null;
    __starswarm_endRun?: (score: number, wave: number) => void;
  };
  const original = process.env.EXPO_PUBLIC_TEST_HOOKS;

  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    else process.env.EXPO_PUBLIC_TEST_HOOKS = original;
  });

  it("installs nothing in a normal build", async () => {
    delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    await renderRun();
    expect(hooks.__starswarm_endRun).toBeUndefined();
    expect(hooks.__starswarm_getRunStats).toBeUndefined();
  });

  it("in a test build, ends the run through the real game-over path", async () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    await renderRun();
    await act(async () => {
      hooks.__starswarm_endRun!(3300, 6);
    });
    expect(screen.getByTestId("starswarm-result-title")).toHaveTextContent("Game Over");
    expect(screen.getByText("Reached wave 6")).toBeTruthy();
    expect(screen.getAllByText("3,300").length).toBeGreaterThan(0);
    expect(audio.playGameOver).toHaveBeenCalledTimes(1);
    // The canvas is frozen behind the card.
    expect(canvas.props.isPaused).toBe(true);
  });

  it("in a test build, reads the run's counters, or null before there is an engine", async () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    await renderRun();
    expect(hooks.__starswarm_getRunStats!()).toBeNull();

    canvas.state = initStarSwarm(CANVAS_W, CANVAS_H, 3, 42, "Commander");
    expect(hooks.__starswarm_getRunStats!()).toEqual({
      runStats: canvas.state.runStats,
      tierStats: canvas.state.tierStats,
      wave: 3,
      difficulty: "Commander",
      score: 0,
      frame: null,
    });
  });

  it("removes the hooks when the screen goes away", async () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    const view = await renderRun();
    expect(hooks.__starswarm_endRun).toBeDefined();
    await view.unmount();
    expect(hooks.__starswarm_endRun).toBeUndefined();
    expect(hooks.__starswarm_getRunStats).toBeUndefined();
  });
});

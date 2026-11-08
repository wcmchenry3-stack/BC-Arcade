/**
 * #3600: the ship picker in the pre-game modal. Three free, cosmetic ships; the pick reaches the
 * canvas as its `ship` prop, is saved when the run starts, and is restored on the next visit. The
 * canvas is the shared stand-in (helpers/starSwarmMocks): `canvas.props` are the props it got.
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { CANVAS_H, CANVAS_W, initStarSwarm } from "../../game/starswarm/engine";
import { clearSavedPausedState } from "../../game/starswarm/pauseStore";
import type { StarSwarmState } from "../../game/starswarm/types";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";
import { canvas, resetHarness } from "./helpers/starSwarmMocks";
import { renderScreen, startRun } from "./helpers/starSwarmHarness";

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
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  const start = jest.fn(() => "run-1");
  return mockGameEventClient({
    startGame: lazy(() => start),
    resumeGame: lazy(() => jest.fn(() => null)),
    markStarted: jest.fn(),
    discardGame: jest.fn(),
    completeGame: lazy(() => jest.fn()),
  });
});

beforeEach(async () => {
  jest.clearAllMocks();
  resetHarness();
  canvas.state = initStarSwarm(CANVAS_W, CANVAS_H, 1, 7, "Ensign") as StarSwarmState;
  clearSavedPausedState();
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
});

const tap = async (id: string) => {
  await act(async () => {
    await fireEvent.press(screen.getByTestId(`starswarm-ship-${id}`));
  });
};

describe("Star Swarm ship picker (#3600)", () => {
  it("shows three ships above the difficulty picker, Falcon selected for a new player", async () => {
    await renderScreen();
    expect(screen.getByLabelText("Choose your ship").props.accessibilityRole).toBe("radiogroup");
    for (const [id, name] of [
      ["p1", "Falcon"],
      ["p2", "Raptor"],
      ["p3", "Osprey"],
    ] as const) {
      const tile = screen.getByTestId(`starswarm-ship-${id}`);
      expect(tile.props.accessibilityRole).toBe("radio");
      expect(tile.props.accessibilityLabel).toBe(name);
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.getByTestId("starswarm-ship-p1").props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(screen.getByTestId("starswarm-ship-p2").props.accessibilityState).toMatchObject({
      checked: false,
    });
    expect(canvas.props.ship).toBe("p1");
  });

  it("selects the tapped ship and hands it to the canvas", async () => {
    await renderScreen();
    await tap("p3");
    expect(screen.getByTestId("starswarm-ship-p3").props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(screen.getByTestId("starswarm-ship-p1").props.accessibilityState).toMatchObject({
      checked: false,
    });
    expect(canvas.props.ship).toBe("p3");
  });

  it("saves the ship when the run starts, not on a tap", async () => {
    await renderScreen();
    await tap("p2");
    expect(await AsyncStorage.getItem("starswarm.ship")).toBeNull();
    await startRun();
    await waitFor(async () => expect(await AsyncStorage.getItem("starswarm.ship")).toBe("p2"));
    expect(canvas.props.ship).toBe("p2");
  });

  it("opens on the saved ship", async () => {
    await AsyncStorage.setItem("starswarm.ship", "p3");
    await renderScreen();
    await waitFor(() => expect(canvas.props.ship).toBe("p3"));
    expect(screen.getByTestId("starswarm-ship-p3").props.accessibilityState).toMatchObject({
      checked: true,
    });
  });

  it("falls back to Arrow for a stored value that is not a ship", async () => {
    await AsyncStorage.setItem("starswarm.ship", "p9");
    await renderScreen();
    expect(canvas.props.ship).toBe("p1");
  });
});

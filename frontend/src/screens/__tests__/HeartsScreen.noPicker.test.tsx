/**
 * HeartsScreen without the opponent picker (#3489): with HEARTS_OPPONENT_PICKER_ENABLED
 * off there is no pre-game screen. The table is dealt as soon as no saved game is found,
 * New Game deals a Conservative game, and a remembered legacy style is ignored. With the
 * switch on, the old pre-game picker is back. Other HeartsScreen tests run with it on.
 */

import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import HeartsScreen from "../HeartsScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { HeartsRoundsProvider } from "../../game/hearts/RoundsContext";
import * as engine from "../../game/hearts/engine";
import { loadGame } from "../../game/hearts/storage";
import type { HeartsState } from "../../game/hearts/types";
import { heartsCard, heartsPlay } from "./helpers/heartsFixtures";

let mockPickerEnabled = false;
jest.mock("../../game/hearts/types", () => {
  const actual = jest.requireActual("../../game/hearts/types");
  return Object.defineProperty({ ...actual }, "HEARTS_OPPONENT_PICKER_ENABLED", {
    enumerable: true,
    get: () => mockPickerEnabled,
  });
});

jest.mock("../../game/hearts/storage", () => ({
  loadGame: jest.fn().mockResolvedValue(null),
  saveGame: jest.fn().mockResolvedValue(undefined),
  clearGame: jest.fn().mockResolvedValue(undefined),
  loadFinishedGameId: jest.fn().mockResolvedValue(null),
  saveFinishedGameId: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../game/hearts/playerNames", () => ({
  ...jest.requireActual("../../game/hearts/playerNames"),
  loadPlayerNames: jest.fn().mockResolvedValue(["You", "West", "North", "East"]),
  savePlayerNames: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../game/_shared/displayNameSync", () => mockScreenDeps().mockDisplayNameSync());
jest.mock("../../game/_shared/gameEventClient", () =>
  mockScreenDeps().mockGameEventClient({
    startGame: jest.fn(() => "hearts-game-1"),
    resumeGame: jest.fn(() => null),
    markStarted: jest.fn(),
    discardGame: jest.fn(),
    completeGame: jest.fn(),
    enqueueEvents: jest.fn(),
  })
);
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(
    () => ({
      goBack: jest.fn(),
      popToTop: jest.fn(),
      navigate: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    { useFocusEffect: jest.fn() }
  )
);
jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => []));

jest.useFakeTimers();

function mount() {
  return render(
    <ThemeProvider>
      <HeartsRoundsProvider>
        <HeartsScreen />
      </HeartsRoundsProvider>
    </ThemeProvider>
  );
}

async function mountOn(saved: HeartsState | null) {
  (loadGame as jest.Mock).mockResolvedValue(saved);
  const api = await mount();
  await waitFor(() => expect(loadGame).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
  return api;
}

const noPreGame = (api: Awaited<ReturnType<typeof mountOn>>) => {
  expect(api.queryByTestId("hearts-start-game")).toBeNull();
  expect(api.queryByTestId("hearts-difficulty-conservative")).toBeNull();
  expect(api.queryByText("Opponent Style")).toBeNull();
};

const finishedGame = () =>
  heartsPlay({
    aiDifficulty: "conservative",
    phase: "game_over",
    isComplete: true,
    winnerIndex: 0,
    cumulativeScores: [46, 100, 63, 52],
  });

beforeEach(async () => {
  mockPickerEnabled = false;
  await AsyncStorage.clear();
  (loadGame as jest.Mock).mockReset().mockResolvedValue(null);
});

describe("HeartsScreen without the opponent picker (#3489)", () => {
  it("deals a table straight away when there is no saved game", async () => {
    const dealGame = jest.spyOn(engine, "dealGame");
    try {
      const api = await mountOn(null);
      noPreGame(api);
      expect(api.getByLabelText("Your hand, 13 cards")).toBeTruthy();
      expect(dealGame).toHaveBeenCalledTimes(1);
      expect(dealGame).toHaveBeenCalledWith("conservative");
    } finally {
      dealGame.mockRestore();
    }
  });

  it("shows no pre-game screen while the saved-game check is still running", async () => {
    let release: (s: HeartsState | null) => void = () => {};
    (loadGame as jest.Mock).mockReturnValue(new Promise((r) => (release = r)));
    const dealGame = jest.spyOn(engine, "dealGame");
    try {
      const api = await mount();
      await waitFor(() => expect(loadGame).toHaveBeenCalled());
      noPreGame(api);
      expect(dealGame).not.toHaveBeenCalled();
      await act(async () => {
        release(null);
      });
      noPreGame(api);
      expect(api.getByLabelText("Your hand, 13 cards")).toBeTruthy();
      expect(dealGame).toHaveBeenCalledTimes(1);
    } finally {
      dealGame.mockRestore();
    }
  });

  it("ignores a legacy style remembered by an earlier build for the new game", async () => {
    await AsyncStorage.setItem("hearts.difficulty", "daring");
    const dealGame = jest.spyOn(engine, "dealGame");
    try {
      const api = await mountOn(null);
      noPreGame(api);
      expect(dealGame).toHaveBeenCalledWith("conservative");
      expect(dealGame).not.toHaveBeenCalledWith("daring");
      expect(await AsyncStorage.getItem("hearts.difficulty")).toBe("conservative");
    } finally {
      dealGame.mockRestore();
    }
  });

  it("resumes a saved game as before, dealing nothing", async () => {
    const dealGame = jest.spyOn(engine, "dealGame");
    try {
      const api = await mountOn(
        heartsPlay({
          aiDifficulty: "conservative",
          currentPlayerIndex: 1,
          playerHands: [
            [heartsCard("clubs", "2")],
            [heartsCard("clubs", "3")],
            [heartsCard("clubs", "4")],
            [heartsCard("clubs", "5")],
          ],
        })
      );
      noPreGame(api);
      expect(api.getByTestId("hearts-hand-card-0")).toBeTruthy();
      expect(api.queryByTestId("hearts-hand-card-1")).toBeNull();
      expect(dealGame).not.toHaveBeenCalled();
    } finally {
      dealGame.mockRestore();
    }
  });

  it("the New Game menu item starts a fresh conservative game directly", async () => {
    const api = await mountOn(null);
    const dealGame = jest.spyOn(engine, "dealGame");
    try {
      await act(async () => {
        await fireEvent.press(api.getByLabelText("More options"));
      });
      await act(async () => {
        await fireEvent.press(api.getByText("New Game"));
      });
      const confirm = api.queryByLabelText("Start New");
      if (confirm) {
        await act(async () => {
          await fireEvent.press(confirm);
        });
      }
      noPreGame(api);
      expect(dealGame).toHaveBeenCalledTimes(1);
      expect(dealGame).toHaveBeenCalledWith("conservative");
      expect(api.getByLabelText("Your hand, 13 cards")).toBeTruthy();
    } finally {
      dealGame.mockRestore();
    }
  });

  it("a finished game offers Play Again and no Change Difficulty; Play Again deals a table", async () => {
    const dealGame = jest.spyOn(engine, "dealGame");
    try {
      const api = await mountOn(finishedGame());
      await api.findByTestId("hearts-result");
      expect(api.queryByRole("button", { name: "Change Difficulty" })).toBeNull();
      await act(async () => {
        await fireEvent.press(api.getByRole("button", { name: "Play Again" }));
      });
      expect(api.queryByTestId("hearts-result")).toBeNull();
      noPreGame(api);
      expect(dealGame).toHaveBeenCalledWith("conservative");
      expect(api.getByLabelText("Your hand, 13 cards")).toBeTruthy();
    } finally {
      dealGame.mockRestore();
    }
  });
});

describe("HeartsScreen with the opponent picker switched on (#3489)", () => {
  it("shows the pre-game screen and deals nothing until Start Game", async () => {
    mockPickerEnabled = true;
    const dealGame = jest.spyOn(engine, "dealGame");
    try {
      const api = await mountOn(null);
      expect(api.getByTestId("hearts-start-game")).toBeTruthy();
      expect(dealGame).not.toHaveBeenCalled();
      await act(async () => {
        await fireEvent.press(api.getByTestId("hearts-start-game"));
      });
      expect(api.queryByTestId("hearts-start-game")).toBeNull();
      expect(dealGame).toHaveBeenCalledWith("conservative");
    } finally {
      dealGame.mockRestore();
    }
  });

  it("a finished game offers Change Difficulty, which returns to the pre-game screen", async () => {
    mockPickerEnabled = true;
    const api = await mountOn(finishedGame());
    await api.findByTestId("hearts-result");
    await act(async () => {
      await fireEvent.press(api.getByRole("button", { name: "Change Difficulty" }));
    });
    expect(api.getByTestId("hearts-start-game")).toBeTruthy();
  });
});

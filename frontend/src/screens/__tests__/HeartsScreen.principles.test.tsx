/**
 * A conservative AI play records the principle behind it in the debug panel's
 * live hand (#3163). Same harness as the debug-panel block of HeartsScreen.flow.test.tsx.
 */
import React from "react";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import { HeartsRoundsProvider } from "../../game/hearts/RoundsContext";
import HeartsScreen from "../HeartsScreen";
import { loadGame } from "../../game/hearts/storage";
import { createSeededRng, setRng } from "../../game/hearts/engine";
import { heartsCard, heartsPlay } from "./helpers/heartsFixtures";
import type { HeartsState } from "../../game/hearts/types";

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
jest.mock("../../game/_shared/gameEventClient", () => mockScreenDeps().mockGameEventClient());
jest.mock("../../game/_shared/displayNameSync", () => mockScreenDeps().mockDisplayNameSync());
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(
    () => ({
      goBack: jest.fn(),
      popToTop: jest.fn(),
      navigate: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    {
      useFocusEffect: (effect: () => void | (() => void)) => {
        const { useEffect } = jest.requireActual<typeof import("react")>("react");
        useEffect(effect, [effect]);
      },
    }
  )
);
jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => []));

jest.useFakeTimers();

/** Trick 12: the human led 5♦; each AI holds two diamonds, so each has a real choice. */
const trick12 = (): HeartsState =>
  heartsPlay({
    aiDifficulty: "conservative",
    handNumber: 1,
    passDirection: "none",
    tricksPlayedInHand: 11,
    currentLeaderIndex: 0,
    currentPlayerIndex: 1,
    heartsBroken: true,
    currentTrick: [{ playerIndex: 0, card: heartsCard("diamonds", 5) }],
    playerHands: [
      [heartsCard("clubs", 2)],
      [heartsCard("diamonds", 7), heartsCard("diamonds", 10)],
      [heartsCard("diamonds", 8), heartsCard("diamonds", 11)],
      [heartsCard("diamonds", 9), heartsCard("diamonds", 12)],
    ],
  });

describe("HeartsScreen debug panel: CPU principles", () => {
  beforeEach(() => {
    setRng(createSeededRng(42));
    (loadGame as jest.Mock).mockResolvedValue(trick12());
  });

  it("records the principle of each conservative AI play, shown in the panel", async () => {
    const api = await render(
      <ThemeProvider>
        <HeartsRoundsProvider>
          <HeartsScreen />
        </HeartsRoundsProvider>
      </ThemeProvider>
    );
    await waitFor(() => expect(api.queryByTestId("hearts-start-game")).toBeNull());
    await act(async () => {
      await Promise.resolve();
    });
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        jest.advanceTimersByTime(400);
      });
    }
    await act(async () => {
      await fireEvent.press(api.getByLabelText("Toggle Hearts debugger panel"));
    });
    const live = api.getByTestId("cpu-principles-live", { includeHiddenElements: true });
    expect(live).toBeTruthy();
    // The three AI seats each played in the trick; every play lists a rulebook principle ID.
    expect(
      within(live).getAllByText(/^P\d+-[A-Z-]+$/, { includeHiddenElements: true }).length
    ).toBeGreaterThanOrEqual(3);
  });
});

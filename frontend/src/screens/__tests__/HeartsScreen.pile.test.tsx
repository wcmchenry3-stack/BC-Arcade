/**
 * HeartsScreen pile dialog timing (#3587): when the hand ends, the pile dialog is hidden in the
 * same render that mounts the hand-end card, not one commit later.
 */

import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import HeartsScreen from "../HeartsScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { HeartsRoundsProvider } from "../../game/hearts/RoundsContext";
import { loadGame } from "../../game/hearts/storage";
import { heartsCard, heartsPlay } from "./helpers/heartsFixtures";

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

const mockPlayed: string[] = [];
jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => mockPlayed));

jest.useFakeTimers();

// Every ModalCard render, in order: the pile dialog and the hand-end card.
const mockModals: { id: string; visible: boolean }[] = [];
jest.mock("../../components/shared/ModalCard", () => {
  const actual = jest.requireActual("../../components/shared/ModalCard");
  return {
    ...actual,
    ModalCard: (props: { testID?: string; visible: boolean }) => {
      mockModals.push({ id: props.testID ?? "other", visible: props.visible });
      return actual.ModalCard(props);
    },
  };
});

const lastTrick = () =>
  heartsPlay({
    tricksPlayedInHand: 12,
    currentLeaderIndex: 1,
    currentPlayerIndex: 0,
    currentTrick: [
      { playerIndex: 1, card: heartsCard("clubs", 3) },
      { playerIndex: 2, card: heartsCard("clubs", 2) },
      { playerIndex: 3, card: heartsCard("clubs", 4) },
    ],
    playerHands: [[heartsCard("clubs", 10)], [], [], []],
  });

it("the pile dialog is already hidden in the render that mounts the hand-end card", async () => {
  (loadGame as jest.Mock).mockResolvedValue(lastTrick());
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
  await act(async () => {
    await fireEvent.press(api.getByLabelText(/^You, score 0/));
  });
  expect(api.getByText("You: cards taken")).toBeTruthy();
  mockModals.length = 0;
  await act(async () => {
    await fireEvent.press(
      api.getByTestId("hearts-hand-playable-0", { includeHiddenElements: true })
    );
  });
  expect(api.getByText("Hand Complete")).toBeTruthy();
  const firstHandEnd = mockModals.findIndex((m) => m.id === "other" && m.visible);
  expect(firstHandEnd).toBeGreaterThan(-1);
  const pileBefore = mockModals
    .slice(0, firstHandEnd)
    .filter((m) => m.id === "hearts-captured-modal")
    .at(-1);
  // In the same pass as the first hand-end render, the pile is not visible (not one commit later).
  expect(pileBefore?.visible).toBe(false);
});

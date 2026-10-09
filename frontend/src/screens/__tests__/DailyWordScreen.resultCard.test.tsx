/**
 * DailyWordScreen result card visibility (#2981): the card is derived from
 * `state.is_complete && !revealPending`, so a winning guess keeps it hidden
 * while the row flips and shows it once the flip timer fires.
 */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import DailyWordScreen from "../DailyWordScreen";
import { ThemeProvider } from "../../theme/ThemeContext";

const mockPopToTop = jest.fn();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({ popToTop: mockPopToTop, navigate: jest.fn() }), {
    actual: true,
    useRoute: () => ({ name: "DailyWord" }),
  })
);
jest.mock("../../game/_shared/NetworkContext", () => mockScreenDeps().mockNetwork());
jest.mock("../../game/daily_word/api", () => ({
  dailyWordApi: { getToday: jest.fn(), submitGuess: jest.fn(), getAnswer: jest.fn() },
}));
jest.mock("../../game/daily_word/storage", () => ({
  loadState: jest.fn(),
  saveState: jest.fn(),
  clearState: jest.fn(),
  saveTodayMeta: jest.fn().mockResolvedValue(undefined),
  loadTodayMeta: jest.fn().mockResolvedValue(null),
}));
jest.mock("../../game/_shared/gameEventClient", () =>
  mockScreenDeps().mockGameEventClient({
    startGame: jest.fn(() => "game-1"),
    resumeGame: jest.fn(() => null),
  })
);
const mockPlayed: string[] = [];
jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => mockPlayed));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "Light", Heavy: "Heavy" },
  NotificationFeedbackType: { Success: "Success", Warning: "Warning", Error: "Error" },
}));

const { dailyWordApi } = jest.requireMock("../../game/daily_word/api") as {
  dailyWordApi: { getToday: jest.Mock; submitGuess: jest.Mock; getAnswer: jest.Mock };
};
const storage = jest.requireMock("../../game/daily_word/storage") as {
  loadState: jest.Mock;
  saveState: jest.Mock;
  clearState: jest.Mock;
};

const PUZZLE = { puzzle_id: "2026-05-03:en", word_length: 5 };
const tilesFor = (word: string, status: "correct" | "absent") =>
  word.split("").map((letter) => ({ letter, status }));

async function mount() {
  await render(
    <ThemeProvider>
      <DailyWordScreen />
    </ThemeProvider>
  );
  await screen.findByTestId("tile-0-0");
}

const key = (k: string) =>
  act(async () => {
    await fireEvent.press(screen.getByTestId(`daily-word-key-${k}`));
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockPlayed.length = 0;
  dailyWordApi.getToday.mockResolvedValue(PUZZLE);
  dailyWordApi.getAnswer.mockResolvedValue({ answer: "crane" });
  storage.loadState.mockResolvedValue(null);
  storage.saveState.mockResolvedValue(undefined);
  storage.clearState.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("result card visibility", () => {
  it("stays hidden while the winning row flips, and shows after the flip timer", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({ tiles: tilesFor("crane", "correct") });
    await mount();
    jest.useFakeTimers();
    for (const ch of "crane") await key(ch);
    const spy = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
    try {
      await key("enter");
    } finally {
      spy.mockRestore();
    }

    // The board is already complete, but the flip has not finished.
    expect(screen.getByTestId("tile-0-0")).toHaveTextContent("C");
    expect(screen.queryByTestId("daily-word-result")).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.getByTestId("daily-word-result")).toBeTruthy();
    expect(screen.getByText("You Win!")).toBeTruthy();
  });
});

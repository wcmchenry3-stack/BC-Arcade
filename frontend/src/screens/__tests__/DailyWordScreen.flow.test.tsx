/**
 * DailyWordScreen guess flow and developer panel (#2957): the toast each
 * failed guess shows, deleting a letter, a game finished by its last guess
 * (win and loss cards after the flip), resuming a board in progress, the exits,
 * and the DEV panel of dev builds. The API and storage are stand-ins.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import DailyWordScreen from "../DailyWordScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { ApiError } from "../../game/_shared/httpClient";
import { devLog } from "../../game/daily_word/devLog";
import type { DailyWordState } from "../../game/daily_word/types";

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
const emptyRow = () => ({
  tiles: Array.from({ length: 5 }, () => ({ letter: "", status: "empty" as const })),
  submitted: false,
});
const wrongRow = (word: string) => ({
  tiles: word.split("").map((letter) => ({ letter, status: "absent" as const })),
  submitted: true,
});
const tilesFor = (word: string, status: "correct" | "absent") =>
  word.split("").map((letter) => ({ letter, status }));

/** A board in progress: `guessed` words already submitted. */
function boardWith(guessed: string[]): DailyWordState {
  return {
    _v: 1,
    puzzle_id: PUZZLE.puzzle_id,
    word_length: 5,
    language: "en",
    rows: Array.from({ length: 6 }, (_, i) => (guessed[i] ? wrongRow(guessed[i]!) : emptyRow())),
    current_row: guessed.length,
    keyboard_state: {},
    is_complete: false,
    won: false,
    completed_at: null,
  };
}

const WON_BOARD: DailyWordState = {
  ...boardWith(["crane"]),
  rows: [
    {
      tiles: tilesFor("crane", "correct"),
      submitted: true,
    },
    ...Array.from({ length: 5 }, emptyRow),
  ],
  is_complete: true,
  won: true,
  completed_at: "2026-05-03T12:00:00Z",
};

async function mount() {
  const view = await render(
    <ThemeProvider>
      <DailyWordScreen />
    </ThemeProvider>
  );
  await screen.findByTestId("tile-0-0");
  return view;
}

const key = (k: string) =>
  act(async () => {
    await fireEvent.press(screen.getByTestId(`daily-word-key-${k}`));
  });

async function type(word: string) {
  for (const ch of word) await key(ch);
}

/** Types a word and presses Enter, past onSubmit's 500 ms debounce. */
async function guess(word: string) {
  await type(word);
  const spy = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 5000 * (guessCalls += 1));
  try {
    await key("enter");
  } finally {
    spy.mockRestore();
  }
}
let guessCalls = 0;

beforeEach(() => {
  jest.clearAllMocks();
  guessCalls = 0;
  devLog.clear();
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

describe("a guess that is not accepted", () => {
  it("asks for more letters when the row is not full", async () => {
    await mount();
    await type("ab");
    await key("enter");
    expect(screen.getByText("Not enough letters")).toBeTruthy();
    expect(dailyWordApi.submitGuess).not.toHaveBeenCalled();
  });

  it.each<[string, Error, string]>([
    ["a word not in the list", new ApiError("not_a_word", 422), "Not in word list"],
    [
      "a guess of the wrong length",
      new ApiError("wrong_guess_length", 422),
      "Guess length doesn't match today's word",
    ],
    ["another 422", new ApiError("something_else", 422), "Could not submit your guess"],
    ["rate limiting", new ApiError("slow_down", 429), "Too many guesses — try again later"],
    ["a server error", new ApiError("boom", 500), "Could not submit your guess"],
    ["a network failure", new Error("offline"), "Could not submit your guess"],
  ])("%s shows its toast, and leaves the board for another try", async (_name, error, toast) => {
    dailyWordApi.submitGuess.mockRejectedValue(error);
    await mount();
    await guess("zzzzz");
    expect(await screen.findByText(toast)).toBeTruthy();
    // The typed word stays on its row, so the player can edit it.
    expect(screen.getByTestId("tile-0-0")).toHaveTextContent("Z");
  });

  it("a stale puzzle loads today's word and says so", async () => {
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError("stale_puzzle_id", 422));
    await mount();
    await guess("zzzzz");
    expect(await screen.findByText("New puzzle available — loading today's word")).toBeTruthy();
    expect(storage.clearState).toHaveBeenCalled();
  });

  it("a stale puzzle that cannot be reloaded says it could not load", async () => {
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError("stale_puzzle_id", 422));
    await mount();
    dailyWordApi.getToday.mockRejectedValue(new Error("offline"));
    await guess("zzzzz");
    expect(await screen.findByText("Could not load today's puzzle")).toBeTruthy();
  });

  it("a toast goes away by itself", async () => {
    await mount();
    jest.useFakeTimers();
    await type("ab");
    await key("enter");
    expect(screen.getByText("Not enough letters")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("Not enough letters")).toBeNull();
  });
});

describe("typing", () => {
  it("Delete takes the last letter back, and does nothing on an empty row", async () => {
    await mount();
    await type("ab");
    expect(screen.getByTestId("tile-0-1")).toHaveTextContent("B");
    await key("delete");
    expect(screen.getByTestId("tile-0-1")).not.toHaveTextContent("B");
    expect(screen.getByTestId("tile-0-0")).toHaveTextContent("A");
    await key("delete");
    await key("delete");
    expect(screen.getByTestId("tile-0-0")).not.toHaveTextContent("A");
  });

  it("picks up a board in progress", async () => {
    storage.loadState.mockResolvedValue(boardWith(["zzzzz"]));
    await mount();
    expect(screen.getByTestId("tile-0-0")).toHaveTextContent("Z");
    await type("a");
    expect(screen.getByTestId("tile-1-0")).toHaveTextContent("A");
  });
});

describe("finishing the game", () => {
  it("a winning guess flips the row, then shows the win card", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({ tiles: tilesFor("crane", "correct") });
    await mount();
    jest.useFakeTimers();
    await guess("crane");
    expect(screen.queryByText("You Win!")).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.getByText("You Win!")).toBeTruthy();
  });

  it("the last wrong guess shows the loss card with the answer", async () => {
    storage.loadState.mockResolvedValue(boardWith(["aaaaa", "bbbbb", "ccccc", "ddddd", "eeeee"]));
    dailyWordApi.submitGuess.mockResolvedValue({ tiles: tilesFor("zzzzz", "absent") });
    await mount();
    jest.useFakeTimers();
    await guess("zzzzz");
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    await waitFor(() => expect(screen.getByText("The word was CRANE")).toBeTruthy());
    expect(screen.getByText("You Lose")).toBeTruthy();
  });

  it("the loss card still opens when the answer cannot be fetched", async () => {
    storage.loadState.mockResolvedValue(boardWith(["aaaaa", "bbbbb", "ccccc", "ddddd", "eeeee"]));
    dailyWordApi.submitGuess.mockResolvedValue({ tiles: tilesFor("zzzzz", "absent") });
    dailyWordApi.getAnswer.mockRejectedValue(new Error("offline"));
    await mount();
    jest.useFakeTimers();
    await guess("zzzzz");
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    await waitFor(() => expect(screen.getByText("You Lose")).toBeTruthy());
    expect(screen.queryByText(/The word was/)).toBeNull();
  });
});

describe("leaving", () => {
  it("goes back to the lobby from the header", async () => {
    await mount();
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Go back to home screen"));
    });
    expect(mockPopToTop).toHaveBeenCalledTimes(1);
  });

  it("goes back to the lobby while the puzzle is still loading", async () => {
    dailyWordApi.getToday.mockReturnValue(new Promise(() => {}));
    await render(
      <ThemeProvider>
        <DailyWordScreen />
      </ThemeProvider>
    );
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Go back to home screen"));
    });
    expect(mockPopToTop).toHaveBeenCalledTimes(1);
  });

  it("goes home from the result card", async () => {
    storage.loadState.mockResolvedValue(WON_BOARD);
    await render(
      <ThemeProvider>
        <DailyWordScreen />
      </ThemeProvider>
    );
    await act(async () => {
      await fireEvent.press(await screen.findByRole("button", { name: "Home" }));
    });
    expect(mockPopToTop).toHaveBeenCalledTimes(1);
  });
});

describe("developer panel", () => {
  const open = async () => {
    await act(async () => {
      await fireEvent.press(screen.getByText("DEV"));
    });
  };

  it("opens from the DEV button and closes from its own button", async () => {
    await mount();
    expect(screen.queryByText("Dev Panel")).toBeNull();
    await open();
    expect(screen.getByText("Dev Panel")).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByText("Close"));
    });
    expect(screen.queryByText("Dev Panel")).toBeNull();
  });

  it("shows the puzzle and the board's state", async () => {
    storage.loadState.mockResolvedValue(boardWith(["zzzzz"]));
    await mount();
    await open();
    expect(screen.getByText(/puzzle_id: 2026-05-03:en/)).toBeTruthy();
    expect(screen.getByText(/row: 1\s+won: false\s+done: false/)).toBeTruthy();
    expect(screen.getByText(/1: zzzzz\s+\[aaaaa\]/)).toBeTruthy();
  });

  it("shows and hides today's answer", async () => {
    await mount();
    await open();
    await act(async () => {
      await fireEvent.press(screen.getByText("Show Answer"));
    });
    expect(screen.getByText("CRANE")).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByText("Hide Answer"));
    });
    expect(screen.queryByText("CRANE")).toBeNull();
    expect(screen.getByText("Show Answer")).toBeTruthy();
  });

  it("says so when the answer cannot be fetched", async () => {
    dailyWordApi.getAnswer.mockRejectedValue(new Error("offline"));
    await mount();
    await open();
    await act(async () => {
      await fireEvent.press(screen.getByText("Show Answer"));
    });
    expect(screen.getByText("(failed to fetch)")).toBeTruthy();
  });

  it("Reset Game starts today's board over and closes the panel", async () => {
    storage.loadState.mockResolvedValue(boardWith(["zzzzz"]));
    await mount();
    await open();
    await act(async () => {
      await fireEvent.press(screen.getByText("Reset Game"));
    });
    expect(storage.clearState).toHaveBeenCalled();
    expect(screen.queryByText("Dev Panel")).toBeNull();
    expect(screen.getByTestId("tile-0-0")).not.toHaveTextContent("Z");
  });

  it("logs the API calls, expands one, and clears the log", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({ tiles: tilesFor("zzzzz", "absent") });
    await mount();
    await guess("zzzzz");
    await open();
    expect(screen.queryByText("No API calls yet")).toBeNull();
    const entry = screen.getByText(/POST \/daily-word\/guess/);

    expect(screen.queryByText(/"guess": "zzzzz"/)).toBeNull();
    await act(async () => {
      await fireEvent.press(entry);
    });
    expect(screen.getByText(/"guess": "zzzzz"/)).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByText(/POST \/daily-word\/guess/));
    });
    expect(screen.queryByText(/"guess": "zzzzz"/)).toBeNull();

    await act(async () => {
      await fireEvent.press(screen.getByText("Clear log"));
    });
    expect(screen.getByText("No API calls yet")).toBeTruthy();
  });
});

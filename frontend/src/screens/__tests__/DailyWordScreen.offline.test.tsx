/**
 * DailyWordScreen offline play (#3230): the puzzles fetched ahead are played
 * on their own local day and scored on the device, the result is reported
 * through the game session (queued for SyncWorker), boards are kept per
 * puzzle, and past the 3-day window the shared reconnect message shows.
 *
 * Storage and the offline puzzle cache are the real modules over the
 * in-memory AsyncStorage mock; the API is a stand-in that is offline unless a
 * test says otherwise.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import DailyWordScreen from "../DailyWordScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { bytesToBase64 } from "../../game/_shared/base64Bytes";
import { LAST_CONNECTED_KEY } from "../../game/_shared/lastConnected";
import { LAST_KNOWN_STREAK_KEY } from "../../game/_shared/lastKnownStreak";
import { localDateString } from "../../game/daily_word/offlinePuzzles";
import { sha256 } from "../../game/daily_word/sha256";
import { getTimezoneOffset } from "../../game/daily_word/todayMeta";
import { saveState } from "../../game/daily_word/storage";
import { initialState } from "../../game/daily_word/engine";

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({ popToTop: jest.fn(), navigate: jest.fn() }), {
    actual: true,
    useRoute: () => ({ name: "DailyWord" }),
  })
);
jest.mock("../../game/_shared/NetworkContext", () => mockScreenDeps().mockNetwork());
jest.mock("../../game/daily_word/api", () => ({
  dailyWordApi: {
    getToday: jest.fn(),
    getUpcoming: jest.fn(),
    submitGuess: jest.fn(),
    getAnswer: jest.fn(),
  },
}));
// No back-off waits: a network failure is final at once.
jest.mock("../../game/_shared/withRetry", () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
}));
const mockStartGame = jest.fn(() => "game-1");
const mockCompleteGame = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    completeGame: lazy(() => mockCompleteGame),
    resumeGame: jest.fn(() => null),
  });
});
jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => []));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "Light", Heavy: "Heavy" },
  NotificationFeedbackType: { Success: "Success", Warning: "Warning", Error: "Error" },
}));

const { dailyWordApi } = jest.requireMock("../../game/daily_word/api") as {
  dailyWordApi: {
    getToday: jest.Mock;
    getUpcoming: jest.Mock;
    submitGuess: jest.Mock;
    getAnswer: jest.Mock;
  };
};

const OFFLINE = () => new TypeError("Network request failed");
const DAY_MS = 86_400_000;
const ANSWER = "crane";

/** The puzzle id for the local day `dayOffset` from today. */
const puzzleId = (dayOffset: number) => `${localDateString(getTimezoneOffset(), dayOffset)}:en:2`;

/** The server's scramble_answer (#3229), for building the cache. */
function scramble(id: string, answer: string): string {
  const key = sha256(new TextEncoder().encode(id));
  const raw = new TextEncoder().encode(answer);
  return bytesToBase64(raw.map((b, i) => b ^ key[i % key.length]!));
}

/** Puzzles fetched ahead on the day `fetchedDaysAgo` days back: that day and two after. */
async function seedFetchedAhead(fetchedDaysAgo: number, answer = ANSWER) {
  const days = [0, 1, 2].map((k) => k - fetchedDaysAgo);
  await AsyncStorage.setItem(
    "daily_word_upcoming_en",
    JSON.stringify(
      days.map((d) => ({
        puzzle_id: puzzleId(d),
        word_length: 5,
        answer_blob: scramble(puzzleId(d), answer),
      }))
    )
  );
  await AsyncStorage.setItem(LAST_CONNECTED_KEY, String(Date.now() - fetchedDaysAgo * DAY_MS));
}

async function mount() {
  return render(
    <ThemeProvider>
      <DailyWordScreen />
    </ThemeProvider>
  );
}

const key = (k: string) =>
  act(async () => {
    await fireEvent.press(screen.getByTestId(`daily-word-key-${k}`));
  });

let guessCalls = 0;
/** Types a word and presses Enter, past onSubmit's 500 ms debounce. */
async function guess(word: string) {
  for (const ch of word) await key(ch);
  const realNow = Date.now.bind(Date);
  const spy = jest.spyOn(Date, "now").mockImplementation(() => realNow() + 5000 * guessCalls);
  guessCalls += 1;
  try {
    await key("enter");
  } finally {
    spy.mockRestore();
  }
}

/** Lets the flip timer run out so the result card can open. */
async function finishFlip() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1500));
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  guessCalls = 0;
  await AsyncStorage.clear();
  dailyWordApi.getToday.mockRejectedValue(OFFLINE());
  dailyWordApi.submitGuess.mockRejectedValue(OFFLINE());
  dailyWordApi.getAnswer.mockRejectedValue(OFFLINE());
  dailyWordApi.getUpcoming.mockRejectedValue(OFFLINE());
});

describe.each([0, 1, 2])("offline on day %i after the last connection", (daysAgo) => {
  it("plays that day's puzzle and scores the guess on the device", async () => {
    await seedFetchedAhead(daysAgo);
    await mount();
    await screen.findByTestId("tile-0-0");

    await guess("slate");
    expect(dailyWordApi.submitGuess).not.toHaveBeenCalled();
    // The board is saved under today's puzzle (#3230), with the device's
    // tiles: s l a t e vs c r a n e, a and e in place, the rest absent.
    const savedBoard = async () =>
      JSON.parse((await AsyncStorage.getItem(`daily_word_board_${puzzleId(0)}`)) ?? "null");
    await waitFor(async () => expect((await savedBoard())?.rows[0].submitted).toBe(true));
    const saved = await savedBoard();
    expect(saved.rows[0].tiles.map((t: { status: string }) => t.status)).toEqual([
      "absent",
      "absent",
      "correct",
      "absent",
      "correct",
    ]);
  });
});

describe("an offline finish", () => {
  it("a solve is recorded as a win for the game session, to sync later", async () => {
    await seedFetchedAhead(1);
    await mount();
    await screen.findByTestId("tile-0-0");
    await guess("crane");
    await finishFlip();

    expect(await screen.findByText("You Win!")).toBeTruthy();
    expect(dailyWordApi.submitGuess).not.toHaveBeenCalled();
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    expect(mockStartGame.mock.calls[0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ puzzle_id: puzzleId(0) })])
    );
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [, summary, payload] = mockCompleteGame.mock.calls[0] as unknown[];
    expect(summary).toMatchObject({ outcome: "win", finalScore: null });
    expect(payload).toMatchObject({ is_complete: true, won: true, guesses_used: 1 });
  });

  it("a loss shows the cached answer without asking the server", async () => {
    await seedFetchedAhead(0);
    await saveState({
      ...initialState(puzzleId(0), 5, "en"),
      rows: [
        ...["slate", "pious", "dumpy", "fight", "block"].map((w) => ({
          tiles: w.split("").map((letter) => ({ letter, status: "absent" as const })),
          submitted: true,
        })),
        {
          tiles: Array.from({ length: 5 }, () => ({ letter: "", status: "empty" as const })),
          submitted: false,
        },
      ],
      current_row: 5,
    });
    await mount();
    await screen.findByTestId("tile-0-0");
    await guess("mossy");
    await finishFlip();

    expect(await screen.findByText("You Lose")).toBeTruthy();
    expect(screen.getByText(/CRANE/)).toBeTruthy();
    expect(dailyWordApi.getAnswer).not.toHaveBeenCalled();
    const [, summary] = mockCompleteGame.mock.calls[0] as unknown[];
    expect(summary).toMatchObject({ outcome: "loss" });
  });

  it("refuses a word that is not in the bundled list, spending no guess", async () => {
    await seedFetchedAhead(0);
    await mount();
    await screen.findByTestId("tile-0-0");
    await guess("zzzzz");
    expect(await screen.findByText("Not in word list")).toBeTruthy();
    expect(mockStartGame).not.toHaveBeenCalled();
    expect(screen.getByTestId("tile-0-0")).toHaveTextContent("Z");
  });
});

describe("boards per puzzle (#3230)", () => {
  it("resumes today's offline board after a remount", async () => {
    await seedFetchedAhead(0);
    const first = await mount();
    await screen.findByTestId("tile-0-0");
    await guess("slate");
    await act(async () => first.unmount());

    await mount();
    await screen.findByTestId("tile-0-0");
    expect(screen.getByTestId("tile-0-0")).toHaveTextContent("S");
  });

  it("migrates the pre-#3230 board and prunes another day's", async () => {
    await seedFetchedAhead(1);
    const yesterday = initialState(puzzleId(-1), 5, "en");
    await saveState(yesterday);
    const today = { ...initialState(puzzleId(0), 5, "en") };
    today.rows[0] = {
      tiles: "slate".split("").map((letter) => ({ letter, status: "absent" as const })),
      submitted: true,
    };
    today.current_row = 1;
    await AsyncStorage.setItem("daily_word_state_v1", JSON.stringify(today));

    await mount();
    await screen.findByTestId("tile-0-0");
    expect(screen.getByTestId("tile-0-0")).toHaveTextContent("S");
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(`daily_word_board_${puzzleId(-1)}`)).toBeNull()
    );
    expect(await AsyncStorage.getItem("daily_word_state_v1")).toBeNull();
  });
});

describe("past the offline window", () => {
  it("day 4 shows the shared reconnect message", async () => {
    await seedFetchedAhead(3);
    await mount();
    expect(
      await screen.findByText(
        "It's been 3 days since you connected. Connect to the internet to get the latest puzzle."
      )
    ).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
    expect(screen.queryByTestId("tile-0-0")).toBeNull();
  });

  it("adds the streak line when the player has a streak", async () => {
    await seedFetchedAhead(3);
    await AsyncStorage.setItem(LAST_KNOWN_STREAK_KEY, "4");
    await mount();
    expect(
      await screen.findByText(
        "It's been 3 days since you connected. Connect to the internet to get the latest puzzle. Connect to keep your streak going."
      )
    ).toBeTruthy();
  });

  it("Retry once back online loads today's puzzle as before", async () => {
    await seedFetchedAhead(3);
    await mount();
    const retry = await screen.findByText("Retry");
    dailyWordApi.getToday.mockResolvedValue({ puzzle_id: puzzleId(0), word_length: 5 });
    await act(async () => {
      await fireEvent.press(retry);
    });
    await screen.findByTestId("tile-0-0");
    dailyWordApi.submitGuess.mockResolvedValue({
      tiles: "slate".split("").map((letter) => ({ letter, status: "absent" })),
    });
    await guess("slate");
    expect(dailyWordApi.submitGuess).toHaveBeenCalledWith(puzzleId(0), "slate", expect.any(Number));
  });

  it("with nothing ever fetched ahead, keeps the needs-a-connection message", async () => {
    await mount();
    expect(await screen.findByText("Daily Word needs a connection")).toBeTruthy();
  });
});

describe("online", () => {
  it("scores on the server, and on the device only once the connection drops", async () => {
    await seedFetchedAhead(0);
    dailyWordApi.getToday.mockResolvedValue({ puzzle_id: puzzleId(0), word_length: 5 });
    dailyWordApi.submitGuess.mockResolvedValueOnce({
      tiles: "slate".split("").map((letter) => ({ letter, status: "absent" })),
      guesses_used: 1,
    });
    await mount();
    await screen.findByTestId("tile-0-0");
    await guess("slate");
    expect(dailyWordApi.submitGuess).toHaveBeenCalledTimes(1);

    // The next request fails for want of a connection: scored on the device.
    dailyWordApi.submitGuess.mockRejectedValueOnce(OFFLINE());
    await guess("crane");
    await finishFlip();
    expect(dailyWordApi.submitGuess).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("You Win!")).toBeTruthy();
    const [, , payload] = mockCompleteGame.mock.calls[0] as unknown[];
    expect(payload).toMatchObject({ won: true, guesses_used: 2 });
  });
});

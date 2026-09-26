/**
 * DailyWordScreen.test.tsx — unit tests for #1193.
 *
 * Covers:
 *   - stale saved state discarded on mount (puzzle_id mismatch)
 *   - win modal renders after loading a won state
 *   - loss modal shows the answer
 *   - formatCountdown produces HH:MM:SS
 */

import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Share } from "react-native";
import { CodedError } from "expo-modules-core";
import { ThemeProvider } from "../../theme/ThemeContext";
import DailyWordScreen from "../DailyWordScreen";
import { ApiError } from "../../game/_shared/httpClient";
import type { DailyWordState } from "../../game/daily_word/types";
import type { ForegroundClockMock } from "../../game/_shared/__mocks__/foregroundClock";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPopToTop = jest.fn();
const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ popToTop: mockPopToTop, navigate: mockNavigate }),
  useRoute: () => ({ name: "DailyWord" }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("../../game/_shared/NetworkContext", () => ({
  useNetwork: () => ({ isOnline: true, isInitialized: true }),
}));

jest.mock("../../game/daily_word/api", () => ({
  dailyWordApi: {
    getToday: jest.fn(),
    submitGuess: jest.fn(),
    getAnswer: jest.fn(),
  },
}));

jest.mock("../../game/daily_word/storage", () => ({
  loadState: jest.fn(),
  saveState: jest.fn(),
  clearState: jest.fn(),
  saveTodayMeta: jest.fn().mockResolvedValue(undefined),
  loadTodayMeta: jest.fn().mockResolvedValue(null),
}));

// Mock gameEventClient so we can assert the start/complete calls the
// useGameSync wiring makes (#2451) without initialising the real client.
const mockStartGame = jest.fn();
const mockCompleteGame = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    startGame: (...args: unknown[]) => mockStartGame(...args),
    enqueueEvent: jest.fn(),
    completeGame: (...args: unknown[]) => mockCompleteGame(...args),
    init: jest.fn().mockResolvedValue(undefined),
    reportBug: jest.fn(),
    getQueueStats: jest.fn(),
    clearAll: jest.fn().mockResolvedValue(undefined),
  },
}));

// The app-wide foreground-time counter behind useGameSync's active-play window
// (#2684) is pinned for every test by jest.setup.ts (#2710), held still unless
// a test moves it — so summaries stay exact.
const clock = jest.requireMock<ForegroundClockMock>("../../game/_shared/foregroundClock");

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "Light", Heavy: "Heavy" },
  NotificationFeedbackType: { Success: "Success", Warning: "Warning", Error: "Error" },
}));

// ---------------------------------------------------------------------------
// Typed mock accessors
// ---------------------------------------------------------------------------

const { dailyWordApi } = jest.requireMock("../../game/daily_word/api") as {
  dailyWordApi: {
    getToday: jest.Mock;
    submitGuess: jest.Mock;
    getAnswer: jest.Mock;
  };
};

const storage = jest.requireMock("../../game/daily_word/storage") as {
  loadState: jest.Mock;
  saveState: jest.Mock;
  clearState: jest.Mock;
  saveTodayMeta: jest.Mock;
  loadTodayMeta: jest.Mock;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TODAY_META = { puzzle_id: "2026-05-03:en", word_length: 5 };

const EMPTY_ROW = {
  tiles: Array.from({ length: 5 }, () => ({ letter: "", status: "empty" as const })),
  submitted: false,
};

const WIN_STATE: DailyWordState = {
  _v: 1,
  puzzle_id: "2026-05-03:en",
  word_length: 5,
  language: "en",
  rows: [
    {
      tiles: [
        { letter: "c", status: "correct" },
        { letter: "r", status: "correct" },
        { letter: "a", status: "correct" },
        { letter: "n", status: "correct" },
        { letter: "e", status: "correct" },
      ],
      submitted: true,
    },
    ...Array.from({ length: 5 }, () => EMPTY_ROW),
  ],
  current_row: 1,
  keyboard_state: { c: "correct", r: "correct", a: "correct", n: "correct", e: "correct" },
  is_complete: true,
  won: true,
  completed_at: "2026-05-03T12:00:00Z",
};

const LOSS_STATE: DailyWordState = {
  _v: 1,
  puzzle_id: "2026-05-03:en",
  word_length: 5,
  language: "en",
  rows: Array.from({ length: 6 }, () => ({
    tiles: Array.from({ length: 5 }, () => ({ letter: "z", status: "absent" as const })),
    submitted: true,
  })),
  current_row: 6,
  keyboard_state: { z: "absent" },
  is_complete: true,
  won: false,
  completed_at: "2026-05-03T12:00:00Z",
};

const STALE_STATE: DailyWordState = {
  ...WIN_STATE,
  puzzle_id: "2026-05-02:en",
  is_complete: false,
  won: false,
  completed_at: null,
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function renderScreen() {
  return await render(
    <ThemeProvider>
      <DailyWordScreen />
    </ThemeProvider>
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  dailyWordApi.getToday.mockResolvedValue(TODAY_META);
  dailyWordApi.getAnswer.mockResolvedValue({ answer: "crane" });
  storage.loadState.mockResolvedValue(null);
  storage.saveState.mockResolvedValue(undefined);
  storage.clearState.mockResolvedValue(undefined);
  storage.saveTodayMeta.mockResolvedValue(undefined);
  storage.loadTodayMeta.mockResolvedValue(null); // cold cache by default
  mockStartGame.mockReturnValue("game-1");
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DailyWordScreen — loading", () => {
  it("renders a fresh grid after loading with no saved state", async () => {
    const { findByTestId } = await renderScreen();
    await expect(findByTestId("tile-0-0")).resolves.toBeTruthy();
  });
});

describe("DailyWordScreen — stale state", () => {
  it("discards saved state when puzzle_id does not match today's", async () => {
    storage.loadState.mockResolvedValue(STALE_STATE);

    const { findByTestId } = await renderScreen();
    // Wait for load to complete (grid renders)
    await findByTestId("tile-0-0");

    expect(storage.clearState).toHaveBeenCalledTimes(1);
  });

  it("preserves saved state when puzzle_id matches today's", async () => {
    storage.loadState.mockResolvedValue(WIN_STATE);

    const { findByText } = await renderScreen();
    // Wait for load to complete (win modal renders)
    await findByText("You Win!");

    expect(storage.clearState).not.toHaveBeenCalled();
  });
});

describe("DailyWordScreen — win modal", () => {
  it("shows win modal when state is already won on mount", async () => {
    storage.loadState.mockResolvedValue(WIN_STATE);

    const { findByText } = await renderScreen();
    await expect(findByText("You Win!")).resolves.toBeTruthy();
  });
});

describe("DailyWordScreen — loss modal", () => {
  it("shows loss modal when state is already lost on mount", async () => {
    storage.loadState.mockResolvedValue(LOSS_STATE);

    const { findByText } = await renderScreen();
    await expect(findByText("You Lose")).resolves.toBeTruthy();
  });

  it("shows the answer in loss modal after answer fetch resolves", async () => {
    storage.loadState.mockResolvedValue(LOSS_STATE);

    const { findByText } = await renderScreen();
    await expect(findByText(/The word was CRANE/i)).resolves.toBeTruthy();
  });

  it("fetches the answer on loss modal open", async () => {
    storage.loadState.mockResolvedValue(LOSS_STATE);

    const { findByText } = await renderScreen();
    // Wait for modal to appear
    await findByText("You Lose");

    expect(dailyWordApi.getAnswer).toHaveBeenCalledWith(LOSS_STATE.puzzle_id);
  });
});

describe("DailyWordScreen — error state", () => {
  it("shows load error message when getToday rejects", async () => {
    dailyWordApi.getToday.mockRejectedValue(new Error("network"));

    const { findByText } = await renderScreen();
    await expect(findByText("Could not load today's puzzle")).resolves.toBeTruthy();
  });
});

describe("DailyWordScreen — TypeError auto-retry (#1861)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("auto-retries a transient TypeError and loads the puzzle without showing an error", async () => {
    jest.useFakeTimers();
    dailyWordApi.getToday
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(TODAY_META);

    const { findByTestId, queryByText } = await renderScreen();

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await findByTestId("tile-0-0");
    expect(queryByText("Could not load today's puzzle")).toBeNull();
    expect(dailyWordApi.getToday).toHaveBeenCalledTimes(2);
  });

  it("shows load error only after all retries are exhausted", async () => {
    jest.useFakeTimers();
    dailyWordApi.getToday.mockRejectedValue(new TypeError("Network request failed"));

    const { findByText } = await renderScreen();

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await findByText("Could not load today's puzzle");
    // 1 initial + 3 retries = 4 total calls
    expect(dailyWordApi.getToday).toHaveBeenCalledTimes(4);
  });
});

describe("DailyWordScreen — offline today-meta cache (#1886)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("serves cached meta when API fails and cache is warm", async () => {
    jest.useFakeTimers();
    dailyWordApi.getToday.mockRejectedValue(new TypeError("Network request failed"));
    storage.loadTodayMeta.mockResolvedValue(TODAY_META);

    const { findByTestId, queryByText } = await renderScreen();

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await findByTestId("tile-0-0");
    expect(queryByText("Could not load today's puzzle")).toBeNull();
  });

  it("serves cached meta when the offline failure is an Android CodedError (#2403)", async () => {
    jest.useFakeTimers();
    dailyWordApi.getToday.mockRejectedValue(
      new CodedError("ERR_NETWORK", "Unable to resolve host")
    );
    storage.loadTodayMeta.mockResolvedValue(TODAY_META);

    const { findByTestId, queryByText } = await renderScreen();

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await findByTestId("tile-0-0");
    expect(queryByText("Could not load today's puzzle")).toBeNull();
    // Retried like any other network failure before falling back to cache.
    expect(dailyWordApi.getToday).toHaveBeenCalledTimes(4);
  });

  it("serves cached meta on Expo's native FetchError shape — what devices really throw (#2428)", async () => {
    jest.useFakeTimers();
    // Plain Error with a "fetch failed: …" message: neither TypeError nor
    // CodedError. Verbatim BC_GAMES-4W message.
    dailyWordApi.getToday.mockRejectedValue(
      new Error(
        'fetch failed: java.net.UnknownHostException: Unable to resolve host "games-api.buffingchi.com": No address associated with hostname'
      )
    );
    storage.loadTodayMeta.mockResolvedValue(TODAY_META);

    const { findByTestId, queryByText } = await renderScreen();

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await findByTestId("tile-0-0");
    expect(queryByText("Could not load today's puzzle")).toBeNull();
    // Retried like any other network failure before falling back to cache.
    expect(dailyWordApi.getToday).toHaveBeenCalledTimes(4);
  });

  it("shows error when API fails and cache is cold", async () => {
    jest.useFakeTimers();
    dailyWordApi.getToday.mockRejectedValue(new TypeError("Network request failed"));
    storage.loadTodayMeta.mockResolvedValue(null);

    const { findByText } = await renderScreen();

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await findByText("Could not load today's puzzle");
  });

  it("writes the cache on a successful fetch", async () => {
    const { findByTestId } = await renderScreen();
    await findByTestId("tile-0-0");
    expect(storage.saveTodayMeta).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}_en$/),
      TODAY_META
    );
  });

  it("does not write the cache when the fetch fails", async () => {
    jest.useFakeTimers();
    dailyWordApi.getToday.mockRejectedValue(new TypeError("Network request failed"));

    await renderScreen();
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    expect(storage.saveTodayMeta).not.toHaveBeenCalled();
  });

  it("does not serve cache on non-network errors", async () => {
    dailyWordApi.getToday.mockRejectedValue(new Error("ApiError: 401 Unauthorized"));
    storage.loadTodayMeta.mockResolvedValue(TODAY_META);

    const { findByText } = await renderScreen();

    await findByText("Could not load today's puzzle");
    expect(storage.loadTodayMeta).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Per-session game reporting (#2451)
// ---------------------------------------------------------------------------

describe("DailyWordScreen — session game reporting (#2451)", () => {
  const tilesFor = (word: string, status: "correct" | "absent") =>
    word.split("").map((letter) => ({ letter, status }));

  async function typeAndSubmit(api: Awaited<ReturnType<typeof renderScreen>>, word: string) {
    for (const ch of word) {
      await act(async () => {
        await fireEvent.press(api.getByTestId(`daily-word-key-${ch}`));
      });
    }
    await act(async () => {
      await fireEvent.press(api.getByTestId("daily-word-key-enter"));
    });
  }

  /** Submit again, stepping past onSubmit's 500 ms Date.now()-based debounce. */
  async function typeAndSubmitAgain(api: Awaited<ReturnType<typeof renderScreen>>, word: string) {
    const spy = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
    try {
      await typeAndSubmit(api, word);
    } finally {
      spy.mockRestore();
    }
  }

  it("does not start a session on load", async () => {
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    expect(mockStartGame).not.toHaveBeenCalled();
  });

  it("does not start a session when opening an already-finished puzzle", async () => {
    storage.loadState.mockResolvedValue(WIN_STATE);
    const api = await renderScreen();
    await api.findByText("You Win!");
    await act(async () => {
      api.unmount();
    });
    expect(mockStartGame).not.toHaveBeenCalled();
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("starts with puzzle metadata on the first accepted guess and does not complete it", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({ tiles: tilesFor("zzzzz", "absent") });
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    await typeAndSubmit(api, "zzzzz");

    expect(mockStartGame).toHaveBeenCalledTimes(1);
    const [gameType, metadata] = mockStartGame.mock.calls[0]!;
    expect(gameType).toBe("daily_word");
    expect(metadata).toEqual({ puzzle_id: TODAY_META.puzzle_id, language: "en" });
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  // #2197 review — the server treats a repeat of a recorded guess as a replay
  // (so a re-send after a lost response cannot rob a turn). A *deliberate*
  // repeat would therefore advance the board without spending a server-side
  // guess, leaving six rows against five recorded guesses and denying the
  // player the answer they earned.
  it("refuses a word already on the board instead of submitting it again", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({ tiles: tilesFor("zzzzz", "absent") });
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    await typeAndSubmit(api, "zzzzz");
    expect(dailyWordApi.submitGuess).toHaveBeenCalledTimes(1);

    // Step past onSubmit's 500 ms double-tap debounce, which is keyed on
    // Date.now() — otherwise the second submit is dropped before it reaches the
    // duplicate check and this would pass for the wrong reason.
    await typeAndSubmitAgain(api, "zzzzz");
    expect(dailyWordApi.submitGuess).toHaveBeenCalledTimes(1);
    expect(await api.findByText("Already guessed")).toBeTruthy();
  });

  // #2197 review — a guess the server recorded whose response never arrived
  // leaves the board one row behind. Without this the player is stranded on a
  // board that can never complete, behind a generic toast.
  it("closes the game out and reveals the answer when the server says guesses are spent", async () => {
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError("no_guesses_remaining", 403));
    dailyWordApi.getAnswer.mockResolvedValue({ answer: "crane" });
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    await typeAndSubmit(api, "zzzzz");

    expect(dailyWordApi.getAnswer).toHaveBeenCalledWith(TODAY_META.puzzle_id);
    await expect(api.findByText(/The word was CRANE/i)).resolves.toBeTruthy();
  });

  // #2535 review — `already_solved` means the server recorded a winning guess
  // and only the response was lost. Treating it as a loss persisted won:false
  // and showed the player the word they had already found.
  it("treats already_solved as the win it is, not a loss", async () => {
    // One real guess first, so this is the genuine lost-response case rather
    // than the wiped-board case covered above.
    dailyWordApi.submitGuess.mockResolvedValueOnce({ tiles: tilesFor("zzzzz", "absent") });
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError("already_solved", 403));
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    await typeAndSubmit(api, "zzzzz");
    await typeAndSubmitAgain(api, "brick");

    expect(await api.findByText("You Win!")).toBeTruthy();
    expect(dailyWordApi.getAnswer).not.toHaveBeenCalled();
    const [, summary] = mockCompleteGame.mock.calls[0]!;
    // #2517: a finished puzzle records a win or a loss, not just "completed".
    expect(summary).toMatchObject({ outcome: "win", result: { won: true } });
  });

  // #2541 — the 403 means the board is behind the server, so the board's row
  // count is too low. Here the winning (third) guess landed but its response
  // was lost: the board shows one row, and the server says three. Reporting
  // the board's count credited the "win within N guesses" goal for a longer
  // win, and printed the short count on the result card and in the share.
  it("reports the server's guess count from the 403, not the board's", async () => {
    dailyWordApi.submitGuess.mockResolvedValueOnce({ tiles: tilesFor("zzzzz", "absent") });
    dailyWordApi.submitGuess.mockRejectedValue(
      new ApiError("already_solved", 403, {
        detail: "already_solved",
        guesses_used: 3,
        solved: true,
      })
    );
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    await typeAndSubmit(api, "zzzzz");
    await typeAndSubmitAgain(api, "brick");

    expect(await api.findByText("You Win!")).toBeTruthy();
    expect(api.getByText("3/6")).toBeTruthy();
    const [, summary] = mockCompleteGame.mock.calls[0]!;
    expect(summary).toMatchObject({ result: { won: true, guesses_used: 3 } });
  });

  // #2541 review — a 200 can be a replay of a recorded guess, and it carries
  // no `solved` flag. Here the server has six guesses on record (the puzzle
  // may well be solved) and the replayed guess is not a winner: ending the
  // game on `guesses_remaining: 0` would record a loss for a win, or a fresh
  // completion on a wiped board. The game must stay open; the next guess gets
  // the 403 whose recovery path handles both cases.
  it("does not end the game on a 200's guesses_remaining alone", async () => {
    dailyWordApi.submitGuess.mockResolvedValueOnce({
      tiles: tilesFor("zzzzz", "absent"),
      guesses_used: 6,
      guesses_remaining: 0,
    });
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    await typeAndSubmit(api, "zzzzz");

    await waitFor(() => expect(dailyWordApi.submitGuess).toHaveBeenCalledTimes(1));
    expect(mockCompleteGame).not.toHaveBeenCalled();
    expect(api.queryByText("You Lose")).toBeNull();
  });

  // #2535 review — without syncComplete the session stays open and the unmount
  // cleanup reports it abandoned. Abandoned games earn no daily-challenge
  // credit, no streak day and no XP (#2468/#2472), so recovering this way
  // would have silently cost the player their day.
  it("completes the session so the recovery is not recorded as an abandon", async () => {
    dailyWordApi.submitGuess.mockResolvedValueOnce({ tiles: tilesFor("zzzzz", "absent") });
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError("no_guesses_remaining", 403));
    dailyWordApi.getAnswer.mockResolvedValue({ answer: "crane" });
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    await typeAndSubmit(api, "zzzzz");
    await typeAndSubmitAgain(api, "brick");

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [, summary] = mockCompleteGame.mock.calls[0]!;
    expect(summary).toMatchObject({ outcome: "loss", result: { won: false } });
  });

  // #2535 third review — `already_solved` is returned for any guess on a puzzle
  // this session finished at any earlier time, and the board lives under a
  // different AsyncStorage key than the session id, so it can be wiped on its
  // own. Typing one word into a blank board must not fabricate a completed
  // game (free XP) or a win with guesses_used taken from an empty board (free
  // "win in N guesses" credit).
  it("does not report a session when the board shows nothing was played", async () => {
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError("already_solved", 403));
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    await typeAndSubmit(api, "zzzzz");

    expect(mockStartGame).not.toHaveBeenCalled();
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("still closes the game out when the answer cannot be fetched", async () => {
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError("no_guesses_remaining", 403));
    dailyWordApi.getAnswer.mockRejectedValue(new ApiError("guesses_remaining", 403));
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    await typeAndSubmit(api, "zzzzz");

    // No crash, and the generic "could not submit" path is not what ran.
    expect(dailyWordApi.getAnswer).toHaveBeenCalled();
  });

  it("does not start a session when the guess is rejected by the server", async () => {
    dailyWordApi.submitGuess.mockRejectedValue(new Error("not_a_word"));
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    await typeAndSubmit(api, "zzzzz");
    expect(dailyWordApi.submitGuess).toHaveBeenCalledTimes(1);
    expect(mockStartGame).not.toHaveBeenCalled();
  });

  it("completes with a null score and the win result block on a winning guess", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({ tiles: tilesFor("crane", "correct") });
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    await typeAndSubmit(api, "crane");

    expect(mockStartGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [gameId, summary] = mockCompleteGame.mock.calls[0]!;
    expect(gameId).toBe("game-1");
    expect(summary).toEqual({
      finalScore: null,
      outcome: "win",
      result: { is_complete: true, won: true, guesses_used: 1 },
    });
  });

  // #2684 — Daily Word has no timer of its own: useGameSync's active-play
  // window supplies the duration, and it counts the time spent thinking before
  // the first guess, so a first-guess win still records one.
  it("completes with the foreground time on the screen, thinking time included", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({ tiles: tilesFor("crane", "correct") });
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    clock.advanceForegroundNow(45_000); // reading the board before the first guess
    await typeAndSubmit(api, "crane");

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [, summary] = mockCompleteGame.mock.calls[0]!;
    expect(summary).toMatchObject({ outcome: "win", durationMs: 45_000 });
  });

  it("abandons on unmount with the guesses made so far", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({ tiles: tilesFor("zzzzz", "absent") });
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    await typeAndSubmit(api, "zzzzz");
    expect(mockCompleteGame).not.toHaveBeenCalled();

    await act(async () => {
      api.unmount();
    });

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [gameId, summary] = mockCompleteGame.mock.calls[0]!;
    expect(gameId).toBe("game-1");
    expect(summary).toEqual({
      outcome: "abandoned",
      result: { is_complete: false, won: false, guesses_used: 1 },
    });
  });

  it("does not open a session for a guess that resolves after the player left", async () => {
    let resolveGuess: (v: unknown) => void = () => {};
    dailyWordApi.submitGuess.mockReturnValue(
      new Promise((resolve) => {
        resolveGuess = resolve;
      })
    );
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    await typeAndSubmit(api, "zzzzz");
    expect(dailyWordApi.submitGuess).toHaveBeenCalledTimes(1);

    await act(async () => {
      api.unmount();
    });
    await act(async () => {
      resolveGuess({ tiles: tilesFor("zzzzz", "absent") });
    });

    expect(mockStartGame).not.toHaveBeenCalled();
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("does not report an abandon when the player never made a guess", async () => {
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    await act(async () => {
      api.unmount();
    });
    expect(mockStartGame).not.toHaveBeenCalled();
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("closes the old puzzle's session when the day rolls over mid-puzzle", async () => {
    // onSubmit debounces guesses within 500 ms of each other, so drive the clock.
    let clock = 1_000_000;
    const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const api = await renderScreen();
      await api.findByTestId("tile-0-0");

      dailyWordApi.submitGuess.mockResolvedValueOnce({ tiles: tilesFor("zzzzz", "absent") });
      await typeAndSubmit(api, "zzzzz");
      expect(mockStartGame).toHaveBeenCalledTimes(1);

      // Midnight passes: the server rejects the guess as stale and the screen
      // resets to the new puzzle.
      clock += 1000;
      dailyWordApi.submitGuess.mockRejectedValueOnce(new ApiError("stale_puzzle_id", 422));
      dailyWordApi.getToday.mockResolvedValue({ puzzle_id: "2026-05-04:en", word_length: 5 });
      await typeAndSubmit(api, "yyyyy");

      expect(mockCompleteGame).toHaveBeenCalledTimes(1);
      const [oldGameId, summary] = mockCompleteGame.mock.calls[0]!;
      expect(oldGameId).toBe("game-1");
      expect(summary).toEqual({
        outcome: "abandoned",
        result: { is_complete: false, won: false, guesses_used: 1 },
      });

      // The next guess belongs to the new puzzle, in a new session.
      clock += 1000;
      mockStartGame.mockReturnValue("game-2");
      dailyWordApi.submitGuess.mockResolvedValueOnce({ tiles: tilesFor("zzzzz", "absent") });
      await typeAndSubmit(api, "zzzzz");

      expect(mockStartGame).toHaveBeenCalledTimes(2);
      expect(mockStartGame.mock.calls[1]![1]).toEqual({
        puzzle_id: "2026-05-04:en",
        language: "en",
      });
    } finally {
      nowSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// #2514 — shared result card
// ---------------------------------------------------------------------------

describe("DailyWordScreen — result card (#2514)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows guesses, a disabled next-word countdown, Share and Home", async () => {
    storage.loadState.mockResolvedValue(WIN_STATE);
    const r = await renderScreen();
    await r.findByText("You Win!");

    const primary = r.getByTestId("game-result-primary");
    expect(primary.props.accessibilityState.disabled).toBe(true);
    expect(primary).toHaveTextContent(/Next word in \d{2}:\d{2}:\d{2}/);
    expect(r.getByRole("button", { name: "Share" })).toBeTruthy();
    expect(r.getByRole("button", { name: "Home" })).toBeTruthy();
    // No close button: the card isn't dismissible.
    expect(r.queryByRole("button", { name: "Close" })).toBeNull();
  });

  /** Loads a won game and jumps the clock past midnight so Play Again shows. */
  async function reachPlayAgain() {
    storage.loadState.mockResolvedValue(WIN_STATE);
    const r = await renderScreen();
    await r.findByText("You Win!");
    storage.clearState.mockClear();
    const realNow = Date.now.bind(Date);
    jest.spyOn(Date, "now").mockImplementation(() => realNow() + 25 * 60 * 60 * 1000);
    await waitFor(() => expect(r.getByRole("button", { name: "Play Again" })).toBeTruthy(), {
      timeout: 3000,
    });
    return r;
  }

  it("turns the countdown into Play Again once the next word is out, which loads it", async () => {
    const r = await reachPlayAgain();
    dailyWordApi.getToday.mockResolvedValue({ puzzle_id: "2026-05-04:en", word_length: 5 });

    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Play Again" }));
    });

    expect(storage.clearState).toHaveBeenCalled();
    await waitFor(() => expect(r.queryByText("You Win!")).toBeNull());
  });

  it("keeps the finished game when the server still serves the same puzzle (#2553 review)", async () => {
    const r = await reachPlayAgain();
    // Device clock ahead of the server: today is still the solved puzzle.
    dailyWordApi.getToday.mockResolvedValue(TODAY_META);

    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Play Again" }));
    });

    expect(storage.clearState).not.toHaveBeenCalled();
    expect(r.getByText("You Win!")).toBeTruthy();
    // Back to a short countdown before retrying.
    expect(r.getByTestId("game-result-primary").props.accessibilityState.disabled).toBe(true);
    expect(r.getByTestId("game-result-primary")).toHaveTextContent(/Next word in/);
  });

  it("keeps the finished game and says so when loading the next puzzle fails (#2553 review)", async () => {
    const r = await reachPlayAgain();
    dailyWordApi.getToday.mockRejectedValue(new Error("offline"));

    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Play Again" }));
    });

    expect(storage.clearState).not.toHaveBeenCalled();
    expect(r.getByText("You Win!")).toBeTruthy();
    expect(r.getByText("Could not load today's puzzle")).toBeTruthy();
    // Still enabled, so tapping retries.
    expect(r.getByRole("button", { name: "Play Again" })).toBeTruthy();
  });

  it("shares through the system share sheet on native", async () => {
    storage.loadState.mockResolvedValue(WIN_STATE);
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" });
    const r = await renderScreen();
    await r.findByText("You Win!");

    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Share" }));
    });

    expect(share).toHaveBeenCalledWith({ message: expect.stringContaining("Daily Word #") });
    // Nothing was copied, so the button doesn't claim it was.
    expect(r.queryByText("Copied!")).toBeNull();
  });
});

describe("DailyWordScreen — ⋯ menu (#2635)", () => {
  it("has a Stats item that opens Daily Word's stats", async () => {
    const { findByTestId, getByLabelText, getByText } = await renderScreen();
    await findByTestId("tile-0-0");
    await act(async () => {
      await fireEvent.press(getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(getByText("Stats"));
    });
    expect(mockNavigate).toHaveBeenCalledWith("GameStats", { gameType: "daily_word" });
  });
});

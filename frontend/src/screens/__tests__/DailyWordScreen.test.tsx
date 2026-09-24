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
import { act, fireEvent, render } from "@testing-library/react-native";
import { CodedError } from "expo-modules-core";
import { ThemeProvider } from "../../theme/ThemeContext";
import DailyWordScreen from "../DailyWordScreen";
import { ApiError } from "../../game/_shared/httpClient";
import type { DailyWordState } from "../../game/daily_word/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPopToTop = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ popToTop: mockPopToTop }),
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

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "Light", Heavy: "Heavy" },
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
    await findByText("Brilliant!");

    expect(storage.clearState).not.toHaveBeenCalled();
  });
});

describe("DailyWordScreen — win modal", () => {
  it("shows win modal when state is already won on mount", async () => {
    storage.loadState.mockResolvedValue(WIN_STATE);

    const { findByText } = await renderScreen();
    await expect(findByText("Brilliant!")).resolves.toBeTruthy();
  });
});

describe("DailyWordScreen — loss modal", () => {
  it("shows loss modal when state is already lost on mount", async () => {
    storage.loadState.mockResolvedValue(LOSS_STATE);

    const { findByText } = await renderScreen();
    await expect(findByText("Better luck tomorrow")).resolves.toBeTruthy();
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
    await findByText("Better luck tomorrow");

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
        'fetch failed: java.net.UnknownHostException: Unable to resolve host "gaming-app-api-dev.onrender.com": No address associated with hostname'
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

  it("does not start a session on load", async () => {
    const api = await renderScreen();
    await api.findByTestId("tile-0-0");
    expect(mockStartGame).not.toHaveBeenCalled();
  });

  it("does not start a session when opening an already-finished puzzle", async () => {
    storage.loadState.mockResolvedValue(WIN_STATE);
    const api = await renderScreen();
    await api.findByText("Brilliant!");
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
    const realNow = Date.now();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(realNow + 5000);
    try {
      await typeAndSubmit(api, "zzzzz");
      expect(dailyWordApi.submitGuess).toHaveBeenCalledTimes(1);
      expect(await api.findByText("Already guessed")).toBeTruthy();
    } finally {
      nowSpy.mockRestore();
    }
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

  it("still closes the game out when the answer cannot be fetched", async () => {
    dailyWordApi.submitGuess.mockRejectedValue(new ApiError("already_solved", 403));
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
      outcome: "completed",
      result: { is_complete: true, won: true, guesses_used: 1 },
    });
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

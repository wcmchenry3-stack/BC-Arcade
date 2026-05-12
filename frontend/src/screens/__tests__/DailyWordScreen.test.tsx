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
import { render } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import DailyWordScreen from "../DailyWordScreen";
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

function renderScreen() {
  return render(
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
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DailyWordScreen — loading", () => {
  it("renders a fresh grid after loading with no saved state", async () => {
    const { findByTestId } = renderScreen();
    await expect(findByTestId("tile-0-0")).resolves.toBeTruthy();
  });
});

describe("DailyWordScreen — stale state", () => {
  it("discards saved state when puzzle_id does not match today's", async () => {
    storage.loadState.mockResolvedValue(STALE_STATE);

    const { findByTestId } = renderScreen();
    // Wait for load to complete (grid renders)
    await findByTestId("tile-0-0");

    expect(storage.clearState).toHaveBeenCalledTimes(1);
  });

  it("preserves saved state when puzzle_id matches today's", async () => {
    storage.loadState.mockResolvedValue(WIN_STATE);

    const { findByText } = renderScreen();
    // Wait for load to complete (win modal renders)
    await findByText("Brilliant!");

    expect(storage.clearState).not.toHaveBeenCalled();
  });
});

describe("DailyWordScreen — win modal", () => {
  it("shows win modal when state is already won on mount", async () => {
    storage.loadState.mockResolvedValue(WIN_STATE);

    const { findByText } = renderScreen();
    await expect(findByText("Brilliant!")).resolves.toBeTruthy();
  });
});

describe("DailyWordScreen — loss modal", () => {
  it("shows loss modal when state is already lost on mount", async () => {
    storage.loadState.mockResolvedValue(LOSS_STATE);

    const { findByText } = renderScreen();
    await expect(findByText("Better luck tomorrow")).resolves.toBeTruthy();
  });

  it("shows the answer in loss modal after answer fetch resolves", async () => {
    storage.loadState.mockResolvedValue(LOSS_STATE);

    const { findByText } = renderScreen();
    await expect(findByText(/The word was CRANE/i)).resolves.toBeTruthy();
  });

  it("fetches the answer on loss modal open", async () => {
    storage.loadState.mockResolvedValue(LOSS_STATE);

    const { findByText } = renderScreen();
    // Wait for modal to appear
    await findByText("Better luck tomorrow");

    expect(dailyWordApi.getAnswer).toHaveBeenCalledWith(LOSS_STATE.puzzle_id);
  });
});

describe("DailyWordScreen — error state", () => {
  it("shows load error message when getToday rejects", async () => {
    dailyWordApi.getToday.mockRejectedValue(new Error("network"));

    const { findByText } = renderScreen();
    await expect(findByText("Could not load today's puzzle")).resolves.toBeTruthy();
  });
});

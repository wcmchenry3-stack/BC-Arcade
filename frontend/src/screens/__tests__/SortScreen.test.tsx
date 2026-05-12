import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import SortScreen from "../SortScreen";

// ---------------------------------------------------------------------------
// Mocks — factories must be self-contained (jest.mock is hoisted)
// ---------------------------------------------------------------------------

const mockGoBack = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ goBack: mockGoBack }),
}));

jest.mock("../../game/_shared/NetworkContext", () => ({
  useNetwork: () => ({ isOnline: true, isInitialized: true }),
}));

jest.mock("../../game/sort/api", () => ({
  sortApi: {
    getLevels: jest.fn(),
    submitScore: jest.fn(),
    getLeaderboard: jest.fn(),
  },
}));

jest.mock("../../game/sort/storage", () => ({
  loadProgress: jest.fn(),
  saveProgress: jest.fn(),
  clearGame: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Typed accessors for the mocked modules
// ---------------------------------------------------------------------------

const { sortApi } = jest.requireMock("../../game/sort/api") as {
  sortApi: {
    getLevels: jest.Mock;
    submitScore: jest.Mock;
    getLeaderboard: jest.Mock;
  };
};

const storage = jest.requireMock("../../game/sort/storage") as {
  loadProgress: jest.Mock;
  saveProgress: jest.Mock;
};

// ---------------------------------------------------------------------------
// Fixtures — levels must NOT be immediately solved so the play view renders
// normally without the win modal.  isBottleSolved() requires length === 0 OR
// (length === BOTTLE_DEPTH && single color), so mixed or partial fills work.
// ---------------------------------------------------------------------------

const MOCK_LEVELS = [
  // 4 bottles, 2 partially filled with mixed colours — requires actual sorting
  { id: 1, bottles: [["red", "blue"], ["blue", "red"], [], []] },
  { id: 2, bottles: [["green", "yellow"], ["yellow", "green"], [], []] },
  { id: 3, bottles: [["orange", "purple"], ["purple", "orange"], [], []] },
];

const DEFAULT_PROGRESS = { unlockedLevel: 3, currentLevelId: null, currentState: null };

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderScreen() {
  return render(
    <ThemeProvider>
      <SortScreen />
    </ThemeProvider>
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  sortApi.getLevels.mockResolvedValue({ levels: MOCK_LEVELS });
  sortApi.submitScore.mockResolvedValue({ player_name: "Alice", level_reached: 1, rank: 1 });
  sortApi.getLeaderboard.mockResolvedValue({ scores: [] });
  storage.loadProgress.mockResolvedValue(DEFAULT_PROGRESS);
  storage.saveProgress.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SortScreen — loading and level select", () => {
  it("shows the level select screen after levels load", async () => {
    const { findByText } = renderScreen();
    expect(await findByText("Choose a Level")).toBeTruthy();
  });

  it("renders a card for each level after load", async () => {
    const { findByLabelText } = renderScreen();
    expect(await findByLabelText("Level 1")).toBeTruthy();
    expect(await findByLabelText("Level 2")).toBeTruthy();
    expect(await findByLabelText("Level 3")).toBeTruthy();
  });

  it("shows error and retry when API fails", async () => {
    sortApi.getLevels.mockRejectedValue(new Error("network"));
    const { findByText } = renderScreen();
    expect(await findByText("Could not load this level.")).toBeTruthy();
    expect(await findByText("Retry")).toBeTruthy();
  });

  it("retries loading when Retry is pressed", async () => {
    sortApi.getLevels.mockRejectedValueOnce(new Error("network"));
    const { findByText } = renderScreen();
    // Wait for the error to appear, then press Retry
    const retryBtn = await findByText("Retry");
    await act(async () => {
      fireEvent.press(retryBtn);
    });
    expect(sortApi.getLevels).toHaveBeenCalledTimes(2);
  });
});

describe("SortScreen — entering and playing a level", () => {
  // Await the element BEFORE act() — mixing findBy* inside act() breaks polling.
  it("transitions to the play view when a level card is tapped", async () => {
    const { findByLabelText, findByText } = renderScreen();
    const levelCard = await findByLabelText("Level 1");
    await act(async () => {
      fireEvent.press(levelCard);
    });
    expect(await findByText("Level 1")).toBeTruthy(); // HUD text
  });

  it("back button in play view returns to level select", async () => {
    const { findByLabelText, findByText } = renderScreen();
    const levelCard = await findByLabelText("Level 1");
    await act(async () => {
      fireEvent.press(levelCard);
    });
    const backBtn = await findByLabelText("Back to levels");
    await act(async () => {
      fireEvent.press(backBtn);
    });
    expect(await findByText("Choose a Level")).toBeTruthy();
  });

  it("undo button is disabled initially (no history)", async () => {
    const { findByLabelText } = renderScreen();
    const levelCard = await findByLabelText("Level 1");
    await act(async () => {
      fireEvent.press(levelCard);
    });
    const undoBtn = await findByLabelText("Undo");
    expect(undoBtn.props.accessibilityState?.disabled).toBe(true);
  });

  it("selecting a bottle updates its accessibility label", async () => {
    const { findByLabelText } = renderScreen();
    const levelCard = await findByLabelText("Level 1");
    await act(async () => {
      fireEvent.press(levelCard);
    });
    // Bottle 1 has balls — tapping it selects it
    const bottle = await findByLabelText(/^Bottle 1,/);
    await act(async () => {
      fireEvent.press(bottle);
    });
    expect(await findByLabelText(/Bottle 1 selected/)).toBeTruthy();
  });

  it("undo button becomes enabled after a valid pour", async () => {
    const { findByLabelText } = renderScreen();
    const levelCard = await findByLabelText("Level 1");
    await act(async () => {
      fireEvent.press(levelCard);
    });
    // Bottle 1 = ["red","blue"] (top: blue), Bottle 3 = [] (empty) — valid pour
    const bottle1 = await findByLabelText(/^Bottle 1,/);
    await act(async () => {
      fireEvent.press(bottle1);
    });
    const bottle3 = await findByLabelText(/^Bottle 3,/);
    await act(async () => {
      fireEvent.press(bottle3);
    });
    const undoBtn = await findByLabelText("Undo");
    expect(undoBtn.props.accessibilityState?.disabled).toBeFalsy();
  });
});

describe("SortScreen — leaderboard tab", () => {
  it("fetches and displays leaderboard scores", async () => {
    sortApi.getLeaderboard.mockResolvedValue({
      scores: [{ player_name: "Alice", level_reached: 5, rank: 1 }],
    });
    const { findByText } = renderScreen();
    await findByText("Choose a Level");
    const leaderboardTab = await findByText("Leaderboard");
    await act(async () => {
      fireEvent.press(leaderboardTab);
    });
    expect(await findByText("Alice")).toBeTruthy();
    expect(await findByText("Level 5")).toBeTruthy();
  });

  it("shows empty state when leaderboard has no scores", async () => {
    const { findByText } = renderScreen();
    await findByText("Choose a Level");
    const leaderboardTab = await findByText("Leaderboard");
    await act(async () => {
      fireEvent.press(leaderboardTab);
    });
    expect(await findByText("No scores yet.")).toBeTruthy();
  });
});

import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import SortScreen from "../SortScreen";
import SortBoard from "../../game/sort/components/SortBoard";

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

// ---------------------------------------------------------------------------
// Regression: source bottle flash after pour (issue #1567)
//
// The bug: setGhost(null) fired from the Reanimated animation callback while
// setGameState(nextState) was on a separate setTimeout ~50ms later. Between
// those two calls there was a render where the ghost was gone but the stale
// bottle state was still visible — causing a brief flash of the poured color.
//
// The fix: onPourComplete drives the state update from inside SortBoard's
// animation callback so both calls land in the same render. The test below
// guards that contract: calling onPourComplete immediately produces the
// post-pour state without needing any timer to fire.
// ---------------------------------------------------------------------------

describe("SortScreen — pour completion callback (regression #1567)", () => {
  it("updates bottle state immediately when onPourComplete fires — no timer needed", async () => {
    const { findByLabelText, UNSAFE_getByType } = renderScreen();

    const levelCard = await findByLabelText("Level 1");
    await act(async () => {
      fireEvent.press(levelCard);
    });

    // Select bottle 1 (["red","blue"], 2 balls), then pour into bottle 3 (empty).
    // This sets pendingPourRef so onPourComplete can apply the state update.
    const bottle1 = await findByLabelText(/^Bottle 1, 2 of/);
    await act(async () => { fireEvent.press(bottle1); });
    const bottle3 = await findByLabelText("Bottle 3, empty");
    await act(async () => { fireEvent.press(bottle3); });

    // Simulate the moment SortBoard's return animation finishes and fires
    // onPourComplete (in production this is via runOnJS inside the worklet;
    // here we call it directly because Reanimated's jest mock does not invoke
    // animation callbacks).
    const board = UNSAFE_getByType(SortBoard);
    await act(async () => {
      board.props.onPourComplete?.();
    });

    // Bottle 1 should now show 1 ball ("red" remains; "blue" was poured out).
    // If the bug is present (state update only on a setTimeout), this label
    // won't exist yet and the test fails.
    expect(await findByLabelText(/^Bottle 1, 1 of/)).toBeTruthy();
    expect(await findByLabelText(/^Bottle 3, 1 of/)).toBeTruthy();
  });

  it("is a no-op when onPourComplete fires with no pending pour", async () => {
    const { findByLabelText, UNSAFE_getByType } = renderScreen();

    const levelCard = await findByLabelText("Level 1");
    await act(async () => {
      fireEvent.press(levelCard);
    });

    // Call onPourComplete without initiating any pour first.
    const board = UNSAFE_getByType(SortBoard);
    await act(async () => {
      board.props.onPourComplete?.();
    });

    // Original state should be unchanged.
    expect(await findByLabelText(/^Bottle 1, 2 of/)).toBeTruthy();
  });
});

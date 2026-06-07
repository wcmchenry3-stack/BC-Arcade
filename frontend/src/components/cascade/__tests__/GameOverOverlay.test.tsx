/**
 * Tests for GameOverOverlay — covers the submit/error/saved/restart branches
 * that account for the low coverage on this component.
 *
 * Uses @testing-library/react-native for render + interaction.
 */

import React from "react";
import { render, fireEvent, waitFor, screen } from "@testing-library/react-native";
import GameOverOverlay from "../GameOverOverlay";
import { cascadeApi } from "../../../game/cascade/api";
import * as NetworkContext from "../../../game/_shared/NetworkContext";
import { scoreQueue } from "../../../game/_shared/scoreQueue";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock("../../../game/cascade/api", () => ({
  cascadeApi: {
    submitPlayerName: jest.fn(),
  },
}));

jest.mock("../../../game/_shared/NetworkContext", () => ({
  useNetwork: jest.fn(),
}));

jest.mock("../../../game/_shared/scoreQueue", () => ({
  scoreQueue: {
    enqueue: jest.fn(),
  },
}));

const useNetworkMock = NetworkContext.useNetwork as jest.Mock;
const mockEnqueue = scoreQueue.enqueue as jest.Mock;

// ThemeContext reads from AsyncStorage on native; provide a minimal stub
jest.mock("../../../theme/ThemeContext", () => ({
  useTheme: () => ({
    colors: {
      text: "#fff",
      textMuted: "#aaa",
      accent: "#3b82f6",
      surface: "#1e293b",
      border: "#334155",
      error: "#ef4444",
      bonus: "#22c55e",
      modalBg: "#0f172a",
    },
    theme: "dark",
    toggle: jest.fn(),
  }),
}));

const mockSubmitPlayerName = cascadeApi.submitPlayerName as jest.Mock;

const GAME_ID = "test-game-id-abc";

async function renderOverlay(score = 1234, gameId: string | null = GAME_ID, onRestart = jest.fn()) {
  return await render(<GameOverOverlay score={score} gameId={gameId} onRestart={onRestart} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GameOverOverlay", () => {
  beforeEach(() => {
    mockSubmitPlayerName.mockReset();
    mockEnqueue.mockReset();
    mockEnqueue.mockResolvedValue(undefined);
    useNetworkMock.mockReturnValue({ isOnline: true, isInitialized: true });
  });

  it("renders score and Game Over heading", async () => {
    await renderOverlay(5678);
    expect(screen.getByText("Game Over")).toBeTruthy();
    expect(screen.getByText("5,678")).toBeTruthy();
  });

  it("pressing save with no name does not call the API", async () => {
    await renderOverlay();
    await fireEvent.press(screen.getByLabelText("Save score"));
    expect(mockSubmitPlayerName).not.toHaveBeenCalled();
  });

  it("pressing save after entering a name calls the API with gameId and player_name", async () => {
    mockSubmitPlayerName.mockResolvedValueOnce({ player_name: "Alice", score: 1234, rank: 1 });
    await renderOverlay(1234);
    await fireEvent.changeText(screen.getByLabelText("Your name"), "Alice");
    await fireEvent.press(screen.getByLabelText("Save score"));
    await waitFor(() => expect(mockSubmitPlayerName).toHaveBeenCalledWith(GAME_ID, "Alice"));
  });

  it("shows saved confirmation with the leaderboard rank (#2), not the score", async () => {
    // Regression guard for #195: previously the score was displayed where
    // rank belonged ("Saved! #1234" for a score=1234 / rank=2).
    mockSubmitPlayerName.mockResolvedValueOnce({ player_name: "Alice", score: 1234, rank: 2 });
    await renderOverlay(1234);

    await fireEvent.changeText(screen.getByLabelText("Your name"), "Alice");
    await fireEvent.press(screen.getByLabelText("Save score"));

    await waitFor(() => {
      expect(screen.getByText("Saved! #2")).toBeTruthy();
    });
    expect(mockSubmitPlayerName).toHaveBeenCalledWith(GAME_ID, "Alice");
  });

  it("shows error message when submit fails", async () => {
    mockSubmitPlayerName.mockRejectedValueOnce(new Error("Invalid score"));
    await renderOverlay(1234);

    await fireEvent.changeText(screen.getByLabelText("Your name"), "Bob");
    await fireEvent.press(screen.getByLabelText("Save score"));

    await waitFor(() => {
      expect(screen.getByText(/Could not save score/i)).toBeTruthy();
    });
  });

  it("shows error when gameId is null", async () => {
    await renderOverlay(1234, null);
    await fireEvent.changeText(screen.getByLabelText("Your name"), "Alice");
    await fireEvent.press(screen.getByLabelText("Save score"));
    await waitFor(() => {
      expect(screen.getByText(/Could not save score/i)).toBeTruthy();
    });
    expect(mockSubmitPlayerName).not.toHaveBeenCalled();
  });

  it("calls onRestart when Play Again is pressed", async () => {
    const onRestart = jest.fn();
    await renderOverlay(100, GAME_ID, onRestart);
    await fireEvent.press(screen.getByLabelText("Play again"));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("queues score locally when offline; skips API call", async () => {
    useNetworkMock.mockReturnValue({ isOnline: false, isInitialized: true });
    await renderOverlay(4850);

    await fireEvent.changeText(screen.getByLabelText("Your name"), "Alice");
    await fireEvent.press(screen.getByLabelText("Save score"));

    await waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledWith("cascade", {
        game_id: GAME_ID,
        player_name: "Alice",
      });
    });
    expect(mockSubmitPlayerName).not.toHaveBeenCalled();
    expect(screen.getByText(/Offline/i)).toBeTruthy();
  });

  it("queues score when online submit fails with a network error (TypeError)", async () => {
    mockSubmitPlayerName.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await renderOverlay(1234);

    await fireEvent.changeText(screen.getByLabelText("Your name"), "Bob");
    await fireEvent.press(screen.getByLabelText("Save score"));

    await waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledWith("cascade", {
        game_id: GAME_ID,
        player_name: "Bob",
      });
    });
    expect(screen.getByText(/Offline/i)).toBeTruthy();
  });

  it("shows error (no queue) when online submit fails with an app error", async () => {
    mockSubmitPlayerName.mockRejectedValueOnce(new Error("Invalid score"));
    await renderOverlay(1234);

    await fireEvent.changeText(screen.getByLabelText("Your name"), "Bob");
    await fireEvent.press(screen.getByLabelText("Save score"));

    await waitFor(() => {
      expect(screen.getByText(/Could not save score/i)).toBeTruthy();
    });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

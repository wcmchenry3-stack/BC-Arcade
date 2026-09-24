import React from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import GameResultModal, {
  CELEBRATION_MAX_MS,
  type GameOutcome,
  type GameResultModalProps,
} from "../GameResultModal";
import { resetDisplayNameCacheForTests } from "../../../game/_shared/displayName";

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");

async function renderCard(
  props: Partial<GameResultModalProps> = {},
  theme: "dark" | "light" = "dark"
) {
  await AsyncStorage.setItem("gaming_app_theme_mode", theme);
  const onHome = jest.fn();
  const result = await render(
    <ThemeProvider>
      <GameResultModal visible outcome="win" onHome={onHome} {...props} />
    </ThemeProvider>
  );
  await act(async () => {});
  return { ...result, onHome };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
  jest.clearAllMocks();
});

describe("GameResultModal — outcomes", () => {
  const TITLES: Record<GameOutcome, string> = {
    win: "You Win!",
    loss: "You Lose",
    draw: "It's a Tie!",
    ended: "Game Over",
  };

  describe.each(["dark", "light"] as const)("%s theme", (theme) => {
    it.each(Object.keys(TITLES) as GameOutcome[])("renders %s", async (outcome) => {
      const { toJSON } = await renderCard(
        {
          outcome,
          eyebrow: "SUDOKU · HARD",
          subtitle: "Solved in 12:48",
          hero: { kind: "score", label: "Score", value: 4820 },
          stats: [
            { label: "Time", value: "12:48" },
            { label: "Errors", value: 2 },
          ],
          onPlayAgain: jest.fn(),
        },
        theme
      );
      expect(screen.getByRole("header")).toHaveTextContent(TITLES[outcome]);
      expect(toJSON()).toMatchSnapshot();
    });
  });

  it("keeps the outcome stripe when the card border is reset (dark theme)", async () => {
    await renderCard({ outcome: "win" }, "dark");
    const style = StyleSheet.flatten(screen.getByTestId("game-result").props.style);
    expect(style.borderWidth).toBe(0);
    expect(style.borderTopWidth).toBe(5);
  });

  it("names the winner on a loss when given", async () => {
    await renderCard({ outcome: "loss", winnerName: "Computer" });
    expect(screen.getByRole("header")).toHaveTextContent("Computer Wins");
  });

  it("fires the outcome's haptic", async () => {
    await renderCard({ outcome: "win" });
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
  });

  it("still shows the card when haptics are unavailable", async () => {
    (Haptics.notificationAsync as jest.Mock).mockImplementationOnce(() => {
      throw new Error("no haptics");
    });
    await renderCard({ outcome: "win" });
    expect(screen.getByRole("header")).toHaveTextContent("You Win!");
  });

  it("fires a warning haptic on a loss and a light impact on a draw", async () => {
    await renderCard({ outcome: "loss" });
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("warning");
    await renderCard({ outcome: "draw" });
    expect(Haptics.impactAsync).toHaveBeenCalledWith("light");
  });
});

describe("GameResultModal — variations", () => {
  it("renders a versus hero", async () => {
    const { toJSON } = await renderCard({
      outcome: "loss",
      winnerName: "Computer",
      hero: { kind: "versus", you: 241, opponent: 264, opponentLabel: "CPU" },
    });
    expect(screen.getByText("241")).toBeTruthy();
    expect(screen.getByText("264")).toBeTruthy();
    expect(screen.getByText("CPU")).toBeTruthy();
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders a detail slot and the New Best badge", async () => {
    await renderCard({
      isNewBest: true,
      detail: <Text>Standings table</Text>,
    });
    expect(screen.getByText("Standings table")).toBeTruthy();
    expect(screen.getByText("New best")).toBeTruthy();
  });

  it("caps the stats strip at four", async () => {
    await renderCard({
      stats: [1, 2, 3, 4, 5].map((n) => ({ label: `Stat ${n}`, value: n })),
    });
    expect(screen.getByText("Stat 4")).toBeTruthy();
    expect(screen.queryByText("Stat 5")).toBeNull();
  });

  it("renders a disabled countdown primary", async () => {
    const onPress = jest.fn();
    const { toJSON } = await renderCard({
      primaryAction: { label: "Next word in 06:12:40", onPress, disabled: true },
    });
    const primary = screen.getByTestId("game-result-primary");
    expect(primary.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(primary);
    expect(onPress).not.toHaveBeenCalled();
    expect(toJSON()).toMatchSnapshot();
  });

  it("defaults the primary action to Play Again", async () => {
    const onPlayAgain = jest.fn();
    await renderCard({ onPlayAgain });
    await fireEvent.press(screen.getByRole("button", { name: "Play Again" }));
    expect(onPlayAgain).toHaveBeenCalled();
  });

  it("always shows Home, beside an optional second button", async () => {
    const onChange = jest.fn();
    const { onHome } = await renderCard({
      secondaryAction: { label: "Change Difficulty", onPress: onChange },
    });
    await fireEvent.press(screen.getByRole("button", { name: "Change Difficulty" }));
    await fireEvent.press(screen.getByRole("button", { name: "Home" }));
    expect(onChange).toHaveBeenCalled();
    expect(onHome).toHaveBeenCalled();
  });

  it("shows Home even with no other actions", async () => {
    await renderCard();
    expect(screen.getByRole("button", { name: "Home" })).toBeTruthy();
  });
});

describe("GameResultModal — submission line", () => {
  it("shows the saved name and rank", async () => {
    await renderCard({ submission: { status: "saved", rank: 12, playerName: "Riley" } });
    expect(screen.getByText("Saved as Riley · #12 on the leaderboard")).toBeTruthy();
  });

  it("shows the saved name without a rank when unranked", async () => {
    await renderCard({ submission: { status: "saved", rank: null, playerName: "Riley" } });
    expect(screen.getByText("Saved as Riley")).toBeTruthy();
  });

  it("shows no submission line while idle", async () => {
    await renderCard({ submission: { status: "idle" } });
    expect(screen.queryByText("Saving your score…")).toBeNull();
    expect(screen.queryByText(/Saved/)).toBeNull();
  });

  it("shows the saving state while submitting", async () => {
    await renderCard({ submission: { status: "submitting" } });
    expect(screen.getByText("Saving your score…")).toBeTruthy();
  });

  it("shows the offline state", async () => {
    const { toJSON } = await renderCard({ submission: { status: "offline" } });
    expect(screen.getByText("Saved offline · syncs when you're back online")).toBeTruthy();
    expect(toJSON()).toMatchSnapshot();
  });

  it("offers Retry on an error", async () => {
    const onRetry = jest.fn();
    await renderCard({ submission: { status: "error", onRetry } });
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows the one-time name prompt and hands the saved name back", async () => {
    const onProvideName = jest.fn(() => Promise.resolve(true));
    const { toJSON } = await renderCard({ submission: { status: "needsName", onProvideName } });
    expect(screen.getByText("Pick a display name for leaderboards")).toBeTruthy();
    expect(toJSON()).toMatchSnapshot();

    await fireEvent.changeText(
      screen.getByLabelText("Pick a display name for leaderboards"),
      "Riley"
    );
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onProvideName).toHaveBeenCalledWith("Riley"));
  });
});

describe("GameResultModal — behaviour", () => {
  it("sends Android back to Home", async () => {
    const { onHome } = await renderCard();
    // Walk up from the card to the Modal and fire its hardware-back handler.
    let node = screen.getByTestId("game-result").parent;
    while (node && typeof node.props.onRequestClose !== "function") node = node.parent;
    expect(node).toBeTruthy();
    await act(async () => node?.props.onRequestClose());
    expect(onHome).toHaveBeenCalled();
  });

  it("announces the result once when it appears", async () => {
    await renderCard({
      outcome: "win",
      subtitle: "Solved in 12:48",
      hero: { kind: "score", label: "Score", value: 4820 },
    });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("You Win!. Solved in 12:48. Score: 4,820");
  });

  it("renders nothing while not visible", async () => {
    await renderCard({ visible: false });
    expect(screen.queryByRole("header")).toBeNull();
    expect(announce).not.toHaveBeenCalled();
  });

  it("plays the celebration first and shows the card when it finishes", async () => {
    await renderCard({
      celebration: (done) => (
        <Pressable testID="celebration" onPress={done}>
          <Text>Confetti</Text>
        </Pressable>
      ),
    });
    expect(screen.getByText("Confetti")).toBeTruthy();
    expect(screen.queryByRole("header")).toBeNull();

    await fireEvent.press(screen.getByTestId("celebration"));

    expect(screen.queryByText("Confetti")).toBeNull();
    expect(screen.getByRole("header")).toHaveTextContent("You Win!");
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("shows the card anyway if the celebration never finishes", async () => {
    jest.useFakeTimers();
    try {
      await renderCard({ celebration: () => <Text>Stuck</Text> });
      expect(screen.queryByRole("header")).toBeNull();
      await act(async () => {
        jest.advanceTimersByTime(CELEBRATION_MAX_MS);
      });
      expect(screen.getByRole("header")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});

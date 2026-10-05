import React, { useMemo } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { NavigationContext } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import {
  dark as darkColors,
  light as lightColors,
  ThemeProvider,
  type Colors,
} from "../../../theme/ThemeContext";
import GameResultModal, {
  CELEBRATION_MAX_MS,
  type GameOutcome,
  type GameResultModalProps,
} from "../GameResultModal";
import { resetDisplayNameCacheForTests } from "../../../game/_shared/displayName";
import { useLeaderboardLink } from "../../../hooks/useLeaderboardLink";
import { __forceStoreBuildForTests } from "../../../entitlements/gameVisibility";
import type { GameType } from "../../../api/vocab";

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");

const THEME_COLORS = { dark: darkColors, light: lightColors } as const;

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

/** The character a MaterialCommunityIcons icon renders as (it is a font glyph). */
function glyph(name: IconName): string {
  return String.fromCodePoint(MaterialCommunityIcons.glyphMap[name] as number);
}

/** The n-th host ancestor of a rendered element. */
function ancestor<T extends { parent: T | null }>(el: T, n: number): T {
  let node = el;
  for (let i = 0; i < n; i++) node = node.parent!;
  return node;
}

/** Expected outcome tokens and icon per outcome (#2501). */
const OUTCOME_LOOK: Record<GameOutcome, { icon: IconName; fg: keyof Colors; tint: keyof Colors }> =
  {
    win: { icon: "trophy-outline", fg: "outcomeWin", tint: "outcomeWinTint" },
    loss: { icon: "minus-circle-outline", fg: "outcomeLoss", tint: "outcomeLossTint" },
    draw: { icon: "equal", fg: "outcomeDraw", tint: "outcomeDrawTint" },
    ended: { icon: "flag-outline", fg: "outcomeEnded", tint: "outcomeEndedTint" },
  };

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
      await renderCard(
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

      const c = THEME_COLORS[theme];
      const look = OUTCOME_LOOK[outcome];
      const fg = c[look.fg];
      // Scrim, card surface and the outcome stripe (light theme also draws a 1px border).
      const card = screen.getByTestId("game-result");
      expect(ancestor(card, 3)).toHaveStyle({ backgroundColor: c.overlay });
      expect(card).toHaveStyle({
        backgroundColor: c.surfaceHigh,
        borderColor: c.border,
        borderWidth: theme === "light" ? 1 : 0,
        borderTopWidth: 5,
        borderTopColor: fg,
      });
      // Outcome icon on its tinted disc, and the title, in the outcome colour.
      const icon = screen.getByText(glyph(look.icon));
      expect(icon).toHaveStyle({ color: fg, fontSize: 26 });
      expect(icon.parent).toHaveStyle({ backgroundColor: c[look.tint] });
      expect(screen.getByRole("header")).toHaveStyle({ color: fg, fontSize: 32 });
      expect(screen.getByText("SUDOKU · HARD")).toHaveStyle({
        color: c.textMuted,
        textTransform: "uppercase",
      });
      expect(screen.getByText("Solved in 12:48")).toHaveStyle({ color: c.textMuted });
      // Score hero (number formatted) and the stats strip.
      expect(screen.getByText("Score")).toHaveStyle({ color: c.textMuted });
      expect(screen.getByText("4,820")).toHaveStyle({ color: c.text, fontSize: 52 });
      for (const [value, label] of [
        ["12:48", "Time"],
        ["2", "Errors"],
      ]) {
        expect(screen.getByText(value!)).toHaveStyle({ color: c.text });
        expect(screen.getByText(label!)).toHaveStyle({ color: c.textMuted });
      }
      expect(ancestor(screen.getByText("Time"), 2)).toHaveStyle({ backgroundColor: c.surfaceAlt });
      // Play Again (filled accent) and Home (outlined) buttons.
      const primary = screen.getByTestId("game-result-primary");
      expect(primary).toHaveTextContent("Play Again");
      expect(primary).toHaveStyle({ backgroundColor: c.accentBright });
      expect(screen.getByText("Play Again")).toHaveStyle({ color: c.textOnAccent });
      expect(screen.getByTestId("game-result-home")).toHaveStyle({
        borderColor: c.textMuted,
        backgroundColor: "transparent",
      });
      expect(screen.getByText("Home")).toHaveStyle({ color: c.text });
      expect(screen.getByText(glyph("home-outline"))).toHaveStyle({ color: c.text });
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
    await renderCard({
      outcome: "loss",
      winnerName: "Computer",
      hero: { kind: "versus", you: 241, opponent: 264, opponentLabel: "CPU" },
    });
    expect(screen.getByText("241")).toBeTruthy();
    expect(screen.getByText("264")).toBeTruthy();
    expect(screen.getByText("CPU")).toBeTruthy();
    const c = darkColors;
    expect(screen.getByRole("header")).toHaveStyle({ color: c.outcomeLoss });
    // On a loss the opponent leads: their score is full-strength, the player's is dimmed.
    expect(screen.getByText("264")).toHaveStyle({ color: c.text, opacity: 1, fontSize: 44 });
    expect(screen.getByText("241")).toHaveStyle({ color: c.textMuted, opacity: 0.85 });
    expect(screen.getByText("You")).toHaveStyle({ color: c.textMuted });
    expect(screen.getByText("CPU")).toHaveStyle({ color: c.textMuted });
    expect(screen.getByText("vs")).toHaveStyle({ color: c.textMuted });
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
    await renderCard({
      primaryAction: { label: "Next word in 06:12:40", onPress, disabled: true },
    });
    const primary = screen.getByTestId("game-result-primary");
    expect(primary.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(primary);
    expect(onPress).not.toHaveBeenCalled();
    // Dashed, muted chip with a clock icon instead of the filled accent button.
    const c = darkColors;
    expect(primary).toHaveStyle({
      backgroundColor: c.surfaceAlt,
      borderColor: c.border,
      borderWidth: 1.5,
      borderStyle: "dashed",
    });
    expect(screen.getByText("Next word in 06:12:40")).toHaveStyle({ color: c.textMuted });
    expect(screen.getByText(glyph("clock-outline"))).toHaveStyle({ color: c.textMuted });
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

  it("shows the best entry's rank as 'Your best' when this game isn't it (#2633)", async () => {
    await renderCard({
      submission: { status: "saved", rank: 4, isBest: false, playerName: "Riley" },
    });
    expect(screen.getByText("Saved as Riley · Your best: #4")).toBeTruthy();
    expect(screen.queryByText(/on the leaderboard/)).toBeNull();
  });

  it("shows this game's placing when it is the best entry", async () => {
    await renderCard({
      submission: { status: "saved", rank: 4, isBest: true, playerName: "Riley" },
    });
    expect(screen.getByText("Saved as Riley · #4 on the leaderboard")).toBeTruthy();
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

  it("shows nothing leaderboard-related for a game on no board (#2677)", async () => {
    const idle = JSON.stringify((await renderCard({ submission: { status: "idle" } })).toJSON());
    const { toJSON } = await renderCard({
      submission: { status: "unranked", playerName: "Riley", onRetry: jest.fn() },
    });
    expect(screen.queryByText(/Saved/)).toBeNull();
    expect(screen.queryByText("Retry")).toBeNull();
    expect(screen.queryByTestId("result-name-prompt")).toBeNull();
    // Exactly the card with no submission line.
    expect(JSON.stringify(toJSON())).toBe(idle);
  });

  it("shows the saving state while submitting", async () => {
    await renderCard({ submission: { status: "submitting" } });
    expect(screen.getByText("Saving your score…")).toBeTruthy();
  });

  it("shows the offline state", async () => {
    await renderCard({ submission: { status: "offline" } });
    const line = screen.getByText("Saved offline · syncs when you're back online");
    expect(line).toHaveStyle({ color: darkColors.textMuted });
    expect(screen.getByText(glyph("cloud-off-outline"))).toHaveStyle({
      color: darkColors.textMuted,
    });
    expect(line.parent!.props).toEqual(
      expect.objectContaining({ accessibilityRole: "text", accessibilityLiveRegion: "polite" })
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("offers Retry on an error", async () => {
    const onRetry = jest.fn();
    await renderCard({ submission: { status: "error", onRetry } });
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows the one-time join prompt, with no name field, and joins on press (#2778)", async () => {
    const onJoinLeaderboards = jest.fn(() => Promise.resolve(true));
    const { toJSON } = await renderCard({
      submission: { status: "needsName", onJoinLeaderboards },
    });
    expect(screen.getByText("Join the leaderboards?")).toBeTruthy();
    // Players never type a public name.
    expect(JSON.stringify(toJSON())).not.toContain("TextInput");
    expect(screen.getByTestId("result-name-prompt").parent).toHaveStyle({
      backgroundColor: darkColors.surfaceAlt,
      padding: 14,
    });
    expect(screen.getByTestId("result-name-prompt-join")).toHaveStyle({
      backgroundColor: darkColors.accentBright,
    });
    expect(screen.getByText("Join leaderboards")).toHaveStyle({ color: darkColors.textOnAccent });

    await fireEvent.press(screen.getByRole("button", { name: "Join leaderboards" }));
    await waitFor(() => expect(onJoinLeaderboards).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Couldn't join the leaderboards. Try again.")).toBeNull();
  });

  it("shows an error when the join couldn't be stored", async () => {
    const onJoinLeaderboards = jest.fn(() => Promise.resolve(false));
    await renderCard({ submission: { status: "needsName", onJoinLeaderboards } });
    await fireEvent.press(screen.getByRole("button", { name: "Join leaderboards" }));
    expect(await screen.findByText("Couldn't join the leaderboards. Try again.")).toBeTruthy();
  });
});

describe("GameResultModal — View leaderboard (#2633)", () => {
  /** A game screen's wiring: the link comes from `useLeaderboardLink`. */
  function CardFor({ gameType, navigate }: { gameType: GameType; navigate: jest.Mock }) {
    const navigation = useMemo(() => ({ navigate }), [navigate]);
    const onViewLeaderboard = useLeaderboardLink(navigation as never, gameType);
    return (
      <GameResultModal
        visible
        outcome="win"
        onHome={jest.fn()}
        submission={{ status: "saved", rank: 2, playerName: "Riley" }}
        onViewLeaderboard={onViewLeaderboard}
      />
    );
  }

  async function renderFor(gameType: GameType) {
    const navigate = jest.fn();
    await render(
      <ThemeProvider>
        <CardFor gameType={gameType} navigate={navigate} />
      </ThemeProvider>
    );
    await act(async () => {});
    return navigate;
  }

  afterEach(() => __forceStoreBuildForTests(false));

  it.each(["yacht", "sudoku", "freecell", "sort", "twenty48"] as GameType[])(
    "shows the link for %s, whose board is enabled, and opens its board",
    async (gameType) => {
      const navigate = await renderFor(gameType);
      const link = screen.getByRole("link", { name: "View leaderboard" });
      await fireEvent.press(link);
      expect(navigate).toHaveBeenCalledWith("Leaderboard", { gameType });
    }
  );

  it.each(["blackjack", "daily_word"] as GameType[])(
    "shows no link for %s, whose board is disabled",
    async (gameType) => {
      await renderFor(gameType);
      expect(screen.getByText("Saved as Riley · #2 on the leaderboard")).toBeTruthy();
      expect(screen.queryByText("View leaderboard")).toBeNull();
    }
  );

  it("shows no link for a game hidden in a store build", async () => {
    __forceStoreBuildForTests(true);
    await renderFor("cascade");
    expect(screen.queryByText("View leaderboard")).toBeNull();
  });

  it("is in addition to the secondary action, not instead of it", async () => {
    const onViewLeaderboard = jest.fn();
    const onChange = jest.fn();
    await renderCard({
      onViewLeaderboard,
      secondaryAction: { label: "Change Difficulty", onPress: onChange },
    });
    await fireEvent.press(screen.getByRole("link", { name: "View leaderboard" }));
    expect(onViewLeaderboard).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Change Difficulty" })).toBeTruthy();
  });

  it.each([
    ["submitting", true],
    ["offline", true],
    ["idle", true],
    ["saved", false],
    ["unranked", false],
  ] as const)(
    "with the rank %s, asks the board to refetch after the sync: %s",
    async (status, pendingSync) => {
      const onViewLeaderboard = jest.fn();
      await renderCard({ onViewLeaderboard, submission: { status, playerName: "Riley" } });
      await fireEvent.press(screen.getByRole("link", { name: "View leaderboard" }));
      expect(onViewLeaderboard).toHaveBeenCalledWith({ pendingSync });
    }
  );

  it("shows the link even when the game has no submission line", async () => {
    await renderCard({ onViewLeaderboard: jest.fn(), submission: { status: "unranked" } });
    expect(screen.getByRole("link", { name: "View leaderboard" })).toBeTruthy();
  });

  it("hides the card while another screen covers the game, without announcing it again", async () => {
    const listeners: Record<string, (() => void)[]> = {};
    let focused = true;
    const navigation = {
      isFocused: () => focused,
      addListener: (event: string, cb: () => void) => {
        (listeners[event] ??= []).push(cb);
        return () => undefined;
      },
    };
    const emit = async (event: "focus" | "blur") => {
      focused = event === "focus";
      await act(async () => listeners[event]?.forEach((cb) => cb()));
    };
    await render(
      <ThemeProvider>
        <NavigationContext.Provider value={navigation as never}>
          <GameResultModal visible outcome="win" onHome={jest.fn()} />
        </NavigationContext.Provider>
      </ThemeProvider>
    );
    await act(async () => {});
    expect(screen.getByText("You Win!")).toBeTruthy();

    await emit("blur");
    expect(screen.queryByText("You Win!")).toBeNull();

    await emit("focus");
    expect(screen.getByText("You Win!")).toBeTruthy();
    expect(announce).toHaveBeenCalledTimes(1);
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

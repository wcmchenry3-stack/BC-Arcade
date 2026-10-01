/**
 * #2788 — after a run ends, an entitled player can start another immediately:
 * no purchase, paywall or entitlement re-check between runs, and the end-of-run
 * card offers no way to buy chips or continue.
 */
import React from "react";
import {
  render,
  renderHook,
  fireEvent,
  act,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import BlackjackTableScreen from "../BlackjackTableScreen";
import { BlackjackGameProvider, useBlackjackGame } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame } from "../../game/blackjack/storage";
import {
  newGame,
  placeBet,
  hit,
  stand,
  setRng,
  createSeededRng,
  EngineState,
} from "../../game/blackjack/engine";
import { TABLE_CONFIGS } from "../../game/blackjack/tables";

const mockShellNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockShellNavigate }),
}));

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("../../game/blackjack/storage", () => ({
  saveGame: jest.fn(),
  clearGame: jest.fn(),
  loadGame: jest.fn().mockResolvedValue(null),
  saveRun: jest.fn().mockResolvedValue(undefined),
  loadRuns: jest.fn().mockResolvedValue([]),
}));

jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    startGame: jest.fn(() => "game-uuid-test"),
    resumeGame: jest.fn(() => null),
    markStarted: jest.fn(),
    discardGame: jest.fn(),
    enqueueEvent: jest.fn(),
    completeGame: jest.fn(),
    init: jest.fn().mockResolvedValue(undefined),
    reportBug: jest.fn(),
    getQueueStats: jest.fn(),
    clearAll: jest.fn().mockResolvedValue(undefined),
  },
}));

// A genuinely lost run: all-in on a seeded deck, then play until the hand loses.
// Deterministic — the first seed that busts the player out is always the same.
function bustedState(): EngineState {
  try {
    for (let seed = 1; seed <= 200; seed++) {
      setRng(createSeededRng(seed));
      let s = placeBet(
        newGame(undefined, { startingChips: 100, betMin: 5, betMax: 100, runGoal: 250 }),
        100
      );
      for (let i = 0; i < 12 && s.phase === "player"; i++) s = hit(s);
      if (s.phase === "player") s = stand(s);
      if (s.phase === "result" && s.chips === 0) return s;
    }
  } finally {
    setRng(Math.random);
  }
  throw new Error("no losing all-in found");
}

const MONEY_COPY =
  /buy|purchase|refill|restore|redeem|continue|revive|extra|second chance|unlock|premium|\$/i;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Blackjack replay after a run ends (#2788)", () => {
  it("the out-of-chips card offers only Play Again and Home, with no purchase or continue", async () => {
    (loadGame as jest.Mock).mockResolvedValue(bustedState());
    const nav = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn(), popToTop: jest.fn() };
    await render(
      <ThemeProvider>
        <BlackjackGameProvider>
          <BlackjackTableScreen navigation={nav as never} />
        </BlackjackGameProvider>
      </ThemeProvider>
    );
    const card = within(await screen.findByTestId("blackjack-result"));
    const buttons = card.getAllByRole("button");
    expect(buttons.map((b) => String(b.props.accessibilityLabel ?? "")).sort()).toEqual([
      "Home",
      "Play Again",
    ]);
    for (const b of buttons)
      expect(String(b.props.accessibilityLabel ?? "")).not.toMatch(MONEY_COPY);
    expect(card.queryByText(MONEY_COPY)).toBeNull();

    await act(async () => {
      await fireEvent.press(card.getByRole("button", { name: "Play Again" }));
    });
    // Straight to the table picker: no paywall or purchase screen in between.
    expect(nav.replace).toHaveBeenCalledWith("BlackjackBetting");
    expect(nav.navigate).not.toHaveBeenCalled();
    expect(mockShellNavigate).not.toHaveBeenCalled();
  });

  it.each(TABLE_CONFIGS.map((t) => [t.id, t]))(
    "after a bust-out, Play Again then the %s table starts a fresh full-stack run",
    async (_id, t) => {
      const table = t as (typeof TABLE_CONFIGS)[number];
      (loadGame as jest.Mock).mockResolvedValue(bustedState());
      const hook = await renderHook(() => useBlackjackGame(), {
        wrapper: ({ children }) => <BlackjackGameProvider>{children}</BlackjackGameProvider>,
      });
      await waitFor(() => expect(hook.result.current.loading).toBe(false));
      expect(hook.result.current.engine?.chips).toBe(0);

      await act(async () => hook.result.current.handlePlayAgain());
      // Table pick pending: fresh engine, betting phase, no run in progress.
      expect(hook.result.current.engine?.phase).toBe("betting");
      expect(hook.result.current.engine?.runGoal).toBeNull();

      await act(async () => hook.result.current.handleTableSelect(table));
      expect(hook.result.current.engine?.chips).toBe(table.startingChips);
      expect(hook.result.current.engine?.phase).toBe("betting");
      expect(hook.result.current.engine?.runGoal).toBe(table.runGoal);
    }
  );
});

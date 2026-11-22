/** BlackjackDevPanel (#3576): gate, picking, presets and the stacking path. */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import BlackjackDevPanel from "../BlackjackDevPanel";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { newGame, type EngineState } from "../../../game/blackjack/engine";
import { BLACKJACK_DEV_PRESETS } from "../../../game/blackjack/devDeck";

const mockDevSetEngine = jest.fn();
const mockApply = jest.fn();
jest.mock("../../../game/blackjack/BlackjackGameContext", () => ({
  useBlackjackGame: () => ({ devSetEngine: mockDevSetEngine, apply: mockApply }),
}));

const g = globalThis as { __DEV__?: boolean };
const realDev = g.__DEV__;
const realUrl = process.env.EXPO_PUBLIC_API_URL;

const renderPanel = () =>
  render(
    <ThemeProvider>
      <BlackjackDevPanel />
    </ThemeProvider>
  );

/** The state setter the panel handed to devSetEngine, run on a fresh game. */
function stackedDeck() {
  const fn = mockDevSetEngine.mock.calls[0]![0] as (s: EngineState) => EngineState;
  return fn(newGame()).deck;
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  g.__DEV__ = realDev;
  if (realUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = realUrl;
});

describe("BlackjackDevPanel", () => {
  it("renders nothing in a store build", async () => {
    g.__DEV__ = false;
    delete process.env.EXPO_PUBLIC_API_URL;
    await renderPanel();
    expect(screen.queryByText("DEV")).toBeNull();
  });

  it("shows the DEV button in a pre-launch API build", async () => {
    g.__DEV__ = false;
    process.env.EXPO_PUBLIC_API_URL = "https://dev-games-api.buffingchi.com";
    await renderPanel();
    expect(screen.getByText("DEV")).toBeTruthy();
  });

  it("stacks a picked card list through devSetEngine, not apply", async () => {
    await renderPanel();
    await fireEvent.press(screen.getByText("DEV"));
    await fireEvent.press(screen.getByTestId("dev-card-rank-A"));
    await fireEvent.press(screen.getByTestId("dev-card-suit-♠"));
    await fireEvent.press(screen.getByTestId("dev-card-rank-K"));
    await fireEvent.press(screen.getByTestId("dev-card-suit-♥"));
    await fireEvent.press(screen.getByTestId("blackjack-dev-stack"));

    expect(mockApply).not.toHaveBeenCalled();
    expect(mockDevSetEngine).toHaveBeenCalledTimes(1);
    const deck = stackedDeck();
    expect(deck.at(-1)).toEqual({ rank: "A", suit: "♠" });
    expect(deck.at(-2)).toEqual({ rank: "K", suit: "♥" });
  });

  it("a preset fills the list and stacks it", async () => {
    await renderPanel();
    await fireEvent.press(screen.getByText("DEV"));
    await fireEvent.press(screen.getByTestId("dev-card-preset-Player natural"));
    expect(screen.getByText("1. A♠")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("blackjack-dev-stack"));
    const natural = BLACKJACK_DEV_PRESETS.find((p) => p.label === "Player natural")!;
    expect(stackedDeck().slice(-natural.cards.length).reverse()).toEqual(natural.cards);
  });
});

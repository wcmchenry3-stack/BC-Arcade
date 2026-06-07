import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import GameOverlay from "../GameOverlay";
import { ThemeProvider } from "../../../theme/ThemeContext";

async function renderOverlay(
  type: "game_over" | "win",
  overrides: Partial<React.ComponentProps<typeof GameOverlay>> = {}
) {
  const props = {
    type,
    score: 1024,
    onNewGame: jest.fn(),
    onHome: jest.fn(),
    ...overrides,
  };
  return await render(
    <ThemeProvider>
      <GameOverlay {...props} />
    </ThemeProvider>
  );
}

describe("GameOverlay — game over state", () => {
  it('shows "Game Over" title', async () => {
    const { getByText } = await renderOverlay("game_over");
    expect(getByText("Game Over")).toBeTruthy();
  });

  it("does not show keep playing button", async () => {
    const { queryByText } = await renderOverlay("game_over");
    expect(queryByText("Keep Playing")).toBeNull();
  });

  it('calls onNewGame when "New Game" is pressed', async () => {
    const onNewGame = jest.fn();
    const { getByLabelText } = await renderOverlay("game_over", { onNewGame });
    await fireEvent.press(getByLabelText("Start a new 2048 game"));
    expect(onNewGame).toHaveBeenCalledTimes(1);
  });

  it('calls onHome when "Home" is pressed', async () => {
    const onHome = jest.fn();
    const { getByLabelText } = await renderOverlay("game_over", { onHome });
    await fireEvent.press(getByLabelText("Quit and return to home screen"));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it("renders the score callout with correct accessibility label", async () => {
    const { getByLabelText } = await renderOverlay("game_over", { score: 512 });
    expect(getByLabelText("Current score: 512")).toBeTruthy();
  });
});

describe("GameOverlay — win state", () => {
  it('shows "You Win!" title', async () => {
    const { getByText } = await renderOverlay("win");
    expect(getByText("You Win!")).toBeTruthy();
  });

  it("shows keep playing button when onKeepPlaying is provided", async () => {
    const { getByLabelText } = await renderOverlay("win", { onKeepPlaying: jest.fn() });
    expect(getByLabelText("Continue playing after reaching 2048")).toBeTruthy();
  });

  it("calls onKeepPlaying when button is pressed", async () => {
    const onKeepPlaying = jest.fn();
    const { getByLabelText } = await renderOverlay("win", { onKeepPlaying });
    await fireEvent.press(getByLabelText("Continue playing after reaching 2048"));
    expect(onKeepPlaying).toHaveBeenCalledTimes(1);
  });

  it("calls onNewGame when New Game is pressed from win state", async () => {
    const onNewGame = jest.fn();
    const { getByLabelText } = await renderOverlay("win", { onNewGame, onKeepPlaying: jest.fn() });
    await fireEvent.press(getByLabelText("Start a new 2048 game"));
    expect(onNewGame).toHaveBeenCalledTimes(1);
  });

  it("does not show keep playing button when onKeepPlaying is not provided", async () => {
    const { queryByLabelText } = await renderOverlay("win");
    expect(queryByLabelText("Continue playing after reaching 2048")).toBeNull();
  });

  it("renders the score callout with correct accessibility label", async () => {
    const { getByLabelText } = await renderOverlay("win", { score: 2048 });
    expect(getByLabelText("Current score: 2048")).toBeTruthy();
  });
});

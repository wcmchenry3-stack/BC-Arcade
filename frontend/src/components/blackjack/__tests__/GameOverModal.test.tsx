import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import GameOverModal from "../GameOverModal";
import { ThemeProvider } from "../../../theme/ThemeContext";

async function renderModal(opts: {
  visible?: boolean;
  onPlayAgain?: () => void;
  onHome?: () => void;
}) {
  const { visible = true, onPlayAgain = jest.fn(), onHome = jest.fn() } = opts;
  return await render(
    <ThemeProvider>
      <GameOverModal visible={visible} onPlayAgain={onPlayAgain} onHome={onHome} />
    </ThemeProvider>
  );
}

describe("GameOverModal", () => {
  it("renders title when visible", async () => {
    const { getByText } = await renderModal({});
    expect(getByText("Out of Chips")).toBeTruthy();
  });

  it("renders body copy", async () => {
    const { getByText } = await renderModal({});
    expect(getByText(/run out of chips/i)).toBeTruthy();
  });

  it("renders Play Again button", async () => {
    const { getByLabelText } = await renderModal({});
    expect(getByLabelText(/start a new session/i)).toBeTruthy();
  });

  it("renders Home button", async () => {
    const { getByLabelText } = await renderModal({});
    expect(getByLabelText(/return to home/i)).toBeTruthy();
  });

  it("calls onPlayAgain when Play Again is pressed", async () => {
    const onPlayAgain = jest.fn();
    const { getByLabelText } = await renderModal({ onPlayAgain });
    await fireEvent.press(getByLabelText(/start a new session/i));
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
  });

  it("calls onHome when Home is pressed", async () => {
    const onHome = jest.fn();
    const { getByLabelText } = await renderModal({ onHome });
    await fireEvent.press(getByLabelText(/return to home/i));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it("does not render content when not visible", async () => {
    const { queryByText } = await renderModal({ visible: false });
    expect(queryByText("Out of Chips")).toBeNull();
  });
});

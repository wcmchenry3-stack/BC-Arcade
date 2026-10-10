import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import Stepper from "../Stepper";

async function renderStepper(overrides: Partial<React.ComponentProps<typeof Stepper>> = {}) {
  const props = {
    value: "6",
    onDecrement: jest.fn(),
    onIncrement: jest.fn(),
    decrementDisabled: false,
    incrementDisabled: false,
    decrementLabel: "Fewer decks",
    incrementLabel: "More decks",
    ...overrides,
  };
  await render(
    <ThemeProvider>
      <Stepper {...props} />
    </ThemeProvider>
  );
  return props;
}

describe("Stepper", () => {
  it("shows the formatted value between labelled − and + buttons", async () => {
    await renderStepper({ value: "75%" });
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fewer decks" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More decks" })).toBeTruthy();
    expect(screen.getByText("−")).toBeTruthy();
    expect(screen.getByText("+")).toBeTruthy();
  });

  it("calls onDecrement and onIncrement from their buttons", async () => {
    const { onDecrement, onIncrement } = await renderStepper();
    await fireEvent.press(screen.getByRole("button", { name: "Fewer decks" }));
    expect(onDecrement).toHaveBeenCalledTimes(1);
    expect(onIncrement).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "More decks" }));
    expect(onIncrement).toHaveBeenCalledTimes(1);
  });

  it("disables − at the lower bound", async () => {
    const { onDecrement } = await renderStepper({ decrementDisabled: true });
    const minus = screen.getByRole("button", { name: "Fewer decks" });
    expect(minus).toBeDisabled();
    expect(screen.getByRole("button", { name: "More decks" })).not.toBeDisabled();
    await fireEvent.press(minus);
    expect(onDecrement).not.toHaveBeenCalled();
  });

  it("disables + at the upper bound", async () => {
    const { onIncrement } = await renderStepper({ incrementDisabled: true });
    const plus = screen.getByRole("button", { name: "More decks" });
    expect(plus).toBeDisabled();
    await fireEvent.press(plus);
    expect(onIncrement).not.toHaveBeenCalled();
  });
});

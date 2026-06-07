import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import ScoreRow from "../ScoreRow";
import { ThemeProvider } from "../../theme/ThemeContext";

async function renderRow(overrides: Partial<React.ComponentProps<typeof ScoreRow>> = {}) {
  const defaults = {
    label: "Ones",
    category: "ones",
    tone: "upper" as const,
    score: null,
    potential: undefined,
    canScore: false,
    onSelect: jest.fn(),
  };
  return await render(
    <ThemeProvider>
      <ScoreRow {...defaults} {...overrides} />
    </ThemeProvider>
  );
}

describe("ScoreRow", () => {
  it("renders empty state with dash when no score and no potential", async () => {
    const { getByText, getByRole } = await renderRow();
    expect(getByText("—")).toBeTruthy();
    expect(getByRole("button").props.accessibilityState.disabled).toBe(true);
  });

  it("renders potential state when canScore and potential defined", async () => {
    const { getByText } = await renderRow({ canScore: true, potential: 12 });
    expect(getByText("12")).toBeTruthy();
  });

  it("renders filled state with score and is not pressable", async () => {
    const onSelect = jest.fn();
    const { getByText, getByRole } = await renderRow({ score: 9, onSelect });
    expect(getByText("9")).toBeTruthy();
    await fireEvent.press(getByRole("button"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("fires onSelect only when canScore and not filled", async () => {
    const onSelect = jest.fn();
    const { getByRole } = await renderRow({ canScore: true, potential: 5, onSelect });
    await fireEvent.press(getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("accepts lower tone without crashing", async () => {
    const { getByRole } = await renderRow({ category: "yacht", tone: "lower", score: 50 });
    expect(getByRole("button")).toBeTruthy();
  });
});

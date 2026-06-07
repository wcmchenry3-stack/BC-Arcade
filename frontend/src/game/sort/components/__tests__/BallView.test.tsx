import React from "react";
import { render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../../theme/ThemeContext";
import BallView from "../BallView";

function withTheme(children: React.ReactNode) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe("BallView", () => {
  it("renders with the color name as accessibilityLabel", async () => {
    const { getByLabelText } = await render(withTheme(<BallView color="red" />));
    expect(getByLabelText("Red")).toBeTruthy();
  });

  it("renders each color with the correct label", async () => {
    const cases: [import("../../types").Color, string][] = [
      ["blue", "Blue"],
      ["green", "Green"],
      ["yellow", "Yellow"],
      ["orange", "Orange"],
      ["purple", "Purple"],
      ["pink", "Pink"],
      ["teal", "Teal"],
    ];
    for (const [color, label] of cases) {
      const { getByLabelText } = await render(withTheme(<BallView color={color} />));
      expect(getByLabelText(label)).toBeTruthy();
    }
  });

  it("renders an Svg symbol overlay when colorblindMode is true", async () => {
    const { getByTestId } = await render(withTheme(<BallView color="red" colorblindMode />));
    // Svg has accessibilityElementsHidden — must opt-in to find it
    expect(getByTestId("colorblind-overlay", { includeHiddenElements: true })).toBeTruthy();
  });

  it("does not render an Svg when colorblindMode is false (default)", async () => {
    const { queryByTestId } = await render(withTheme(<BallView color="red" />));
    expect(queryByTestId("colorblind-overlay", { includeHiddenElements: true })).toBeNull();
  });

  it("matches snapshot without colorblind mode", async () => {
    const { toJSON } = await render(withTheme(<BallView color="blue" />));
    expect(toJSON()).toMatchSnapshot();
  });

  it("matches snapshot with colorblind mode", async () => {
    const { toJSON } = await render(withTheme(<BallView color="blue" colorblindMode />));
    expect(toJSON()).toMatchSnapshot();
  });
});

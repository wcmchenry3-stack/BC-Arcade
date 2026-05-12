import React from "react";
import { render } from "@testing-library/react-native";
import Svg from "react-native-svg";
import { ThemeProvider } from "../../../../theme/ThemeContext";
import BallView from "../BallView";

function withTheme(children: React.ReactNode) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe("BallView", () => {
  it("renders with the color name as accessibilityLabel", () => {
    const { getByLabelText } = render(withTheme(<BallView color="red" />));
    expect(getByLabelText("Red")).toBeTruthy();
  });

  it("renders each color with the correct label", () => {
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
      const { getByLabelText } = render(withTheme(<BallView color={color} />));
      expect(getByLabelText(label)).toBeTruthy();
    }
  });

  it("renders an Svg symbol overlay when colorblindMode is true", () => {
    const { UNSAFE_getByType } = render(withTheme(<BallView color="red" colorblindMode />));
    expect(UNSAFE_getByType(Svg)).toBeTruthy();
  });

  it("does not render an Svg when colorblindMode is false (default)", () => {
    const { UNSAFE_queryAllByType } = render(withTheme(<BallView color="red" />));
    expect(UNSAFE_queryAllByType(Svg)).toHaveLength(0);
  });

  it("matches snapshot without colorblind mode", () => {
    const { toJSON } = render(withTheme(<BallView color="blue" />));
    expect(toJSON()).toMatchSnapshot();
  });

  it("matches snapshot with colorblind mode", () => {
    const { toJSON } = render(withTheme(<BallView color="blue" colorblindMode />));
    expect(toJSON()).toMatchSnapshot();
  });
});

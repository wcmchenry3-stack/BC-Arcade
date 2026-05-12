import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../../theme/ThemeContext";
import BottleView from "../BottleView";
import type { Color } from "../../types";

function withTheme(children: React.ReactNode) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe("BottleView", () => {
  it("labels an empty bottle correctly", () => {
    const { getByLabelText } = render(withTheme(<BottleView bottle={[]} index={0} />));
    expect(getByLabelText("Bottle 1, empty")).toBeTruthy();
  });

  it("labels a partially filled bottle with count info", () => {
    const bottle: Color[] = ["red", "blue"];
    const { getByLabelText } = render(withTheme(<BottleView bottle={bottle} index={1} />));
    expect(getByLabelText("Bottle 2, 2 of 4 filled")).toBeTruthy();
  });

  it("labels a selected bottle with the pour instruction", () => {
    const bottle: Color[] = ["red"];
    const { getByLabelText } = render(withTheme(<BottleView bottle={bottle} index={2} selected />));
    expect(getByLabelText(/Bottle 3 selected/)).toBeTruthy();
  });

  it("labels a solved bottle as complete", () => {
    const solved: Color[] = ["red", "red", "red", "red"];
    const { getByLabelText } = render(withTheme(<BottleView bottle={solved} index={0} />));
    expect(getByLabelText("Bottle 1, complete")).toBeTruthy();
  });

  it("fires onTap when pressed", () => {
    const onTap = jest.fn();
    const { getByLabelText } = render(
      withTheme(<BottleView bottle={[]} index={0} onTap={onTap} />)
    );
    fireEvent.press(getByLabelText("Bottle 1, empty"));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("renders a BallView for each color in the bottle", () => {
    const bottle: Color[] = ["red", "blue", "green"];
    const { getByLabelText } = render(withTheme(<BottleView bottle={bottle} index={0} />));
    expect(getByLabelText("Red")).toBeTruthy();
    expect(getByLabelText("Blue")).toBeTruthy();
    expect(getByLabelText("Green")).toBeTruthy();
  });
});

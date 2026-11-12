import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import BottleView, { COLORBLIND_SYMBOLS } from "../BottleView";
import type { Color } from "../../../game/sort/types";

function withTheme(children: React.ReactNode) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe("BottleView", () => {
  it("labels an empty bottle correctly", async () => {
    const { getByLabelText } = await render(withTheme(<BottleView bottle={[]} index={0} />));
    expect(getByLabelText("Bottle 1, empty")).toBeTruthy();
  });

  it("labels a partially filled bottle with count info", async () => {
    const bottle: Color[] = ["red", "blue"];
    const { getByLabelText } = await render(withTheme(<BottleView bottle={bottle} index={1} />));
    expect(getByLabelText("Bottle 2, 2 of 4 filled")).toBeTruthy();
  });

  it("labels a selected bottle with the pour instruction", async () => {
    const bottle: Color[] = ["red"];
    const { getByLabelText } = await render(
      withTheme(<BottleView bottle={bottle} index={2} selected />)
    );
    expect(getByLabelText(/Bottle 3 selected/)).toBeTruthy();
  });

  it("labels a solved bottle as complete", async () => {
    const solved: Color[] = ["red", "red", "red", "red"];
    const { getByLabelText } = await render(withTheme(<BottleView bottle={solved} index={0} />));
    expect(getByLabelText("Bottle 1, complete")).toBeTruthy();
  });

  it("fires onTap when pressed", async () => {
    const onTap = jest.fn();
    const { getByLabelText } = await render(
      withTheme(<BottleView bottle={[]} index={0} onTap={onTap} />)
    );
    await fireEvent.press(getByLabelText("Bottle 1, empty"));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("renders a ball for each color in the bottle", async () => {
    const bottle: Color[] = ["red", "blue", "green"];
    const { getByLabelText } = await render(withTheme(<BottleView bottle={bottle} index={0} />));
    expect(getByLabelText("Red")).toBeTruthy();
    expect(getByLabelText("Blue")).toBeTruthy();
    expect(getByLabelText("Green")).toBeTruthy();
  });
});

// #3658: Colorblind Mode symbols must draw as text glyphs on iOS and Android,
// never as colour emoji.
describe("COLORBLIND_SYMBOLS (#3658)", () => {
  const entries = Object.entries(COLORBLIND_SYMBOLS);

  it("has a symbol for every colour, all different", () => {
    expect(entries).toHaveLength(14);
    expect(new Set(Object.values(COLORBLIND_SYMBOLS)).size).toBe(entries.length);
  });

  it.each(entries)("%s: a text glyph, not a colour emoji", (_color, symbol) => {
    // Emoji by default (the old lightning bolt): never allowed.
    expect(symbol).not.toMatch(/\p{Emoji_Presentation}/u);
    // Emoji-capable (such as the heart): must carry the text selector U+FE0E.
    if (/\p{Extended_Pictographic}/u.test(symbol)) {
      expect(symbol.endsWith("︎")).toBe(true);
    }
    // Never the emoji selector U+FE0F.
    expect(symbol).not.toContain("️");
  });
});

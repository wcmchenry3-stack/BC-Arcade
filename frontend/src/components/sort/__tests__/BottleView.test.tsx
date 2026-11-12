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

// #3658: Colorblind Mode symbols draw as plain text glyphs on iOS and Android, never as emoji.
describe("COLORBLIND_SYMBOLS (#3658)", () => {
  const entries = Object.entries(COLORBLIND_SYMBOLS);
  // The shape family of each symbol (see the comment on COLORBLIND_SYMBOLS). No two colours
  // may share one, so they stay apart at a glance.
  const FAMILY: Record<string, string> = {
    "▲": "triangle",
    "●": "circle",
    "■": "square",
    "★": "star",
    "⬡": "hexagon",
    "◆": "diamond",
    "✱": "asterisk",
    "✚": "plus",
    "↑": "arrow",
    "✿": "flower",
    "♪": "note",
    "∞": "infinity",
    "☾": "crescent",
    "✕": "cross",
  };

  it("has a symbol for every colour, all different", () => {
    expect(entries).toHaveLength(14);
    expect(new Set(Object.values(COLORBLIND_SYMBOLS)).size).toBe(entries.length);
  });

  it("gives every colour its own shape family", () => {
    const families = Object.values(COLORBLIND_SYMBOLS).map((s) => FAMILY[s]);
    expect(families).not.toContain(undefined);
    expect(new Set(families).size).toBe(entries.length);
  });

  it.each(entries)("%s: a single plain text glyph, not emoji-capable", (_color, symbol) => {
    // One code point: no variation selector (U+FE0E or U+FE0F) to be dropped or drawn as a box
    // by Android's per-glyph SVG text layout.
    expect([...symbol]).toHaveLength(1);
    expect(symbol).not.toMatch(/\p{Emoji}/u);
    expect(symbol).not.toMatch(/\p{Emoji_Presentation}/u);
    expect(symbol).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("BottleView hint destination (#3658)", () => {
  it("adds the hint to the bottle's label only when it is the destination", async () => {
    const bottle: Color[] = ["red"];
    const { getByLabelText, queryByLabelText, rerender } = await render(
      withTheme(<BottleView bottle={bottle} index={0} hintTarget />)
    );
    expect(getByLabelText("Bottle 1, 1 of 4 filled. Hint: pour here")).toBeTruthy();
    await rerender(withTheme(<BottleView bottle={bottle} index={0} />));
    expect(queryByLabelText(/Hint: pour here/)).toBeNull();
    expect(getByLabelText("Bottle 1, 1 of 4 filled")).toBeTruthy();
  });
});

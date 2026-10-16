import React from "react";
import { StyleSheet } from "react-native";
import { render, screen, within } from "@testing-library/react-native";

import { TileRow } from "../WordTile";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { initialState, setCurrentRowLetter } from "../../../game/daily_word/engine";

// #3149 — a typed "I" painted nothing on iOS until the row was submitted. The
// shrink-wrapped letter box rounded a hair narrower than the glyph and the lone
// glyph wrapped onto a clipped second line. These pin the layout invariants
// that make that impossible for every letter, not just "I".

const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");

async function renderTypedRow(letters: readonly string[]) {
  let state = initialState("2026-10-10:en", letters.length, "en");
  for (const l of letters) state = setCurrentRowLetter(state, l);
  return await render(
    <ThemeProvider>
      <TileRow state={state} rowIndex={0} wordLength={letters.length} isFlipping={false} />
    </ThemeProvider>
  );
}

function letterText(tileIndex: number, letter: string) {
  return within(screen.getByTestId(`tile-0-${tileIndex}`)).getByText(letter.toUpperCase());
}

describe("WordTile letter layout (#3149)", () => {
  it.each(ALPHABET)("typed %s is single-line and spans the tile width", async (letter) => {
    await renderTypedRow([letter]);
    const text = letterText(0, letter);
    const style = StyleSheet.flatten(text.props.style);
    // A wrap can never push the glyph onto a hidden second line...
    expect(text.props.numberOfLines).toBe(1);
    // ...and the box is the tile's width, not the glyph's measured width.
    expect(style.alignSelf).toBe("stretch");
    expect(style.textAlign).toBe("center");
  });

  it("does not set fontWeight on the weight-specific heading family", async () => {
    await renderTypedRow(["i"]);
    const style = StyleSheet.flatten(letterText(0, "i").props.style);
    expect(style.fontFamily).toBe("SpaceGrotesk_700Bold");
    expect(style.fontWeight).toBeUndefined();
  });

  it("shows every letter of S P I R E before submit", async () => {
    await renderTypedRow(["s", "p", "i", "r", "e"]);
    ["s", "p", "i", "r", "e"].forEach((l, i) => expect(letterText(i, l)).toBeTruthy());
  });
});

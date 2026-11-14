/**
 * #2956: Cascade's "drop / next" preview — two chips, each one accessible element named for its
 * fruit, with a decorative glyph (bigger for the fruit about to drop) and a visual-only caption.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { render, screen, within } from "@testing-library/react-native";
import type { TestInstance } from "test-renderer";

import NextFruitPreview from "../NextFruitPreview";
import { FRUIT_SETS } from "../../../theme/fruitSets";
import { dark } from "../../../theme/ThemeContext";
import { piecePicture } from "../../../game/cascade/art/sprites";

// The glyphs' Skia canvas and picture cache are stubbed (the art is tested on real Skia in
// game/cascade/art/__tests__/art.test.ts).
jest.mock("@shopify/react-native-skia", () => ({ Canvas: "Canvas", Picture: "Picture" }));
jest.mock("../../../game/cascade/art/sprites", () => ({
  piecePicture: jest.fn((set: string, tier: number, size: number) => ({ set, tier, size })),
}));

const cherry = FRUIT_SETS.fruits!.fruits[0]!;
const grape = FRUIT_SETS.fruits!.fruits[2]!;
const moon = FRUIT_SETS.cosmos!.fruits[0]!;

const flat = (n: TestInstance) => StyleSheet.flatten(n.props.style);
/** The glyph frame inside a chip: its first child view. */
const glyph = (chip: TestInstance) => chip.children[0] as TestInstance;

describe("Cascade NextFruitPreview", () => {
  it("names the fruit dropping now and the one coming up", async () => {
    await render(<NextFruitPreview current={cherry} next={grape} />);
    expect(screen.getByLabelText(`Dropping next: ${cherry.name}`)).toBeTruthy();
    expect(screen.getByLabelText(`Coming up: ${grape.name}`)).toBeTruthy();
  });

  it("shows the Drop / Next captions, hidden from screen readers", async () => {
    await render(<NextFruitPreview current={cherry} next={grape} />);
    const drop = screen.getByText("Drop");
    const next = screen.getByText("Next");
    expect(drop.props.importantForAccessibility).toBe("no");
    expect(next.props.importantForAccessibility).toBe("no");
  });

  it("draws the dropping fruit bigger than the next one", async () => {
    await render(<NextFruitPreview current={cherry} next={grape} />);
    const now = screen.getByLabelText(`Dropping next: ${cherry.name}`);
    const later = screen.getByLabelText(`Coming up: ${grape.name}`);
    expect(flat(glyph(now))).toMatchObject({ width: 22, height: 22 });
    expect(flat(glyph(later))).toMatchObject({ width: 16, height: 16 });
    // Each chip owns its glyph and caption.
    expect(within(now).getByText("Drop")).toBeTruthy();
    expect(within(later).getByText("Next")).toBeTruthy();
  });

  it("uses the theme's surfaces for the two chips", async () => {
    await render(<NextFruitPreview current={cherry} next={grape} />);
    const now = screen.getByLabelText(`Dropping next: ${cherry.name}`);
    const later = screen.getByLabelText(`Coming up: ${grape.name}`);
    expect(flat(now)).toMatchObject({ backgroundColor: dark.surface, borderColor: dark.border });
    expect(flat(later)).toMatchObject({
      backgroundColor: dark.surfaceAlt,
      borderColor: dark.border,
    });
  });

  it("draws each piece's code-drawn art from its own set (#3698)", async () => {
    await render(<NextFruitPreview current={moon} next={cherry} />);
    expect(piecePicture).toHaveBeenCalledWith("cosmos", 0, 22);
    expect(piecePicture).toHaveBeenCalledWith("fruits", 0, 16);
  });

  it("names the capstones from the ladder's i18n keys (#3695)", async () => {
    const pumpkin = FRUIT_SETS.fruits!.fruits[11]!;
    const milkyWay = FRUIT_SETS.cosmos!.fruits[11]!;
    expect(pumpkin.i18nKey).toBe("fruits.pumpkin");
    await render(<NextFruitPreview current={pumpkin} next={milkyWay} />);
    expect(screen.getByLabelText("Dropping next: Pumpkin")).toBeTruthy();
    expect(screen.getByLabelText("Coming up: Milky Way")).toBeTruthy();
  });
});

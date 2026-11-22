/**
 * #2956, #3698: FruitGlyph — a piece's code-drawn art (the same drawing as the board) as an icon
 * in a fixed square. Decorative only: the chips around it carry the accessible name. Skia and the
 * picture cache are stubbed here; the drawing itself is tested on real Skia in
 * `game/cascade/art/__tests__/art.test.ts`.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import type { TestInstance } from "test-renderer";

import FruitGlyph from "../FruitGlyph";
import { FRUIT_SETS } from "../../../theme/fruitSets";
import { piecePicture } from "../../../game/cascade/art/sprites";

jest.mock("@shopify/react-native-skia", () => ({
  Canvas: "Canvas",
  Picture: "Picture",
}));
jest.mock("../../../game/cascade/art/sprites", () => ({
  piecePicture: jest.fn((set: string, tier: number, size: number) =>
    tier === 42 ? null : { set, tier, size }
  ),
}));

const cherry = FRUIT_SETS.fruits!.fruits[0]!;
const saturn = FRUIT_SETS.cosmos!.fruits[8]!;

const flat = (n: TestInstance) => StyleSheet.flatten(n.props.style);
const ofType = (type: string) => screen.root!.queryAll((n) => n.type === type);

beforeEach(() => jest.clearAllMocks());

describe("FruitGlyph", () => {
  it("draws the piece's picture for its set, tier and size, in a size x size frame", async () => {
    await render(<FruitGlyph fruit={saturn} size={22} />);
    expect(piecePicture).toHaveBeenCalledWith("cosmos", 8, 22);
    const [picture] = ofType("Picture");
    expect(picture!.props.picture).toEqual({ set: "cosmos", tier: 8, size: 22 });
    const [canvas] = ofType("Canvas");
    expect(flat(canvas!)).toMatchObject({ width: 22, height: 22 });
    expect(flat(screen.root!)).toMatchObject({ width: 22, height: 22 });
    expect(screen.root!.props.importantForAccessibility).toBe("no");
  });

  it("draws Fruits art for a Fruits piece", async () => {
    await render(<FruitGlyph fruit={cherry} size={16} />);
    expect(piecePicture).toHaveBeenCalledWith("fruits", 0, 16);
  });

  it("keeps its square, empty, when the piece cannot be drawn", async () => {
    await render(<FruitGlyph fruit={{ set: "fruits", tier: 42 }} size={16} />);
    expect(ofType("Canvas")).toHaveLength(0);
    expect(flat(screen.root!)).toMatchObject({ width: 16, height: 16 });
  });
});

/**
 * #2956: FruitGlyph — a fruit's icon in a fixed square, or a colour disc when the set has no
 * icon for it. Decorative only: the chips around it carry the accessible name.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import type { TestInstance } from "test-renderer";

import FruitGlyph from "../FruitGlyph";
import { FRUIT_SETS } from "../../../theme/fruitSets";
import type { FruitDefinition } from "../../../theme/fruitSets";

const cherry = FRUIT_SETS.fruits!.fruits[0]!;
const iconless: FruitDefinition = { ...cherry, icon: undefined };

const images = (): TestInstance[] => screen.root!.queryAll((n) => n.type === "Image");
const flat = (n: TestInstance) => StyleSheet.flatten(n.props.style);

describe("FruitGlyph", () => {
  it("renders the fruit's icon, contained in a size x size frame", async () => {
    await render(<FruitGlyph fruit={cherry} size={22} />);
    const [img] = images();
    expect(img).toBeDefined();
    expect(img!.props.source).toBe(cherry.icon);
    expect(img!.props.resizeMode).toBe("contain");
    expect(img!.props.accessibilityIgnoresInvertColors).toBe(true);
    const frame = img!.parent!;
    expect(flat(frame)).toMatchObject({ width: 22, height: 22 });
    expect(frame.props.importantForAccessibility).toBe("no");
  });

  it("warns, naming the fruit, when its icon fails to load", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await render(<FruitGlyph fruit={cherry} size={16} />);
    images()[0]!.props.onError();
    expect(warn).toHaveBeenCalledWith('FruitGlyph: failed to load icon for "Cherry"');
    warn.mockRestore();
  });

  it("falls back to a disc in the fruit's colour when there is no icon", async () => {
    await render(<FruitGlyph fruit={iconless} size={16} />);
    expect(images()).toHaveLength(0);
    const disc = screen.root!;
    expect(flat(disc)).toMatchObject({
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: cherry.color,
    });
    expect(disc.props.importantForAccessibility).toBe("no");
  });
});

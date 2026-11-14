/**
 * #3698: the home tile's Cascade icon: the Watermelon's code-drawn art on native, loaded on
 * demand behind the 🍉 emoji, which stays if the art cannot load; on web, always the emoji.
 */
import React from "react";
import { Text } from "react-native";
import { render, screen, waitFor } from "@testing-library/react-native";

/** Loads the native icon with FruitGlyph replaced: a host stub, or a module that throws. */
function load(glyph: "ok" | "fail") {
  jest.resetModules();
  jest.doMock("../FruitGlyph", () => {
    if (glyph === "fail") throw new Error("no Skia");
    return { __esModule: true, default: "FruitGlyph" };
  });
  return require("../CascadeTileIcon").default; // eslint-disable-line @typescript-eslint/no-require-imports
}

const fallback = <Text>🍉</Text>;

describe("CascadeTileIcon (native)", () => {
  it("shows the emoji, then the Watermelon's art at the tile's size", async () => {
    const CascadeTileIcon = load("ok");
    await render(<CascadeTileIcon size={56} fallback={fallback} testID="art" />);
    const glyphs = () => screen.root!.queryAll((n) => n.type === "FruitGlyph");
    await waitFor(() => expect(glyphs()).toHaveLength(1));
    expect(glyphs()[0]!.props).toEqual({ fruit: { set: "fruits", tier: 10 }, size: 56 });
    expect(screen.queryByText("🍉")).toBeNull();
  });

  it("keeps the emoji when the art cannot load", async () => {
    const CascadeTileIcon = load("fail");
    await render(<CascadeTileIcon size={56} fallback={fallback} testID="art" />);
    // Past the loading fallback: the failed load renders the emoji inside the tile's view.
    await waitFor(() => expect(screen.getByTestId("art")).toHaveTextContent("🍉"));
  });
});

describe("CascadeTileIcon (web)", () => {
  it("always shows the emoji: the home screen never loads CanvasKit", async () => {
    const { default: WebIcon } = require("../CascadeTileIcon.web"); // eslint-disable-line @typescript-eslint/no-require-imports
    await render(<WebIcon size={56} fallback={fallback} />);
    expect(screen.getByText("🍉")).toBeTruthy();
  });
});
